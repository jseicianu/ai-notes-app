import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { streamText, stepCountIs, type LanguageModelUsage } from "ai";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Run } from "@/lib/models/types";
import { createClient } from "@/lib/supabase/server";
import { getModel, type ModelOptions } from "@/services/model-service";
import { saveBlockVersion } from "@/services/block-version-service";
import { createNotebookTools, readInputValues, readControlPanelSources } from "@/services/notebook-tools";
import { createRun, updateRunStatus } from "@/services/run-service";
import {
  resolveSources,
  type ResolvedSource,
  type SourceReference,
} from "@/services/source-service";

export const runtime = "nodejs";

const requestSchema = z.object({
  prompt: z.string().min(1),
  contextBlocks: z
    .array(
      z.object({
        id: z.string().optional(),
        type: z.string().optional(),
        label: z.string().optional(),
        content: z.unknown(),
      })
    )
    .default([]),
  modelProvider: z.string().default("anthropic"),
  modelName: z.string().default(""),
  outputTypeHint: z.string().optional(),
  existingOutputBlockIds: z.array(z.string().uuid()).default([]),
  sources: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("block"), blockId: z.string().uuid() }),
        z.object({ type: z.literal("file"), fileId: z.string().uuid() }),
        z.object({ type: z.literal("url"), url: z.string().url() }),
        z.object({ type: z.literal("paste"), content: z.string() }),
        z.object({
          type: z.literal("rag"),
          query: z.string().min(1),
          limit: z.number().int().positive().optional(),
        }),
      ])
    )
    .default([]),
  pageId: z.string().uuid(),
  triggerBlockId: z.string().uuid(),
  workspaceId: z.string().uuid(),
});

type RunRequest = z.infer<typeof requestSchema>;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = createServiceRoleClient();
  const workspace = await getWorkspaceForUser(
    serviceClient,
    body.workspaceId,
    user.id
  );

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const outputBlockIds: string[] = [];
  const toolsUsed = new Set<string>();
  const inputVariables = await readInputValues(
    serviceClient,
    body.workspaceId,
    body.pageId
  );
  const controlPanelSources = await readControlPanelSources(
    serviceClient,
    body.workspaceId,
    body.pageId
  );
  const allSourceRefs: SourceReference[] = [
    ...(body.sources as SourceReference[]),
    ...controlPanelSources,
  ];
  const resolvedSources =
    allSourceRefs.length > 0
      ? await resolveSources(allSourceRefs, body.workspaceId)
      : [];
  const contextUsed = [
    ...Object.keys(inputVariables).map((name) => ({
      type: "input",
      id: name,
      label: name,
    })),
    ...resolvedSources.map((source, index) => ({
      type: `source:${source.type}`,
      id:
        source.metadata?.blockId ??
        source.metadata?.url ??
        source.metadata?.filename ??
        `source-${index + 1}`,
      label: source.label,
      metadata: source.metadata,
    })),
    ...body.contextBlocks.map((block, index) => ({
      type: block.type ?? "block",
      id: block.id ?? `inline-${index}`,
      label: block.label ?? block.type ?? `Context ${index + 1}`,
    })),
  ];

  let run: Run | undefined;
  try {
    run = await createRun(
      {
        workspaceId: body.workspaceId,
        pageId: body.pageId,
        triggerBlockId: body.triggerBlockId,
        type: "ai_cell",
        input: {
          prompt: body.prompt,
          contextBlocks: body.contextBlocks,
          inputVariables,
          sources: body.sources,
          resolvedSources: summarizeResolvedSources(resolvedSources),
          existingOutputBlockIds: body.existingOutputBlockIds,
          outputTypeHint: body.outputTypeHint,
        },
        modelProvider: body.modelProvider,
        modelName: body.modelName,
      },
      serviceClient
    );

    const runRecord = run;
    const result = streamText({
      model: getModel(body.modelProvider, body.modelName, workspace.modelOptions),
      system: buildSystemPrompt(body),
      prompt: buildUserPrompt(body, inputVariables, resolvedSources),
      tools: createNotebookTools({
        workspaceId: body.workspaceId,
        pageId: body.pageId,
        parentBlockId: body.triggerBlockId,
        currentRunId: runRecord.id,
        existingOutputBlockIds: body.existingOutputBlockIds,
        supabase: serviceClient,
        onBlockCreated: (block) => outputBlockIds.push(block.id),
        onToolUsed: (toolName) => toolsUsed.add(toolName),
      }),
      stopWhen: stepCountIs(5),
      onFinish: async (event) => {
        if (outputBlockIds.length === 0 && event.text.trim()) {
          const existingId = body.existingOutputBlockIds[0];
          if (existingId) {
            await saveBlockVersion(existingId, serviceClient);
            await serviceClient
              .from("blocks")
              .update({
                content: { format: "text", data: event.text },
                updated_at: new Date().toISOString(),
              })
              .eq("id", existingId);
            outputBlockIds.push(existingId);
          } else {
            const { data: triggerBlock } = await serviceClient
              .from("blocks")
              .select("sort_order")
              .eq("id", body.triggerBlockId)
              .single();
            const { data: newBlock } = await serviceClient
              .from("blocks")
              .insert({
                workspace_id: body.workspaceId,
                page_id: body.pageId,
                parent_block_id: body.triggerBlockId,
                sort_order: (triggerBlock?.sort_order ?? 0) + 1,
                type: "output",
                content: { format: "text", data: event.text },
              })
              .select()
              .single();
            if (newBlock) outputBlockIds.push(newBlock.id);
          }
        }

        await updateRunStatus(
          runRecord.id,
          "completed",
          {
            output: {
              text: event.text,
              finishReason: event.finishReason,
            },
            outputBlockIds,
            contextUsed,
            toolsUsed: Array.from(toolsUsed),
            schemaValidation: "not_applicable",
            tokenUsage: normalizeUsage(event.totalUsage),
            durationMs: Date.now() - startedAt,
            completedAt: new Date().toISOString(),
          },
          serviceClient
        );
      },
      onError: async ({ error }) => {
        await updateRunStatus(
          runRecord.id,
          "failed",
          {
            error: serializeError(error),
            outputBlockIds,
            contextUsed,
            toolsUsed: Array.from(toolsUsed),
            durationMs: Date.now() - startedAt,
            completedAt: new Date().toISOString(),
          },
          serviceClient
        );
      },
    });

    return result.toTextStreamResponse({
      headers: {
        "x-run-id": run.id,
      },
    });
  } catch (error) {
    if (run) {
      await updateRunStatus(
        run.id,
        "failed",
        {
          error: serializeError(error),
          outputBlockIds,
          contextUsed,
          toolsUsed: Array.from(toolsUsed),
          durationMs: Date.now() - startedAt,
          completedAt: new Date().toISOString(),
        },
        serviceClient
      );
    }

    return NextResponse.json(
      { error: "AI run failed", details: serializeError(error) },
      { status: 500 }
    );
  }
}

function createServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for AI execution");
  }

  return createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

async function getAuthenticatedUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (authorization?.startsWith("Bearer ")) {
    const supabase = createSupabaseJsClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: { Authorization: authorization },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    return user;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

async function getWorkspaceForUser(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string,
  userId: string
) {
  const { data, error } = await serviceClient
    .from("workspaces")
    .select("id,settings")
    .eq("id", workspaceId)
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const settings = (data.settings ?? {}) as Record<string, unknown>;
  return {
    id: data.id as string,
    modelOptions: getModelOptionsFromSettings(settings),
  };
}

function buildSystemPrompt(body: RunRequest) {
  return [
    "You are an AI cell inside a command notebook. You produce direct, useful output — no preamble, no sign-offs, no meta-commentary.",
    "Follow the user's formatting instructions exactly. Use markdown formatting (bullet lists, headers, bold, code blocks, etc.) when appropriate.",
    "IMPORTANT: Always respond with streamed text. Do NOT use tools to create text output blocks — write text directly in your response.",
    "Only use notebook tools when explicitly asked to create structured data like tables, JSON objects, or todo lists.",
    "Never say things like 'Here is...', 'Let me know if...', or 'I hope this helps'. Just output the result.",
    body.outputTypeHint
      ? `The requested output type hint is: ${body.outputTypeHint}.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUserPrompt(
  body: RunRequest,
  inputVariables: Record<string, unknown>,
  resolvedSources: ResolvedSource[]
) {
  const inputs = formatInputVariables(inputVariables);
  const context = assembleContext(body.contextBlocks);
  const sources = formatResolvedSources(resolvedSources);
  const sections = [
    body.prompt,
    inputs ? `Input variables:\n${inputs}` : null,
    sources ? `Sources:\n${sources}` : null,
    context ? `Context blocks:\n${context}` : null,
  ].filter(Boolean);

  return sections.join("\n\n");
}

function formatResolvedSources(resolvedSources: ResolvedSource[]) {
  return resolvedSources
    .map(
      (source, index) =>
        `<source index="${index + 1}" type="${escapeAttribute(
          source.type
        )}" label="${escapeAttribute(source.label)}">\n${
          source.content
        }\n</source>`
    )
    .join("\n\n");
}

function summarizeResolvedSources(resolvedSources: ResolvedSource[]) {
  return resolvedSources.map((source) => ({
    type: source.type,
    label: source.label,
    metadata: source.metadata,
    contentLength: source.content.length,
  }));
}

function assembleContext(contextBlocks: RunRequest["contextBlocks"]) {
  return contextBlocks
    .map((block, index) => {
      const label = block.label || block.type || `Block ${index + 1}`;
      return `<context-block index="${index + 1}" label="${escapeAttribute(
        label
      )}">\n${safeStringify(block.content)}\n</context-block>`;
    })
    .join("\n\n");
}

function normalizeUsage(usage: LanguageModelUsage) {
  return {
    prompt_tokens: usage.inputTokens ?? 0,
    completion_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? 0,
    raw: usage.raw,
  };
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      details: error.stack,
    };
  }

  return {
    message: "Unknown error",
    details: error,
  };
}

function safeStringify(value: unknown) {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function escapeAttribute(value: string) {
  return value.replaceAll('"', "&quot;");
}

function formatInputVariables(inputVariables: Record<string, unknown>) {
  return Object.entries(inputVariables)
    .map(([name, value]) => `- ${name} = ${formatVariableValue(value)}`)
    .join("\n");
}

function formatVariableValue(value: unknown) {
  return typeof value === "string" ? JSON.stringify(value) : safeStringify(value);
}

function getModelOptionsFromSettings(
  settings: Record<string, unknown>
): ModelOptions {
  const localModels = objectSetting(settings.localModels);
  const apiKeys = objectSetting(settings.apiKeys);

  return {
    localBaseUrl:
      stringValue(localModels.ollamaUrl) || stringValue(localModels.lmStudioUrl),
    localModelName: stringValue(localModels.modelName),
    apiKeys: {
      anthropic: stringValue(apiKeys.anthropic),
      openai: stringValue(apiKeys.openai),
      google: stringValue(apiKeys.google),
    },
  };
}

function objectSetting(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
