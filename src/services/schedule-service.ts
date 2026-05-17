import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { generateText, stepCountIs, type LanguageModelUsage } from "ai";
import { CronExpressionParser } from "cron-parser";
import type { Command, Run, Schedule } from "@/lib/models/types";
import { fillTemplate, validateInputs, validateOutput } from "@/services/command-service";
import {
  createNotebookTools,
  filterNotebookTools,
  readControlPanelSources,
  readInputValues,
} from "@/services/notebook-tools";
import { getModel } from "@/services/model-service";
import { createRun, updateRunStatus } from "@/services/run-service";
import { ensureTextOutputBlock } from "@/services/text-output-block-service";
import {
  getModelOptionsFromSettings,
  objectSetting,
  serializeError,
  stringSetting,
} from "@/services/api-utils";
import {
  resolveSources,
  type ResolvedSource,
  type SourceReference,
} from "@/services/source-service";

type ExistingOutputBlockRef = { id: string; type: string };

export function computeNextRun(
  cronExpression: string,
  timezone: string,
  after: Date = new Date()
): Date {
  const interval = CronExpressionParser.parse(cronExpression, {
    currentDate: after,
    tz: timezone,
  });
  return interval.next().toDate();
}

export async function runDueSchedules(): Promise<{
  checked: number;
  executed: number;
  failed: number;
}> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("is_active", true)
    .lte("next_run_at", new Date().toISOString());

  if (error) throw new Error(error.message);

  let executed = 0;
  let failed = 0;

  for (const schedule of (data ?? []) as Schedule[]) {
    try {
      const run = await executeScheduledCommand(supabase, schedule);
      await updateScheduleAfterRun(supabase, schedule, "completed", run.id);
      executed += 1;
    } catch (error) {
      failed += 1;
      await updateScheduleAfterRun(supabase, schedule, "failed", null, error);
    }
  }

  return { checked: data?.length ?? 0, executed, failed };
}

