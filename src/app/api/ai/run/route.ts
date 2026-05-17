import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { streamText, stepCountIs, type LanguageModelUsage } from "ai";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { BlockType, type AiCellContextMode, type Run } from "@/lib/models/types";
import { createClient } from "@/lib/supabase/server";
import { getModel, type ModelOptions } from "@/services/model-service";
import { saveBlockVersion } from "@/services/block-version-service";
import {
  createJsonBlock,
  createNotebookTools,
  createTableBlock,
  createTodoBlock,
  readInputValues,
  readControlPanelSources,
  updateJsonBlock,
  updateTableBlock,
  updateTodoBlock,
} from "@/services/notebook-tools";
import { createRun, updateRunStatus } from "@/services/run-service";
import { ensureTextOutputBlock } from "@/services/text-output-block-service";
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
  contextMode: z.enum(["selected_sources", "blocks_above", "none"]).default("selected_sources"),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
        runId: z.string().optional(),
      })
    )
    .default([]),
  refinementTarget: z
    .object({
      runId: z.string().uuid().optional(),
      triggerBlockId: z.string().uuid(),
      outputBlocks: z.array(
        z.object({
          id: z.string().uuid(),
          type: BlockType,
          content: z.unknown(),
        })
      ),
    })
    .optional(),
  pageId: z.string().uuid(),
  triggerBlockId: z.string().uuid(),
  workspaceId: z.string().uuid(),
});

