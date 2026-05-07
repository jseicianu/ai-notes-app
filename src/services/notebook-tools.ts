import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText, stepCountIs, tool, type LanguageModelUsage, type ToolSet } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Block, BlockType, Command } from "@/lib/models/types";
import { saveBlockVersion } from "@/services/block-version-service";
import { fillTemplate, validateOutput } from "@/services/command-service";
import { searchWorkspace } from "@/services/embedding-service";
import { getModel, type ModelOptions } from "@/services/model-service";
import { createRun, updateRunStatus } from "@/services/run-service";
import { webScrape, webSearch } from "@/services/web-tools";

export interface NotebookToolsContext {
  workspaceId: string;
  pageId: string;
  parentBlockId: string;
  currentRunId: string;
  existingOutputBlockIds?: string[];
  supabase?: SupabaseClient;
  onBlockCreated?: (block: Block) => void;
  onToolUsed?: (toolName: string) => void;
}

async function getSupabase(client?: SupabaseClient) {
  return client ?? (await createClient());
}

async function getNextSortOrder(
  supabase: SupabaseClient,
  pageId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("blocks")
    .select("sort_order")
    .eq("page_id", pageId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return typeof data?.sort_order === "number" ? data.sort_order + 1 : 0;
}

async function insertBlock(
  context: NotebookToolsContext,
  toolName: string,
  type: BlockType,
  content: Record<string, unknown>,
  existingBlockId?: string
) {
  const supabase = await getSupabase(context.supabase);
  await validateParentBlock(context, supabase);

  if (existingBlockId) {
    const block = await updateExistingOutputBlock(
      supabase,
      context,
      existingBlockId,
      type,
      content
    );

    context.onToolUsed?.(toolName);
    context.onBlockCreated?.(block);

    return {
      blockId: block.id,
      type: block.type,
      content: block.content,
    };
  }

  const sortOrder = await getNextSortOrder(supabase, context.pageId);
  const { data, error } = await supabase
    .from("blocks")
    .insert({
      workspace_id: context.workspaceId,
      page_id: context.pageId,
      parent_block_id: context.parentBlockId,
      sort_order: sortOrder,
      type,
      content,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  const block = data as Block;
  context.onToolUsed?.(toolName);
  context.onBlockCreated?.(block);

  return {
    blockId: block.id,
    type: block.type,
    content: block.content,
  };
}

async function updateExistingOutputBlock(
  supabase: SupabaseClient,
  context: NotebookToolsContext,
  blockId: string,
  type: BlockType,
  content: Record<string, unknown>
) {
  const { data: existing, error: readError } = await supabase
    .from("blocks")
    .select("id,workspace_id,page_id,type,content")
    .eq("id", blockId)
    .eq("workspace_id", context.workspaceId)
    .eq("page_id", context.pageId)
    .single();

  if (readError || !existing) {
    throw new Error("Existing output block not found in workspace");
  }

  await saveBlockVersion(blockId, supabase);

  const { data, error } = await supabase
    .from("blocks")
    .update({
      type,
      content,
      updated_at: new Date().toISOString(),
    })
    .eq("id", blockId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Block;
}

async function validateParentBlock(
  context: NotebookToolsContext,
  supabase: SupabaseClient
) {
  if (!context.parentBlockId) return;

  const { data, error } = await supabase
    .from("blocks")
    .select("id")
    .eq("id", context.parentBlockId)
    .eq("workspace_id", context.workspaceId)
    .single();

  if (error || !data) {
    throw new Error("Parent block not found in workspace");
  }
}

export function filterNotebookTools(
  tools: ToolSet,
  allowedTools: string[] = []
): ToolSet {
  const allowed = new Set(allowedTools);

  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => allowed.has(name))
  ) as ToolSet;
}

export function createNotebookTools(context: NotebookToolsContext): ToolSet {
  const reusableOutputBlockIds = [...(context.existingOutputBlockIds ?? [])];
  const nextExistingBlockId = () => reusableOutputBlockIds.shift();

  return {
    create_text_output: tool({
      description: "Create a text output block linked to the current AI cell.",
      inputSchema: z.object({
        content: z.string().describe("The text content to write into the output block."),
      }),
      execute: ({ content }) =>
        insertBlock(context, "create_text_output", "output", {
          format: "text",
          data: content,
        }, nextExistingBlockId()),
    }),

    create_table: tool({
      description: "Create a table block linked to the current AI cell. Call this exactly once with the complete, consolidated table. Do not split data across multiple table calls.",
      inputSchema: z.object({
        columns: z.array(z.string()).min(1),
        rows: z.array(z.record(z.string(), z.string())),
      }),
      execute: ({ columns, rows }) =>
        insertBlock(context, "create_table", "table", { columns, rows }, nextExistingBlockId()),
    }),

    create_json: tool({
      description: "Create a JSON output block linked to the current AI cell.",
      inputSchema: z.object({
        data: z.record(z.string(), z.unknown()),
        label: z.string().optional(),
      }),
      execute: ({ data, label }) =>
        insertBlock(context, "create_json", "json", {
          data,
          ...(label ? { label } : {}),
        }, nextExistingBlockId()),
    }),

    create_todo: tool({
      description: "Create a todo block linked to the current AI cell.",
      inputSchema: z.object({
        items: z.array(
          z.object({
            text: z.string(),
            done: z.boolean(),
          })
        ),
      }),
      execute: ({ items }) =>
        insertBlock(context, "create_todo", "todo", { items }, nextExistingBlockId()),
    }),

    create_bulleted_list: tool({
      description: "Create a bulleted list block linked to the current AI cell.",
      inputSchema: z.object({
        items: z.array(z.string()).min(1),
      }),
      execute: ({ items }) =>
        insertBlock(context, "create_bulleted_list", "bulleted_list", {
          doc: `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
        }, nextExistingBlockId()),
    }),

    create_numbered_list: tool({
      description: "Create a numbered list block linked to the current AI cell.",
      inputSchema: z.object({
        items: z.array(z.string()).min(1),
      }),
      execute: ({ items }) =>
        insertBlock(context, "create_numbered_list", "numbered_list", {
          doc: `<ol>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`,
        }, nextExistingBlockId()),
    }),

    create_callout: tool({
      description: "Create a callout block linked to the current AI cell.",
      inputSchema: z.object({
        type: z.enum(["info", "warning", "tip", "error"]),
        content: z.string(),
      }),
      execute: ({ type, content }) =>
        insertBlock(context, "create_callout", "callout", {
          type,
          doc: content,
        }, nextExistingBlockId()),
    }),

    create_source_card: tool({
      description: "Create a source card block linked to the current AI cell.",
      inputSchema: z.object({
        url: z.string().url(),
        title: z.string(),
        summary: z.string(),
      }),
      execute: ({ url, title, summary }) =>
        insertBlock(context, "create_source_card", "source_card", {
          url,
          title,
          summary,
          scraped_at: new Date().toISOString(),
        }, nextExistingBlockId()),
    }),

    run_command: tool({
      description: "Run a saved callable command by slug and return structured output.",
      inputSchema: z.object({
        slug: z.string().describe("Command slug, e.g. 'extract-research'"),
        inputs: z.record(z.string(), z.string()).describe("Input values for the command"),
      }),
      execute: async ({ slug, inputs }) => {
        context.onToolUsed?.("run_command");
        const supabase = await getSupabase(context.supabase);
        const { data, error } = await supabase
          .from("commands")
          .select()
          .eq("workspace_id", context.workspaceId)
          .eq("slug", slug)
          .eq("is_archived", false)
          .single();

        if (error || !data) throw new Error(`Command not found: ${slug}`);

        const command = data as Command;
        if (!command.is_callable) {
          throw new Error(`Command is not callable: ${slug}`);
        }

        return runCallableCommand(command, inputs, context, supabase);
      },
    }),

    web_search: tool({
      description: "Search the web for information.",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
      }),
      execute: async ({ query }) => {
        context.onToolUsed?.("web_search");
        return webSearch(query, { maxResults: 5 });
      },
    }),

    web_scrape: tool({
      description: "Fetch and extract readable content from a URL.",
      inputSchema: z.object({
        url: z.string().url().describe("URL to scrape"),
      }),
      execute: async ({ url }) => {
        const result = await webScrape(url);
        await insertBlock(context, "web_scrape", "source_card", {
          url: result.url,
          title: result.title,
          summary: result.content.slice(0, 1200),
          scraped_at: result.scrapedAt,
        }, nextExistingBlockId());
        return result;
      },
    }),

    search_workspace: tool({
      description: "Search embedded workspace content using semantic similarity.",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      execute: async ({ query, limit }) => {
        context.onToolUsed?.("search_workspace");
        return searchWorkspace({
          workspaceId: context.workspaceId,
          query,
          limit: limit ?? 5,
        });
      },
    }),

    read_inputs: tool({
      description: "Read all input block values from a page in the current workspace.",
      inputSchema: z.object({
        pageId: z.string().uuid(),
      }),
      execute: async ({ pageId }) => {
        const supabase = await getSupabase(context.supabase);
        const values = await readInputValues(supabase, context.workspaceId, pageId);
        context.onToolUsed?.("read_inputs");
        return values;
      },
    }),

    read_block: tool({
      description: "Read a block's content by ID from the current workspace.",
      inputSchema: z.object({
        blockId: z.string().uuid(),
      }),
      execute: async ({ blockId }) => {
        const supabase = await getSupabase(context.supabase);
        const { data, error } = await supabase
          .from("blocks")
          .select("id,type,content,parent_block_id,sort_order,created_at,updated_at")
          .eq("workspace_id", context.workspaceId)
          .eq("id", blockId)
          .single();

        if (error) throw new Error(error.message);
        context.onToolUsed?.("read_block");
        return data;
      },
    }),

    read_page: tool({
      description: "Read all block contents from a page in the current workspace.",
      inputSchema: z.object({
        pageId: z.string().uuid(),
      }),
      execute: async ({ pageId }) => {
        const supabase = await getSupabase(context.supabase);
        const { data, error } = await supabase
          .from("blocks")
          .select("id,type,content,parent_block_id,sort_order,created_at,updated_at")
          .eq("workspace_id", context.workspaceId)
          .eq("page_id", pageId)
          .order("sort_order", { ascending: true });

        if (error) throw new Error(error.message);
        context.onToolUsed?.("read_page");
        return data ?? [];
      },
    }),
  };
}

export async function readInputValues(
  supabase: SupabaseClient,
  workspaceId: string,
  pageId: string
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("blocks")
    .select("content,type")
    .eq("workspace_id", workspaceId)
    .eq("page_id", pageId)
    .in("type", ["input", "input_group"])
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);

  const values: Record<string, unknown> = {};

  for (const block of (data ?? []) as Array<{ content: Record<string, unknown>; type: string }>) {
    if (block.type === "input") {
      const name = inputVariableName(block.content);
      if (name) values[name] = block.content.value;
    } else if (block.type === "input_group") {
      const inputs = block.content.inputs as Array<{
        variable_name: string;
        input_type: string;
        value: unknown;
      }> | undefined;
      if (inputs) {
        for (const input of inputs) {
          if (input.variable_name && input.input_type !== "source") {
            values[input.variable_name] = input.value;
          }
        }
      }
    }
  }

  return values;
}

const sourceRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("block"), blockId: z.string().uuid() }),
  z.object({ type: z.literal("file"), fileId: z.string().uuid() }),
  z.object({ type: z.literal("url"), url: z.string().url() }),
  z.object({ type: z.literal("paste"), content: z.string() }),
  z.object({
    type: z.literal("rag"),
    query: z.string().min(1),
    limit: z.number().int().positive().optional(),
  }),
]);

export async function readControlPanelSources(
  supabase: SupabaseClient,
  workspaceId: string,
  pageId: string
): Promise<z.infer<typeof sourceRefSchema>[]> {
  const { data, error } = await supabase
    .from("blocks")
    .select("content")
    .eq("workspace_id", workspaceId)
    .eq("page_id", pageId)
    .eq("type", "input_group")
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);

  const sources: z.infer<typeof sourceRefSchema>[] = [];

  for (const block of (data ?? []) as Array<{ content: Record<string, unknown> }>) {
    const inputs = block.content.inputs as Array<{
      input_type: string;
      value: unknown;
    }> | undefined;
    if (!inputs) continue;

    for (const input of inputs) {
      if (input.input_type !== "source") continue;
      const items = input.value as Array<{ ref: unknown }> | undefined;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const parsed = sourceRefSchema.safeParse(item?.ref);
        if (parsed.success) sources.push(parsed.data);
      }
    }
  }

  return sources;
}

async function runCallableCommand(
  command: Command,
  inputs: Record<string, string>,
  context: NotebookToolsContext,
  supabase: SupabaseClient
) {
  const startedAt = Date.now();
  const prompt = fillTemplate(command.prompt_template, inputs);
  const modelDefaults = await getWorkspaceModelDefaults(supabase, context.workspaceId);
  const modelProvider =
    command.model_provider || modelDefaults.modelProvider || "anthropic";
  const modelName = command.model_name || modelDefaults.modelName || "";
  const outputBlockIds: string[] = [];
  const toolsUsed = new Set<string>();

  let runId: string | undefined;

  try {
    const run = await createRun(
      {
        workspaceId: context.workspaceId,
        pageId: context.pageId,
        triggerBlockId: context.parentBlockId,
        commandId: command.id,
        parentRunId: context.currentRunId,
        type: "command",
        input: { inputs, prompt },
        modelProvider,
        modelName,
      },
      supabase
    );

    runId = run.id;
    const tools = filterNotebookTools(
      createNotebookTools({
        ...context,
        currentRunId: run.id,
        existingOutputBlockIds: undefined,
        onBlockCreated: (block) => {
          outputBlockIds.push(block.id);
          context.onBlockCreated?.(block);
        },
        onToolUsed: (toolName) => toolsUsed.add(toolName),
      }),
      command.allowed_tools
    );

    const result = await generateText({
      model: getModel(modelProvider, modelName, modelDefaults.modelOptions),
      system: "You are running a saved command inside a notebook. Return output that matches the command schema.",
      prompt,
      tools,
      stopWhen: stepCountIs(5),
    });

    const structuredOutput = parseStructuredOutput(result.text);
    const validation = validateOutput(structuredOutput, command.output_schema);

    await updateRunStatus(
      run.id,
      "completed",
      {
        output: {
          text: result.text,
          structuredOutput,
          validation,
        },
        outputBlockIds,
        toolsUsed: Array.from(toolsUsed),
        schemaValidation: validation.valid ? "passed" : "failed",
        tokenUsage: normalizeUsage(result.totalUsage),
        durationMs: Date.now() - startedAt,
        completedAt: new Date().toISOString(),
      },
      supabase
    );

    return {
      commandId: command.id,
      slug: command.slug,
      output: structuredOutput,
      text: result.text,
      outputBlockIds,
      schemaValidation: validation,
    };
  } catch (error) {
    if (runId) {
      await updateRunStatus(
        runId,
        "failed",
        {
          error: serializeError(error),
          durationMs: Date.now() - startedAt,
          completedAt: new Date().toISOString(),
        },
        supabase
      );
    }

    throw error;
  }
}

async function getWorkspaceModelDefaults(
  supabase: SupabaseClient,
  workspaceId: string
) {
  const { data, error } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .single();

  if (error) return {};

  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const localModels = objectValue(settings.localModels);
  const apiKeys = objectValue(settings.apiKeys);

  return {
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

function stringSetting(settings: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === "string" && value.length > 0) return value;
  }

  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function inputVariableName(content: Record<string, unknown>) {
  const value = content.variable_name ?? content.variableName ?? content.name;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