async function executeScheduledCommand(
  supabase: SupabaseClient,
  schedule: Schedule
): Promise<Run> {
  const startedAt = Date.now();
  const { command, workspace } = await loadScheduleContext(supabase, schedule);
  const targetPageId = schedule.target_page_id;
  if (!targetPageId) {
    throw new Error("Scheduled command has no target page.");
  }

  const preset = await loadPreset(supabase, schedule);
  const inputValues = normalizeStringRecord(
    Object.keys(schedule.input_values ?? {}).length > 0
      ? schedule.input_values
      : preset?.input_values
  );
  const sourceRefs = normalizeSourceRefs(
    Array.isArray(schedule.source_refs) && schedule.source_refs.length > 0
      ? schedule.source_refs
      : preset?.source_refs
  );

  const validationErrors = validateInputs(command.inputs, inputValues);
  if (validationErrors.length > 0) {
    throw new Error(
      `Scheduled command inputs are invalid: ${validationErrors
        .map((error) => `${error.inputName}: ${error.message}`)
        .join("; ")}`
    );
  }

  const inputVariables = await readInputValues(
    supabase,
    schedule.workspace_id,
    targetPageId
  );
  const controlPanelSources = await readControlPanelSources(
    supabase,
    schedule.workspace_id,
    targetPageId
  );
  const allSourceRefs = [...sourceRefs, ...controlPanelSources];
  const resolvedSources =
    allSourceRefs.length > 0
      ? await resolveSources(allSourceRefs, schedule.workspace_id, supabase)
      : [];
  const prompt = buildCommandPrompt({
    command,
    inputValues,
    inputVariables,
    resolvedSources,
  });
  const modelProvider =
    command.model_provider || workspace.modelProvider || "anthropic";
  const modelName = command.model_name || workspace.modelName || "";
  const outputMode = schedule.output_mode ?? "append";
  const existingOutputBlocks =
    outputMode === "append"
      ? []
      : await getLastRunOutputBlocks(supabase, schedule, targetPageId);
  const outputBlockIds: string[] = [];
  const toolsUsed = new Set<string>();
  const steps: Array<Record<string, unknown>> = [];
  let cumulativeTokens = 0;
  let run: Run | null = null;

  try {
    run = await createRun(
      {
        workspaceId: schedule.workspace_id,
        pageId: targetPageId,
        triggerBlockId: null,
        commandId: command.id,
        type: "command",
        input: {
          mode: "scheduled",
          scheduleId: schedule.id,
          inputs: inputValues,
          sources: sourceRefs,
          existingOutputBlocks,
          outputMode,
          prompt,
        },
        modelProvider,
        modelName,
      },
      supabase
    );

    const tools = filterNotebookTools(
      createNotebookTools({
        workspaceId: schedule.workspace_id,
        pageId: targetPageId,
        parentBlockId: null,
        currentRunId: run.id,
        existingOutputBlocks,
        supabase,
        tavilyApiKey: workspace.tavilyApiKey,
        openaiApiKey: workspace.modelOptions.apiKeys?.openai,
        outputMode,
        onBlockCreated: (block) => outputBlockIds.push(block.id),
        onToolUsed: (toolName) => toolsUsed.add(toolName),
      }),
      command.allowed_tools
    );

    const imageSources = resolvedSources.filter((source) => source.type === "image");
    const messages = buildMessages(prompt, imageSources);
    const result = await generateText({
      model: getModel(modelProvider, modelName, workspace.modelOptions),
      system: buildScheduledCommandSystemPrompt(command),
      ...(messages ? { messages } : { prompt }),
      tools,
      stopWhen: stepCountIs(5),
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
    });

    const structuredOutput = parseStructuredOutput(result.text);
    const validation = validateOutput(structuredOutput, command.output_schema);
    const textOutputBlockId = await ensureTextOutputBlock({
      supabase,
      workspaceId: schedule.workspace_id,
      pageId: targetPageId,
      parentBlockId: null,
      text: result.text,
      outputMode,
      existingOutputBlocks,
      outputBlockIds,
    });
    if (textOutputBlockId && !outputBlockIds.includes(textOutputBlockId)) {
      outputBlockIds.unshift(textOutputBlockId);
    }

    return await updateRunStatus(
      run.id,
      "completed",
      {
        output: {
          text: result.text,
          structuredOutput,
          validation,
          steps,
        },
        outputBlockIds,
        contextUsed: summarizeResolvedSources(resolvedSources),
        toolsUsed: Array.from(toolsUsed),
        schemaValidation:
          validation.valid || outputBlockIds.length > 0
            ? validation.valid
              ? "passed"
              : "skipped_tool_output"
            : "failed",
        tokenUsage: normalizeUsage(result.totalUsage),
        durationMs: Date.now() - startedAt,
        completedAt: new Date().toISOString(),
      },
      supabase
    );
  } catch (error) {
    if (run) {
      await updateRunStatus(
        run.id,
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

async function updateScheduleAfterRun(
  supabase: SupabaseClient,
  schedule: Schedule,
  status: "completed" | "failed",
  runId: string | null,
  error?: unknown
) {
  await supabase
    .from("schedules")
    .update({
      last_run_at: new Date().toISOString(),
      last_run_status: status,
      last_run_id: runId,
      last_error: error ? serializeError(error) : null,
      next_run_at: computeNextRun(
        schedule.cron_expression,
        schedule.timezone ?? "UTC"
      ).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", schedule.id);
}

async function loadScheduleContext(
  supabase: SupabaseClient,
  schedule: Schedule
) {
  const { data: command, error: commandError } = await supabase
    .from("commands")
    .select("*")
    .eq("id", schedule.command_id)
    .eq("workspace_id", schedule.workspace_id)
    .eq("is_archived", false)
    .single();
  if (commandError || !command) {
    throw new Error(commandError?.message ?? "Command not found");
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", schedule.workspace_id)
    .single();
  if (workspaceError) throw new Error(workspaceError.message);

  const settings = (workspace?.settings ?? {}) as Record<string, unknown>;
  const apiKeys = objectSetting(settings.apiKeys);

  return {
    command: command as Command,
    workspace: {
      modelProvider: stringSetting(
        settings,
        "modelProvider",
        "model_provider",
        "defaultModelProvider"
      ),
      modelName: stringSetting(
        settings,
        "modelName",
        "model_name",
        "defaultModelName",
        "defaultModel"
      ),
      modelOptions: getModelOptionsFromSettings(settings),
      tavilyApiKey:
        stringSetting(settings, "tavily_api_key", "tavilyApiKey") ||
        stringSetting(apiKeys, "tavily", "tavily_api_key", "tavilyApiKey"),
    },
  };
}

async function loadPreset(supabase: SupabaseClient, schedule: Schedule) {
  if (!schedule.preset_id) return null;

  const { data, error } = await supabase
    .from("input_presets")
    .select("input_values,source_refs")
    .eq("id", schedule.preset_id)
    .eq("command_id", schedule.command_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { input_values?: unknown; source_refs?: unknown } | null;
}

async function getLastRunOutputBlocks(
  supabase: SupabaseClient,
  schedule: Schedule,
  targetPageId: string
): Promise<ExistingOutputBlockRef[]> {
  if (!schedule.last_run_id) return [];

  const { data: run, error: runError } = await supabase
    .from("runs")
    .select("output_block_ids")
    .eq("id", schedule.last_run_id)
    .eq("workspace_id", schedule.workspace_id)
    .maybeSingle();
  if (runError) throw new Error(runError.message);

  const outputBlockIds = ((run?.output_block_ids ?? []) as unknown[]).filter(
    (id): id is string => typeof id === "string"
  );
  if (outputBlockIds.length === 0) return [];

  const { data, error } = await supabase
    .from("blocks")
    .select("id,type")
    .eq("workspace_id", schedule.workspace_id)
    .eq("page_id", targetPageId)
    .is("parent_block_id", null)
    .in("id", outputBlockIds)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<{ id: string; type: string }>).map((block) => ({
    id: block.id,
    type: block.type,
  }));
}

function buildCommandPrompt(params: {
  command: Command;
  inputValues: Record<string, string>;
  inputVariables: Record<string, unknown>;
  resolvedSources: ResolvedSource[];
}) {
  const templateInputs = stringifyTemplateInputs({
    ...params.inputVariables,
    ...params.inputValues,
  });
  const prompt = fillTemplate(params.command.prompt_template, templateInputs);
  const inputContext = Object.keys(params.inputVariables).length
    ? `Page inputs:\n${formatInputVariables(params.inputVariables)}`
    : null;
  const sourceContext = params.resolvedSources.length
    ? `Sources:\n${formatResolvedSources(params.resolvedSources)}`
    : null;

  return [prompt, inputContext, sourceContext].filter(Boolean).join("\n\n");
}

function buildScheduledCommandSystemPrompt(command: Command) {
  return [
    "You are running a scheduled saved command inside a command notebook.",
    "Follow the command template precisely. Input variables are hard constraints, not suggestions.",
    "Use only the tools made available for this command.",
    "Create at most one block per output type. Do not create duplicate blocks with the same structure.",
    "If the command asks for an image, picture, logo, illustration, or other visual output, use generate_image.",
    "Do not use markdown tables in text responses. If information needs rows and columns, use create_table when table output is requested.",
    "Keep the text response concise. Do not repeat information already stored in created blocks.",
    `Output schema:\n${safeStringify(command.output_schema)}`,
  ].join("\n");
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
  ] as Parameters<typeof generateText>[0]["messages"];
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

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, raw]) => [
      key,
      typeof raw === "string" ? raw : safeStringify(raw),
    ])
  );
}

function normalizeSourceRefs(value: unknown): SourceReference[] {
  if (!Array.isArray(value)) return [];

  return value.filter((source): source is SourceReference => {
    if (!source || typeof source !== "object") return false;
    const type = (source as { type?: unknown }).type;
    return (
      type === "block" ||
      type === "file" ||
      type === "url" ||
      type === "paste" ||
      type === "rag" ||
      type === "image"
    );
  });
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

function formatInputVariables(inputVariables: Record<string, unknown>) {
  return Object.entries(inputVariables)
    .map(([name, value]) => `- ${name} = ${formatVariableValue(value)}`)
    .join("\n");
}

function formatVariableValue(value: unknown) {
  return typeof value === "string" ? JSON.stringify(value) : safeStringify(value);
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

function createServiceRoleClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  return createSupabaseJsClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