type RunRequest = z.infer<typeof requestSchema>;
type ExistingOutputBlockRef = { id: string; type: BlockType };
const MAX_CONVERSATION_MESSAGES = 20;
const ACTIVE_RUN_STATUSES = ["pending", "running"];

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
  const steps: Array<Record<string, unknown>> = [];
  let cumulativeTokens = 0;
  let runFinished = false;
  const inputVariables =
    body.contextMode === "none"
      ? {}
      : await readInputValues(
          serviceClient,
          body.workspaceId,
          body.pageId
        );
  const controlPanelSources =
    body.contextMode === "none"
      ? []
      : await readControlPanelSources(
          serviceClient,
          body.workspaceId,
          body.pageId
        );
  const allSourceRefs: SourceReference[] = [
    ...(body.sources as SourceReference[]),
    ...controlPanelSources,
  ];
  const resolvedSources =
    body.contextMode !== "none" && allSourceRefs.length > 0
      ? await resolveSources(allSourceRefs, body.workspaceId)
      : [];
  const effectiveContextBlocks =
    shouldIncludeContextBlocks(body.contextMode) ? body.contextBlocks : [];
  const existingOutputBlocks =
    body.outputMode === "append"
      ? []
      : await resolveExistingOutputBlocks(serviceClient, body);
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
    ...effectiveContextBlocks.map((block, index) => ({
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
          contextMode: body.contextMode,
          contextBlocks: effectiveContextBlocks,
          inputVariables,
          sources: body.sources,
          resolvedSources: summarizeResolvedSources(resolvedSources),
          existingOutputBlocks,
          outputTypeHint: body.outputTypeHint,
          agentMode: body.agentMode,
          outputMode: body.outputMode,
          conversationHistory: body.conversationHistory.slice(-MAX_CONVERSATION_MESSAGES),
          refinementTarget: body.refinementTarget,
        },
        modelProvider: body.modelProvider,
        modelName: body.modelName,
      },
      serviceClient
    );

    const runRecord = run;
    const prompt = buildUserPrompt(body, inputVariables, resolvedSources, effectiveContextBlocks);
    const imageSources = resolvedSources.filter((source) => source.type === "image");
    const messages = buildMessages(body, prompt, imageSources);
    const notebookToolContext = {
      workspaceId: body.workspaceId,
      pageId: body.pageId,
      parentBlockId: body.triggerBlockId,
      currentRunId: runRecord.id,
      existingOutputBlocks,
      supabase: serviceClient,
      tavilyApiKey: workspace.tavilyApiKey,
      openaiApiKey: workspace.modelOptions.apiKeys?.openai,
      outputMode: body.outputMode,
      onBlockCreated: (block: { id: string }) => outputBlockIds.push(block.id),
      onToolUsed: (toolName: string) => toolsUsed.add(toolName),
    };
    const useLocalBridge = body.modelProvider === "local";
    const result = streamText({
      model: getModel(body.modelProvider, body.modelName, workspace.modelOptions),
      system: buildSystemPrompt(body),
      ...(messages ? { messages } : { prompt }),
      abortSignal: request.signal,
      ...(useLocalBridge ? {} : { tools: createNotebookTools(notebookToolContext) }),
      stopWhen: stepCountIs(body.agentMode ? 25 : 5),
      onStepFinish: async (event) => {
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

        if (!runFinished) {
          await serviceClient
            .from("runs")
            .update({
              output: { steps, inProgress: true },
              tools_used: Array.from(toolsUsed),
            })
            .eq("id", runRecord.id)
            .in("status", ACTIVE_RUN_STATUSES);
        }
      },
      onFinish: async (event) => {
        runFinished = true;
        if (!(await isRunStillActive(serviceClient, runRecord.id))) {
          return;
        }

        if (useLocalBridge) {
          await processLocalModelArtifacts({
            body,
            eventText: event.text,
            outputBlockIds,
            serviceClient,
            toolsUsed,
            toolContext: notebookToolContext,
          });
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
              text: event.text,
              finishReason: event.finishReason,
              steps,
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
        if (!(await isRunStillActive(serviceClient, runRecord.id))) {
          return;
        }

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
      if (await isRunStillActive(serviceClient, run.id)) {
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

async function isRunStillActive(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  runId: string
): Promise<boolean> {
  const { data, error } = await serviceClient
    .from("runs")
    .select("status")
    .eq("id", runId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return ACTIVE_RUN_STATUSES.includes(data?.status as string);
}

async function resolveExistingOutputBlocks(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  body: RunRequest
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
  return {
    id: data.id as string,
    modelOptions: getModelOptionsFromSettings(settings),
    tavilyApiKey:
      stringValue(settings.tavily_api_key) ||
      stringValue(settings.tavilyApiKey) ||
      stringValue(objectSetting(settings.apiKeys).tavily),
  };
}

function buildSystemPrompt(body: RunRequest) {
  const agent = body.agentMode
    ? [
        "You are an autonomous agent working in a notebook. You can plan your approach before executing, use multiple tools in sequence to accomplish complex tasks, search the workspace and web, create multiple output blocks, and self-correct if a tool call fails.",
        "Work step by step. After each tool use, evaluate whether you're making progress. If not, try a different approach.",
        "Constraints: maximum 25 tool calls per run. Always explain what you're doing before using a tool. If you're unsure, ask rather than guess.",
      ]
    : [];

  return [
    ...agent,
    "You are an AI cell inside a command notebook. You produce direct, useful output — no preamble, no sign-offs, no meta-commentary.",
    "",
    "Response style:",
    "- Be concise. Default to short, dense answers — a few sentences or a short bulleted list.",
    "- Only produce long-form output when the user explicitly asks for detail, a deep dive, a full analysis, or a comprehensive summary.",
    "- Use markdown formatting (bullet lists, headers, bold) to make output scannable.",
    "- Do not use markdown tables in streamed text responses. If information needs rows and columns, create a table block with create_table. For tiny examples or comparisons, use short bullets or inline pairs like \"1 -> A, 13 -> M\".",
    "- Never say things like 'Here is...', 'Let me know if...', or 'I hope this helps'. Just output the result.",
    "",
    "Tool usage:",
    "- IMPORTANT: Always respond with streamed text. Do NOT use tools to create ordinary prose output blocks — write prose directly in your response.",
    "- Use notebook tools when the user asks to create or convert output into a structured notebook artifact such as a table, JSON object, todo list, bulleted list, numbered list, callout, source card, code block, or image.",
    "- When asked to generate, create, draw, design, or illustrate an image, call generate_image. Do not say you cannot create images unless the tool is unavailable or returns an error.",
    "- Only create a table block when the user explicitly asks for a table or clearly requests tabular/structured comparison output. If the user asks to turn or convert prior output into a table, call create_table exactly once with the complete table. Use concise column names and rows that preserve the original meaning.",
    "- When asked to modify an existing block, use update_table, update_json, update_todo, or update_block with the block ID from the refinement target.",
    "- Only create new blocks when the user asks for something that does not already exist in the refinement target.",
    "- After any successful tool call, respond with one short confirmation sentence so the UI receives non-empty streamed text.",
    "- When you use the web_scrape tool, it creates a source card block on the page with the full content. Your text response should be a brief 2-3 sentence summary only — do not repeat or regurgitate the scraped content. The source card already has it.",
    "- When you use the youtube_transcript tool, it creates a source card with the transcript. Summarize briefly in your text response — do not reproduce the transcript.",
    body.modelProvider === "local"
      ? [
          "",
          "Local artifact bridge mode:",
          "- You do not have native tool calls. The app will convert your streamed markdown into notebook blocks after you finish.",
          "- For table requests, output one complete markdown table and no surrounding prose.",
          "- Do not output markdown tables for non-table requests.",
          "- For JSON requests, output one fenced ```json block with valid JSON and no surrounding prose.",
          "- For todo/checklist requests, output checkbox lines in the form '- [ ] Task' or '- [x] Done task'.",
          "- For text-only refinements, output only the revised text.",
        ].join("\n")
      : null,
    body.outputTypeHint
      ? `The requested output type hint is: ${body.outputTypeHint}.`
      : null,
    body.refinementTarget ? formatRefinementTarget(body.refinementTarget) : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatRefinementTarget(target: NonNullable<RunRequest["refinementTarget"]>) {
  const blocks = target.outputBlocks
    .map((block, index) =>
      [
        `<output-block index="${index + 1}" id="${block.id}" type="${block.type}">`,
        safeStringify(block.content),
        "</output-block>",
      ].join("\n")
    )
    .join("\n\n");

  return [
    "",
    "Refinement target:",
    `Previous run ID: ${target.runId ?? "unknown"}`,
    `Trigger AI cell block ID: ${target.triggerBlockId}`,
    "Your previous run created these blocks. Use their IDs when editing in-place:",
    blocks || "(No output blocks provided.)",
  ].join("\n");
}

function buildMessages(
  body: RunRequest,
  prompt: string,
  imageSources: ResolvedSource[]
) {
  if (body.conversationHistory.length === 0 && imageSources.length === 0) {
    return null;
  }

  return [
    ...body.conversationHistory.slice(-MAX_CONVERSATION_MESSAGES).map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    {
      role: "user",
      content:
        imageSources.length > 0
          ? [
              { type: "text" as const, text: prompt },
              ...imageSources.map((source) => ({
                type: "image" as const,
                image: source.metadata?.url ?? "",
              })),
            ]
          : prompt,
    },
  ] as Parameters<typeof streamText>[0]["messages"];
}

type RefinementOutputBlock = NonNullable<
  RunRequest["refinementTarget"]
>["outputBlocks"][number];

type TableArtifact = {
  columns: string[];
  rows: Array<Record<string, string>>;
};

type TodoArtifact = Array<{
  text: string;
  done: boolean;
}>;

const tableArtifactSchema = z.object({
  columns: z.array(z.string().min(1)).min(1),
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
});

async function processLocalModelArtifacts(params: {
  body: RunRequest;
  eventText: string;
  outputBlockIds: string[];
  serviceClient: ReturnType<typeof createServiceRoleClient>;
  toolsUsed: Set<string>;
  toolContext: Parameters<typeof createTableBlock>[0];
}) {
  const text = params.eventText.trim();
  if (!text) return;

  const table = parseTableArtifact(text);
  if (table) {
    const existingTable = findRefinementBlock(params.body, "table");
    if (existingTable) {
      await updateTableBlock(
        params.toolContext,
        existingTable.id,
        table.columns,
        table.rows
      );
    } else {
      await createTableBlock(params.toolContext, table.columns, table.rows);
    }
    return;
  }

  const todos = parseTodoArtifact(text);
  if (todos) {
    const existingTodo = findRefinementBlock(params.body, "todo");
    if (existingTodo) {
      await updateTodoBlock(params.toolContext, existingTodo.id, todos);
    } else {
      await createTodoBlock(params.toolContext, todos);
    }
    return;
  }

  const json = parseJsonArtifact(text);
  if (json) {
    const existingJson = findRefinementBlock(params.body, "json");
    if (existingJson) {
      await updateJsonBlock(params.toolContext, existingJson.id, json);
    } else {
      await createJsonBlock(params.toolContext, json);
    }
    return;
  }

  const existingTextOutput = findRefinementBlock(params.body, "output");
  if (existingTextOutput) {
    await updateTextOutputBlock({
      body: params.body,
      blockId: existingTextOutput.id,
      text,
      outputBlockIds: params.outputBlockIds,
      serviceClient: params.serviceClient,
      toolsUsed: params.toolsUsed,
    });
  }
}

function findRefinementBlock(
  body: RunRequest,
  ...types: BlockType[]
): RefinementOutputBlock | undefined {
  return body.refinementTarget?.outputBlocks.find((block) =>
    types.includes(block.type)
  );
}

async function updateTextOutputBlock(params: {
  body: RunRequest;
  blockId: string;
  text: string;
  outputBlockIds: string[];
  serviceClient: ReturnType<typeof createServiceRoleClient>;
  toolsUsed: Set<string>;
}) {
  if (params.body.outputMode === "version") {
    await saveBlockVersion(params.blockId, params.serviceClient);
  }
  const { data, error } = await params.serviceClient
    .from("blocks")
    .update({
      type: "output",
      content: { format: "text", data: params.text },
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.blockId)
    .eq("workspace_id", params.body.workspaceId)
    .eq("page_id", params.body.pageId)
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  if (data?.id) params.outputBlockIds.push(data.id as string);
  params.toolsUsed.add("update_block");
}

function parseTableArtifact(text: string): TableArtifact | null {
  return parseMarkdownTable(text) ?? parseJsonTable(text);
}

function parseMarkdownTable(text: string): TableArtifact | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes("|") || !isMarkdownTableSeparator(lines[index + 1])) {
      continue;
    }

    const columns = splitMarkdownTableRow(lines[index])
      .map((column) => column.trim())
      .filter(Boolean);
    if (columns.length === 0) continue;

    const rows: Array<Record<string, string>> = [];
    for (const line of lines.slice(index + 2)) {
      if (!line.includes("|") || isMarkdownTableSeparator(line)) break;
      const cells = splitMarkdownTableRow(line);
      if (cells.length !== columns.length) break;

      const row: Record<string, string> = {};
      columns.forEach((column, columnIndex) => {
        row[column] = cells[columnIndex]?.trim() ?? "";
      });
      rows.push(row);
    }

    if (rows.length > 0) return { columns, rows };
  }

  return null;
}

function splitMarkdownTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line);
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")))
  );
}

function parseJsonTable(text: string): TableArtifact | null {
  for (const value of parseJsonCandidates(text)) {
    const parsed = tableArtifactSchema.safeParse(value);
    if (!parsed.success) continue;

    const columns = parsed.data.columns.map((column) => column.trim()).filter(Boolean);
    if (columns.length === 0) continue;

    const rows = parsed.data.rows.map((row) => {
      const normalizedRow: Record<string, string> = {};
      for (const column of columns) {
        normalizedRow[column] = String(row[column] ?? "");
      }
      return normalizedRow;
    });

    if (rows.length > 0) return { columns, rows };
  }

  return null;
}

function parseJsonArtifact(text: string): Record<string, unknown> | null {
  for (const value of parseJsonCandidates(text)) {
    if (tableArtifactSchema.safeParse(value).success) continue;
    if (Array.isArray(value) && value.length > 0) return { items: value };
    if (isPlainRecord(value)) return value;
  }

  return null;
}

function parseJsonCandidates(text: string): unknown[] {
  const candidates: string[] = [];
  const fencedJson = text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const match of fencedJson) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }

  const objectSlice = extractJsonSlice(text, "{", "}");
  if (objectSlice) candidates.push(objectSlice);

  const arraySlice = extractJsonSlice(text, "[", "]");
  if (arraySlice) candidates.push(arraySlice);

  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) candidates.push(trimmed);

  const values: unknown[] = [];
  for (const candidate of [...new Set(candidates)]) {
    try {
      values.push(JSON.parse(candidate));
    } catch {
      // Ignore malformed candidates; the plain streamed text remains available.
    }
  }

  return values;
}

