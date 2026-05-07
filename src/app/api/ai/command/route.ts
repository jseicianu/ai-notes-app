import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import {
  generateText,
  streamText,
  stepCountIs,
  type LanguageModelUsage,
  type ToolSet,
} from "ai";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Block, Command, Run } from "@/lib/models/types";
import { getSourceConfig, isSourceInput } from "@/lib/models/types";
import { createClient } from "@/lib/supabase/server";
import { fillTemplate, validateOutput } from "@/services/command-service";
import { getModel, type ModelOptions } from "@/services/model-service";
import {
  createNotebookTools,
  filterNotebookTools,
  readInputValues,
  readControlPanelSources,
} from "@/services/notebook-tools";
import { createRun, updateRunStatus } from "@/services/run-service";
import {
  resolveSources,
  type ResolvedSource,
  type SourceReference,
} from "@/services/source-service";

export const runtime = "nodejs";

const requestSchema = z.object({
  commandId: z.string().uuid(),
  inputs: z.record(z.string(), z.string()).default({}),
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
  workspaceId: z.string().uuid(),
  pageId: z.string().uuid(),
  triggerBlockId: z.string().uuid(),
});

type CommandRequest = z.infer<typeof requestSchema>;

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

  const command = await getCommandForWorkspace(
    serviceClient,
    body.commandId,
    body.workspaceId
  );

  if (!command) {
    return NextResponse.json({ error: "Command not found" }, { status: 404 });
  }

  const sourceConfig = getSourceConfig(command);
  const inputVariables = await readInputValues(
    serviceClient,
    body.workspaceId,
    body.pageId
  );
  const resolvedInputs =
    sourceConfig && body.sources.length > 0
      ? { ...body.inputs }
      : await resolveBlockReferences(
          serviceClient,
          command,
          body.inputs,
          body.workspaceId
        );
  const templateInputs = stringifyTemplateInputs({
    ...inputVariables,
    ...resolvedInputs,
  });
  if (sourceConfig && body.sources.length > 0) {
    for (const input of command.inputs) {
      if (isSourceInput(input)) {
        templateInputs[input.name] = "the selected sources below";
      }
    }
  }
  const prompt = fillTemplate(command.prompt_template, templateInputs);
  const hasExplicitSourceConfigSources = Boolean(
    sourceConfig && body.sources.length > 0
  );
  const context = hasExplicitSourceConfigSources
    ? { text: "", contextUsed: [] }
    : await assembleCommandContext(serviceClient, command, body);
  const inputContext = formatInputVariables(inputVariables);
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
    ...context.contextUsed,
  ];
  const modelProvider =
    command.model_provider || workspace.modelProvider || "anthropic";
  const modelName = command.model_name || workspace.modelName || "";
  const outputBlockIds: string[] = [];
  const toolsUsed = new Set<string>();

  let run: Run | undefined;

  try {
    run = await createRun(
      {
        workspaceId: body.workspaceId,
        pageId: body.pageId,
        triggerBlockId: body.triggerBlockId,
        commandId: command.id,
        type: "command",
        input: {
          inputs: body.inputs,
          inputVariables,
          sources: body.sources,
          resolvedSources: summarizeResolvedSources(resolvedSources),
          existingOutputBlockIds: body.existingOutputBlockIds,
          prompt,
          contextConfig: command.context_config,
        },
        modelProvider,
        modelName,
      },
      serviceClient
    );

    const runRecord = run;
    const tools = buildAllowedTools({
      command,
      body,
      runId: run.id,
      outputBlockIds,
      toolsUsed,
      existingOutputBlockIds: body.existingOutputBlockIds,
      serviceClient,
    });

    const result = streamText({
      model: getModel(modelProvider, modelName, workspace.modelOptions),
      system: buildSystemPrompt(command),
      prompt: buildCommandPrompt(
        prompt,
        inputContext,
        formatResolvedSources(resolvedSources),
        context.text
      ),
      tools,
      stopWhen: stepCountIs(5),
      onFinish: async (event) => {
        const firstOutput = parseStructuredOutput(event.text);
        let validation = validateOutput(firstOutput, command.output_schema);
        let finalText = event.text;
        let finalOutput = firstOutput;
        let repairUsed = false;

        if (!validation.valid) {
          const repair = await generateText({
            model: getModel(modelProvider, modelName, workspace.modelOptions),
            system: buildRepairSystemPrompt(command),
            prompt: buildRepairPrompt(event.text, validation.errors ?? []),
            tools,
            stopWhen: stepCountIs(3),
          });

          repairUsed = true;
          finalText = repair.text;
          finalOutput = parseStructuredOutput(repair.text);
          validation = validateOutput(finalOutput, command.output_schema);
        }

        await updateRunStatus(
          runRecord.id,
          "completed",
          {
            output: {
              text: finalText,
              structuredOutput: finalOutput,
              repairUsed,
              validation,
            },
            outputBlockIds,
            contextUsed,
            toolsUsed: Array.from(toolsUsed),
            schemaValidation: validation.valid
              ? repairUsed
                ? "passed_after_repair"
                : "passed"
              : "failed",
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

    return result.toUIMessageStreamResponse({
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
      { error: "Command run failed", details: serializeError(error) },
      { status: 500 }
    );
  }
}

function buildAllowedTools(params: {
  command: Command;
  body: CommandRequest;
  runId: string;
  outputBlockIds: string[];
  toolsUsed: Set<string>;
  existingOutputBlockIds: string[];
  serviceClient: ReturnType<typeof createServiceRoleClient>;
}): ToolSet {
  return filterNotebookTools(
    createNotebookTools({
      workspaceId: params.body.workspaceId,
      pageId: params.body.pageId,
      parentBlockId: params.body.triggerBlockId,
      currentRunId: params.runId,
      existingOutputBlockIds: params.existingOutputBlockIds,
      supabase: params.serviceClient,
      onBlockCreated: (block) => params.outputBlockIds.push(block.id),
      onToolUsed: (toolName) => params.toolsUsed.add(toolName),
    }),
    params.command.allowed_tools
  );
}

function createServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for command execution");
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
  const localModels = objectSetting(settings.localModels);
  const apiKeys = objectSetting(settings.apiKeys);

  return {
    id: data.id as string,
    modelProvider: stringSetting(settings, "modelProvider", "model_provider", "defaultModelProvider"),
    modelName: stringSetting(settings, "modelName", "model_name", "defaultModelName", "defaultModel"),
    modelOptions: {
      localBaseUrl:
        stringSetting(localModels, "ollamaUrl") ||
        stringSetting(localModels, "lmStudioUrl"),
      localModelName: stringSetting(localModels, "modelName"),
      apiKeys: {
        anthropic: stringSetting(apiKeys, "anthropic"),
        openai: stringSetting(apiKeys, "openai"),
        google: stringSetting(apiKeys, "google"),
      },
    } satisfies ModelOptions,
  };
}

async function getCommandForWorkspace(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  commandId: string,
  workspaceId: string
) {
  const { data, error } = await serviceClient
    .from("commands")
    .select()
    .eq("id", commandId)
    .eq("workspace_id", workspaceId)
    .eq("is_archived", false)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? (data as Command) : null;
}

async function assembleCommandContext(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  command: Command,
  body: CommandRequest
) {
  const config = command.context_config ?? {};
  const scope = stringSetting(config, "scope", "contextScope");
  const includePage = config.includePage === true || scope === "page";
  const blockIds = Array.isArray(config.blockIds)
    ? config.blockIds.filter((id): id is string => typeof id === "string")
    : [];

  const blocks: Block[] = [];

  if (includePage) {
    const { data, error } = await serviceClient
      .from("blocks")
      .select()
      .eq("workspace_id", body.workspaceId)
      .eq("page_id", body.pageId)
      .order("sort_order", { ascending: true });

    if (error) throw new Error(error.message);
    blocks.push(...((data ?? []) as Block[]));
  } else if (blockIds.length > 0) {
    const { data, error } = await serviceClient
      .from("blocks")
      .select()
      .eq("workspace_id", body.workspaceId)
      .in("id", blockIds)
      .order("sort_order", { ascending: true });

    if (error) throw new Error(error.message);
    blocks.push(...((data ?? []) as Block[]));
  }

  return {
    text: blocks.map(formatContextBlock).join("\n\n"),
    contextUsed: blocks.map((block) => ({
      type: block.type,
      id: block.id,
      label: block.type,
    })),
  };
}

function formatContextBlock(block: Block) {
  return `<context-block id="${block.id}" type="${block.type}">\n${safeStringify(
    block.content
  )}\n</context-block>`;
}

function buildCommandPrompt(
  prompt: string,
  inputContext: string,
  sourceContext: string,
  contextText: string
) {
  return [
    prompt,
    inputContext ? `Input variables:\n${inputContext}` : null,
    sourceContext ? `Sources:\n${sourceContext}` : null,
    contextText ? `Context:\n${contextText}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
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

function buildSystemPrompt(command: Command) {
  return [
    "You are running a saved command inside a command notebook.",
    "",
    "Rules:",
    "- Follow the command template precisely. Input variables are hard constraints, not suggestions.",
    "- If an input specifies a count (e.g. \"three\", \"5\"), produce exactly that many items — no more, no fewer.",
    "- Create at most ONE block per output type. If the command needs a table, call create_table once with the complete, consolidated table.",
    "- Do not create duplicate blocks with the same structure.",
    "- Keep your text response concise. Do not repeat information that is already in a created block.",
    "- Use only the tools made available for this command.",
    "",
    `Output schema:\n${safeStringify(command.output_schema)}`,
  ].join("\n");
}

function buildRepairSystemPrompt(command: Command) {
  return [
    "Repair the prior command output so it validates against the JSON Schema.",
    "Return only the corrected output, preferably as JSON.",
    `Output schema:\n${safeStringify(command.output_schema)}`,
  ].join("\n");
}

function buildRepairPrompt(previousOutput: string, errors: string[]) {
  return [
    "Previous output:",
    previousOutput,
    "",
    "Validation errors:",
    errors.join("\n"),
  ].join("\n");
}

function parseStructuredOutput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
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

function formatInputVariables(inputVariables: Record<string, unknown>) {
  return Object.entries(inputVariables)
    .map(([name, value]) => `- ${name} = ${formatVariableValue(value)}`)
    .join("\n");
}

function formatVariableValue(value: unknown) {
  return typeof value === "string" ? JSON.stringify(value) : safeStringify(value);
}

function escapeAttribute(value: string) {
  return value.replaceAll('"', "&quot;");
}

function stringifyTemplateInputs(
  values: Record<string, unknown>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === "string" ? value : safeStringify(value),
    ])
  );
}

function stringSetting(settings: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === "string" && value.length > 0) return value;
  }

  return undefined;
}

function objectSetting(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveBlockReferences(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  command: Command,
  inputs: Record<string, string>,
  workspaceId: string
): Promise<Record<string, string>> {
  const resolved = { ...inputs };

  for (const inputDef of command.inputs) {
    if (!isSourceInput(inputDef)) continue;
    const value = resolved[inputDef.name];
    if (!value || !UUID_RE.test(value)) continue;

    const { data } = await serviceClient
      .from("blocks")
      .select("*")
      .eq("id", value)
      .eq("workspace_id", workspaceId)
      .single();

    if (data) {
      resolved[inputDef.name] = extractBlockText(data as Block);
    }
  }

  return resolved;
}

function extractBlockText(block: Block): string {
  const c = block.content;
  if (!c) return "";

  switch (block.type) {
    case "text":
    case "heading":
    case "callout": {
      const doc = c.doc as string | undefined;
      return doc ? doc.replace(/<[^>]*>/g, "") : (c.text as string) || "";
    }
    case "table":
      return safeStringify({ columns: c.columns, rows: c.rows });
    case "json":
      return safeStringify(c.data);
    case "todo": {
      const items = c.items as Array<{ text: string; done: boolean }> | undefined;
      return items ? items.map((i) => `${i.done ? "[x]" : "[ ]"} ${i.text}`).join("\n") : "";
    }
    case "output":
      return typeof c.data === "string" ? c.data : safeStringify(c.data ?? c);
    case "ai_cell":
      return (c.prompt as string) || "";
    case "file":
      return (c.extracted_text as string) || `File: ${c.filename ?? "unknown"}`;
    case "bulleted_list":
    case "numbered_list": {
      const items = c.items as Array<{ text: string }> | undefined;
      return items ? items.map((i) => i.text).join("\n") : "";
    }
    case "source_card":
      return `${c.title ?? ""}\n${c.summary ?? ""}\nURL: ${c.url ?? ""}`;
    default:
      return safeStringify(c);
  }
}
