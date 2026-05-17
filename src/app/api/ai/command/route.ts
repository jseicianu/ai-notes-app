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
import { BlockType, getSourceConfig, isSourceInput } from "@/lib/models/types";
import { createClient } from "@/lib/supabase/server";
import { fillTemplate, validateInputs, validateOutput } from "@/services/command-service";
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
import { ensureTextOutputBlock } from "@/services/text-output-block-service";

export const runtime = "nodejs";

const requestSchema = z.object({
  commandId: z.string().uuid(),
  inputs: z.record(z.string(), z.string()).default({}),
  existingOutputBlocks: z
    .array(
      z.object({
        id: z.string().uuid(),
        type: z.string(),
      })
    )
    .default([]),
  /** @deprecated Use existingOutputBlocks so reuse can be scoped by block type. */
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
        z.object({
          type: z.literal("image"),
          storageUrl: z.string().url(),
          mimeType: z.string(),
        }),
      ])
    )
    .default([]),
  agentMode: z.boolean().default(false),
  outputMode: z.enum(["replace", "append", "version"]).default("replace"),
  workspaceId: z.string().uuid(),
  pageId: z.string().uuid(),
  triggerBlockId: z.string().uuid(),
});

type CommandRequest = z.infer<typeof requestSchema>;
type ExistingOutputBlockRef = { id: string; type: BlockType };

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

  const validationErrors = validateInputs(command.inputs, body.inputs);
  if (validationErrors.length > 0) {
    return NextResponse.json(
      { error: "Validation failed", details: validationErrors },
      { status: 400 }
    );
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
  const steps: Array<Record<string, unknown>> = [];
  let cumulativeTokens = 0;
  const existingOutputBlocks =
    body.outputMode === "append"
      ? []
      : await resolveExistingOutputBlocks(serviceClient, body);

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
          existingOutputBlocks,
          agentMode: body.agentMode,
          outputMode: body.outputMode,
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
      existingOutputBlocks,
      serviceClient,
      tavilyApiKey: workspace.tavilyApiKey,
      openaiApiKey: workspace.modelOptions.apiKeys?.openai,
    });

    const commandPrompt = buildCommandPrompt(
      prompt,
      inputContext,
      formatResolvedSources(resolvedSources),
      context.text
    );
    const imageSources = resolvedSources.filter((source) => source.type === "image");
    const messages = buildMessages(commandPrompt, imageSources);

    const result = streamText({
      model: getModel(modelProvider, modelName, workspace.modelOptions),
      system: buildSystemPrompt(command, body),
      ...(messages ? { messages } : { prompt: commandPrompt }),
      tools,
      stopWhen: stepCountIs(body.agentMode ? 25 : 5),
      onStepFinish: (event) => {
        cumulativeTokens += event.usage?.totalTokens ?? 0;
        steps.push({
          stepNumber: event.stepNumber,
          toolCalls:
            event.toolCalls?.map((call) => ({
              name: call.toolName,
              args: call.input,
            })) ?? [],
          finishReason: event.finishReason,
          tokenUsage: event.usage
            ? {
                prompt: event.usage.inputTokens ?? 0,
                completion: event.usage.outputTokens ?? 0,
                total: event.usage.totalTokens ?? 0,
              }
            : null,
          warning:
            cumulativeTokens > 100000
              ? "Cumulative token guardrail exceeded"
              : undefined,
        });
      },
      onFinish: async (event) => {
        const firstOutput = parseStructuredOutput(event.text);
        let validation = validateOutput(firstOutput, command.output_schema);
        let finalText = event.text;
        let finalOutput = firstOutput;
        let repairUsed = false;
        const requestedOutput = getRequestedOutputInput(body.inputs);
        const hasNotebookOutput = outputBlockIds.length > 0 || toolsUsed.size > 0;

        if (!validation.valid && !hasNotebookOutput && !requestedOutput) {
          const repair = await generateText({
            model: getModel(modelProvider, modelName, workspace.modelOptions),
            system: buildRepairSystemPrompt(command),
            prompt: buildRepairPrompt(event.text, validation.errors ?? []),
            stopWhen: stepCountIs(3),
          });

          repairUsed = true;
          finalText = repair.text;
          finalOutput = parseStructuredOutput(repair.text);
          validation = validateOutput(finalOutput, command.output_schema);
        }

        const textOutputBlockId = await ensureTextOutputBlock({
          supabase: serviceClient,
          workspaceId: body.workspaceId,
          pageId: body.pageId,
          parentBlockId: body.triggerBlockId,
          text: event.text,
          outputMode: body.outputMode,
          existingOutputBlocks,
          outputBlockIds,
        });
        if (textOutputBlockId && !outputBlockIds.includes(textOutputBlockId)) {
          outputBlockIds.unshift(textOutputBlockId);
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
              steps,
            },
            outputBlockIds,
            contextUsed,
            toolsUsed: Array.from(toolsUsed),
            schemaValidation: validation.valid
              ? repairUsed
                ? "passed_after_repair"
                : "passed"
              : hasNotebookOutput
                ? "skipped_tool_output"
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
  existingOutputBlocks: ExistingOutputBlockRef[];
  serviceClient: ReturnType<typeof createServiceRoleClient>;
  tavilyApiKey?: string;
  openaiApiKey?: string;
}): ToolSet {
  return filterNotebookTools(
    createNotebookTools({
      workspaceId: params.body.workspaceId,
      pageId: params.body.pageId,
      parentBlockId: params.body.triggerBlockId,
      currentRunId: params.runId,
      existingOutputBlocks:
        params.body.outputMode === "append" ? [] : params.existingOutputBlocks,
      supabase: params.serviceClient,
      tavilyApiKey: params.tavilyApiKey,
      openaiApiKey: params.openaiApiKey,
      outputMode: params.body.outputMode,
      onBlockCreated: (block) => params.outputBlockIds.push(block.id),
      onToolUsed: (toolName) => params.toolsUsed.add(toolName),
    }),
    constrainCreateToolsForRequestedOutput(
      params.command.allowed_tools,
      params.body.inputs
    )
  );
}

const CREATE_OUTPUT_TOOL_NAMES = new Set([
  "create_text_output",
  "create_table",
  "create_json",
  "create_todo",
  "create_bulleted_list",
  "create_numbered_list",
  "create_callout",
  "create_source_card",
  "create_code_output",
  "generate_image",
]);

function constrainCreateToolsForRequestedOutput(
  allowedTools: string[],
  inputs: Record<string, string>
) {
  const requested = getRequestedOutputInput(inputs);
  const requestedCreateTools = getCreateToolsForRequestedOutput(requested);
  if (!requestedCreateTools) return allowedTools;

  return allowedTools.filter(
    (toolName) =>
      !CREATE_OUTPUT_TOOL_NAMES.has(toolName) ||
      requestedCreateTools.has(toolName)
  );
}

function getRequestedOutputInput(inputs: Record<string, string>) {
  return String(
    inputs.output ??
      inputs.output_type ??
      inputs.outputType ??
      inputs.format ??
      ""
  ).trim();
}

function getCreateToolsForRequestedOutput(requestedOutput: string) {
  const normalized = requestedOutput.toLowerCase();
  if (!normalized) return null;

  const tools = new Set(["create_text_output"]);
  if (/\b(table|spreadsheet|grid)\b/.test(normalized)) {
    tools.add("create_table");
    return tools;
  }
  if (/\b(to-?do|todo|checklist|task list|action items?)\b/.test(normalized)) {
    tools.add("create_todo");
    return tools;
  }
  if (/\b(json|object|structured data)\b/.test(normalized)) {
    tools.add("create_json");
    return tools;
  }
  if (/\b(bullets?|bullet list)\b/.test(normalized)) {
    tools.add("create_bulleted_list");
    return tools;
  }
  if (/\b(numbered|ordered list)\b/.test(normalized)) {
    tools.add("create_numbered_list");
    return tools;
  }
  if (/\b(callout|note|warning|info)\b/.test(normalized)) {
    tools.add("create_callout");
    return tools;
  }
  if (/\b(source card|source)\b/.test(normalized)) {
    tools.add("create_source_card");
    return tools;
  }
  if (/\b(code|script|snippet|function|program)\b/.test(normalized)) {
    tools.add("create_code_output");
    return tools;
  }
  if (/\b(image|picture|illustration|diagram|logo|photo|graphic|visual|drawing|artwork)\b/.test(normalized)) {
    tools.add("generate_image");
    return tools;
  }

  return null;
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

async function resolveExistingOutputBlocks(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  body: CommandRequest
): Promise<ExistingOutputBlockRef[]> {
  if (body.existingOutputBlocks.length > 0) {
    return body.existingOutputBlocks.flatMap((block) => {
      const parsedType = BlockType.safeParse(block.type);
      return parsedType.success ? [{ id: block.id, type: parsedType.data }] : [];
    });
  }

  if (body.existingOutputBlockIds.length === 0) {
    const { data, error } = await serviceClient
      .from("blocks")
      .select("id,type")
      .eq("workspace_id", body.workspaceId)
      .eq("page_id", body.pageId)
      .eq("parent_block_id", body.triggerBlockId)
      .order("sort_order", { ascending: true });

    if (error) throw new Error(error.message);

    return ((data ?? []) as Array<{ id: string; type: string }>).flatMap((block) => {
      const parsedType = BlockType.safeParse(block.type);
      return parsedType.success ? [{ id: block.id, type: parsedType.data }] : [];
    });
  }

  const { data, error } = await serviceClient
    .from("blocks")
    .select("id,type")
    .eq("workspace_id", body.workspaceId)
    .eq("page_id", body.pageId)
    .eq("parent_block_id", body.triggerBlockId)
    .in("id", body.existingOutputBlockIds);

  if (error) throw new Error(error.message);

  const blocksById = new Map(
    ((data ?? []) as Array<{ id: string; type: string }>).map((block) => [
      block.id,
      block.type,
    ])
  );

  return body.existingOutputBlockIds.flatMap((id) => {
    const type = blocksById.get(id);
    const parsedType = BlockType.safeParse(type);
    return parsedType.success ? [{ id, type: parsedType.data }] : [];
  });
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
    tavilyApiKey:
      stringSetting(settings, "tavily_api_key", "tavilyApiKey") ||
      stringSetting(apiKeys, "tavily", "tavily_api_key", "tavilyApiKey"),
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

function buildMessages(prompt: string, imageSources: ResolvedSource[]) {
  if (imageSources.length === 0) return null;

  return [
    {
      role: "user",
      content: [
        { type: "text" as const, text: prompt },
        ...imageSources.map((source) => ({
          type: "image" as const,
          image: source.metadata?.url ?? "",
        })),
      ],
    },
  ] as Parameters<typeof streamText>[0]["messages"];
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

function buildSystemPrompt(command: Command, body: CommandRequest) {
  const requestedOutput = getRequestedOutputInput(body.inputs);
  return [
    "You are running a saved command inside a command notebook.",
    "",
    "Rules:",
    "- Follow the command template precisely. Input variables are hard constraints, not suggestions.",
    requestedOutput
      ? `- The requested output format is "${requestedOutput}". This overrides stale descriptions, schemas, and previous runs. Do not create other output block types.`
      : null,
    "- If an input specifies a count (e.g. \"three\", \"5\"), produce exactly that many items — no more, no fewer.",
    "- Create at most ONE block per output type. If the command needs a table, call create_table once with the complete, consolidated table.",
    "- If the command asks for an image, picture, logo, illustration, or other visual output, use generate_image. Do not say you cannot create images unless that tool returns an error.",
    "- Do not create duplicate blocks with the same structure.",
    "- Do not use markdown tables in streamed text responses. If information needs rows and columns, use create_table when table output is requested. For tiny examples or comparisons, use short bullets or inline pairs like \"1 -> A, 13 -> M\".",
    "- Be concise. Keep your text response short — a few sentences max. Do not repeat information that is already in a created block.",
    "- Use only the tools made available for this command.",
    "- When using web_scrape, the source card has the full content. Only write a brief 2-3 sentence summary in your text response.",
    "",
    requestedOutput ? null : `Output schema:\n${safeStringify(command.output_schema)}`,
  ].filter(Boolean).join("\n");
}

function buildRepairSystemPrompt(command: Command) {
  return [
    "Repair the prior command output so it validates against the JSON Schema.",
    "Return only the corrected output, preferably as JSON.",
    `Output schema:\n${safeStringify(command.output_schema)}`,
  ].join("\n");
}

function buildRepairPrompt(
  previousOutput: string,
  errors: Array<{ path: string; message: string; expected: string; actual: string }>
) {
  return [
    "Previous output:",
    previousOutput,
    "",
    "Validation errors:",
    errors
      .map((error) => `${error.path}: ${error.message} (expected ${error.expected}, got ${error.actual})`)
      .join("\n"),
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
    case "code":
      return `\`\`\`${(c.language as string) || "plain"}\n${(c.code as string) || ""}\n\`\`\``;
    default:
      return safeStringify(c);
  }
}
