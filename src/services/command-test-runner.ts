import type { SupabaseClient } from "@supabase/supabase-js";
import { streamText, stepCountIs } from "ai";
import { z } from "zod";
import { getSourceConfig, isSourceInput, type Command } from "@/lib/models/types";
import { serializeError } from "@/services/api-utils";
import { fillTemplate, validateOutput } from "@/services/command-service";
import { getModel, type ModelOptions } from "@/services/model-service";
import { createRun, updateRunStatus } from "@/services/run-service";
import { resolveSources, type ResolvedSource, type SourceReference } from "@/services/source-service";

type SendSse = (event: string, data: unknown) => void;

interface WorkspaceModelDefaults {
  modelProvider?: string;
  modelName?: string;
  modelOptions: ModelOptions;
}

export interface CommandTestCase {
  id: string;
  command_id: string;
  workspace_id: string;
  name: string;
  input_values: Record<string, unknown> | null;
  source_refs: unknown[] | null;
}

export interface CommandTestRunResult {
  testCaseId: string;
  name: string;
  runId: string;
  status: "passed" | "failed";
  validation: ReturnType<typeof validateOutput>;
}

const sourceReferenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("block"), blockId: z.string().uuid() }),
  z.object({ type: z.literal("file"), fileId: z.string().uuid() }),
  z.object({ type: z.literal("url"), url: z.string().url() }),
  z.object({ type: z.literal("paste"), content: z.string() }),
  z.object({ type: z.literal("rag"), query: z.string().min(1), limit: z.number().int().positive().optional() }),
  z.object({ type: z.literal("image"), storageUrl: z.string().url(), mimeType: z.string() }),
]);

export async function executeCommandTestCase({
  command,
  testCase,
  workspace,
  supabase,
  send,
}: {
  command: Command;
  testCase: CommandTestCase;
  workspace: WorkspaceModelDefaults;
  supabase: SupabaseClient;
  send?: SendSse;
}): Promise<CommandTestRunResult> {
  const modelProvider = command.model_provider || workspace.modelProvider || "anthropic";
  const modelName = command.model_name || workspace.modelName || "";
  const startedAt = Date.now();
  const sourceRefs = coerceSourceReferences(testCase.source_refs ?? []);
  const inputValues = testCase.input_values ?? {};
  const run = await createRun(
    {
      workspaceId: testCase.workspace_id,
      pageId: null,
      triggerBlockId: null,
      commandId: command.id,
      type: "test",
      input: { mode: "test_case", inputValues, sourceRefs },
      modelProvider,
      modelName,
    },
    supabase
  );

  try {
    const resolvedSources = sourceRefs.length
      ? await resolveSources(sourceRefs, testCase.workspace_id)
      : [];
    const templateInputs = stringifyValues(inputValues);
    if (sourceRefs.length > 0 && getSourceConfig(command)) {
      for (const input of command.inputs) {
        if (isSourceInput(input)) {
          templateInputs[input.name] = "the selected sources below";
        }
      }
    }
    const prompt = [
      fillTemplate(command.prompt_template, templateInputs),
      resolvedSources.length
        ? `Sources:\n${resolvedSources
            .map(
              (source, index) =>
                `<source index="${index + 1}" label="${source.label}">\n${source.content}\n</source>`
            )
            .join("\n\n")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    let fullText = "";
    const imageSources = resolvedSources.filter((source) => source.type === "image");
    const messages = buildMessages(prompt, imageSources);
    const result = streamText({
      model: getModel(modelProvider, modelName, workspace.modelOptions),
      system: buildTestSystemPrompt(command),
      ...(messages ? { messages } : { prompt }),
      stopWhen: stepCountIs(5),
      onStepFinish: (event) => {
        send?.("step", {
          testCaseId: testCase.id,
          stepNumber: event.stepNumber,
          finishReason: event.finishReason,
          toolCalls:
            event.toolCalls?.map((call) => ({
              name: call.toolName,
              args: call.input,
            })) ?? [],
          tokenUsage: event.usage ?? null,
        });
      },
    });

    for await (const chunk of result.textStream) {
      fullText += chunk;
      send?.("text", { testCaseId: testCase.id, text: chunk });
    }

    const structuredOutput = parseStructuredOutput(fullText);
    const validation = validateOutput(structuredOutput, command.output_schema ?? {});
    const status = validation.valid ? "passed" : "failed";

    send?.("validation", { testCaseId: testCase.id, ...validation });

    await updateRunStatus(
      run.id,
      "completed",
      {
        output: { text: fullText, structuredOutput, validation },
        contextUsed: resolvedSources.map((source, index) => ({
          type: `source:${source.type}`,
          id:
            source.metadata?.blockId ??
            source.metadata?.url ??
            source.metadata?.filename ??
            `source-${index + 1}`,
          label: source.label,
        })),
        schemaValidation: status,
        durationMs: Date.now() - startedAt,
        completedAt: new Date().toISOString(),
      },
      supabase
    );

    await supabase
      .from("test_cases")
      .update({
        last_run_id: run.id,
        last_run_output: structuredOutput,
        last_run_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", testCase.id);

    return {
      testCaseId: testCase.id,
      name: testCase.name,
      runId: run.id,
      status,
      validation,
    };
  } catch (error) {
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
    await supabase
      .from("test_cases")
      .update({
        last_run_id: run.id,
        last_run_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", testCase.id);
    throw error;
  }
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

function buildTestSystemPrompt(command: Command) {
  const schema = command.output_schema ?? {};
  return [
    `Run the saved command "${command.name}" against the provided example inputs.`,
    "Return only the command output. Do not describe the test process.",
    "Do not use markdown tables unless the command output is explicitly a table. For small examples, use short bullets or inline pairs.",
    Object.keys(schema).length > 0
      ? `The output must be valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function stringifyValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ])
  );
}

function coerceSourceReferences(values: unknown[]): SourceReference[] {
  return values.flatMap((value) => {
    const parsed = sourceReferenceSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

function parseStructuredOutput(text: string): unknown {
  const trimmed = stripCodeFence(text.trim());
  try {
    return JSON.parse(trimmed);
  } catch {
    return { text };
  }
}

function stripCodeFence(text: string) {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? text;
}