function extractJsonSlice(text: string, open: "{" | "[", close: "}" | "]") {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start >= 0 && end > start ? text.slice(start, end + 1).trim() : "";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseTodoArtifact(text: string): TodoArtifact | null {
  const items = text
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[-*]|\d+\.)\s+\[([ xX])\]\s+(.+?)\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      done: match[1].toLowerCase() === "x",
      text: match[2].trim(),
    }))
    .filter((item) => item.text.length > 0);

  return items.length > 0 ? items : null;
}

function buildUserPrompt(
  body: RunRequest,
  inputVariables: Record<string, unknown>,
  resolvedSources: ResolvedSource[],
  contextBlocks: RunRequest["contextBlocks"]
) {
  const inputs = body.contextMode === "none" ? "" : formatInputVariables(inputVariables);
  const sources = body.contextMode === "none" ? "" : formatResolvedSources(resolvedSources);
  const context =
    shouldIncludeContextBlocks(body.contextMode) ? assembleContext(contextBlocks) : "";
  const sections = [
    body.prompt,
    inputs ? `Input variables:\n${inputs}` : null,
    sources ? `Sources:\n${sources}` : null,
    context ? `Context blocks:\n${context}` : null,
  ].filter(Boolean);

  return sections.join("\n\n");
}

function shouldIncludeContextBlocks(mode: AiCellContextMode) {
  return mode === "blocks_above";
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
