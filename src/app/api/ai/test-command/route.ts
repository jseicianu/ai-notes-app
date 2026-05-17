import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { streamText, stepCountIs } from "ai";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSseStream, requireWorkspace, serializeError } from "@/services/api-utils";
import { fillTemplate, validateInputs, validateOutput } from "@/services/command-service";
import { getModel } from "@/services/model-service";
import { createNotebookTools, filterNotebookTools } from "@/services/notebook-tools";
import { createRun, updateRunStatus } from "@/services/run-service";
import { resolveSources } from "@/services/source-service";

export const runtime = "nodejs";

const sourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("block"), blockId: z.string().uuid() }),
  z.object({ type: z.literal("file"), fileId: z.string().uuid() }),
  z.object({ type: z.literal("url"), url: z.string().url() }),
  z.object({ type: z.literal("paste"), content: z.string() }),
  z.object({ type: z.literal("rag"), query: z.string().min(1), limit: z.number().int().positive().optional() }),
  z.object({ type: z.literal("image"), storageUrl: z.string().url(), mimeType: z.string() }),
]);

const schema = z.object({
  promptTemplate: z.string().min(1),
  inputs: z.array(z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean().optional(),
    validation: z.record(z.string(), z.unknown()).optional(),
  })).default([]),
  inputValues: z.record(z.string(), z.string()).default({}),
  outputSchema: z.record(z.string(), z.unknown()).default({}),
  allowedTools: z.array(z.string()).default([]),
  model: z.object({ provider: z.string(), name: z.string() }).optional(),
  sources: z.array(sourceSchema).default([]),
  workspaceId: z.string().uuid(),
  pageId: z.string().uuid(),
  triggerBlockId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const auth = await requireWorkspace(request, body.workspaceId);
  if ("error" in auth) return auth.error;

  const inputErrors = validateInputs(body.inputs, body.inputValues);
  if (inputErrors.length) {
    return NextResponse.json({ error: "Validation failed", details: inputErrors }, { status: 400 });
  }

  const serviceClient = createServiceRoleClient();
  const run = await createRun({
    workspaceId: body.workspaceId,
    pageId: body.pageId,
    triggerBlockId: body.triggerBlockId ?? body.pageId,
    type: "test",
    input: { mode: "test_command", inputValues: body.inputValues, sources: body.sources },
    modelProvider: body.model?.provider ?? auth.workspace.modelProvider ?? "anthropic",
    modelName: body.model?.name ?? auth.workspace.modelName ?? "",
  }, serviceClient);

  return createSseStream(async (send) => {
    const outputBlockIds: string[] = [];
    const toolsUsed = new Set<string>();
    try {
      const resolved = await resolveSources(body.sources, body.workspaceId);
      const prompt = [
        fillTemplate(body.promptTemplate, body.inputValues),
        resolved.length
          ? `Sources:\n${resolved.map((source, index) => `<source index="${index + 1}" label="${source.label}">\n${source.content}\n</source>`).join("\n\n")}`
          : null,
      ].filter(Boolean).join("\n\n");
      let fullText = "";
      const result = streamText({
        model: getModel(
          body.model?.provider ?? auth.workspace.modelProvider ?? "anthropic",
          body.model?.name ?? auth.workspace.modelName ?? "",
          auth.workspace.modelOptions
        ),
        system: `Run this draft command and produce output matching this schema:\n${JSON.stringify(body.outputSchema, null, 2)}`,
        prompt,
        tools: filterNotebookTools(createNotebookTools({
          workspaceId: body.workspaceId,
          pageId: body.pageId,
          parentBlockId: body.triggerBlockId ?? body.pageId,
          currentRunId: run.id,
          supabase: serviceClient,
          tavilyApiKey: auth.workspace.tavilyApiKey,
          openaiApiKey: auth.workspace.modelOptions.apiKeys?.openai,
          onBlockCreated: (block) => outputBlockIds.push(block.id),
          onToolUsed: (toolName) => toolsUsed.add(toolName),
        }), body.allowedTools),
        stopWhen: stepCountIs(5),
        onStepFinish: (event) => send("step", {
          stepNumber: event.stepNumber,
          finishReason: event.finishReason,
          toolCalls: event.toolCalls?.map((call) => ({ name: call.toolName, args: call.input })) ?? [],
          tokenUsage: event.usage ?? null,
        }),
      });
      for await (const chunk of result.textStream) {
        fullText += chunk;
        send("text", { text: chunk });
      }
      const parsedOutput = parseStructuredOutput(fullText);
      const validation = validateOutput(parsedOutput, body.outputSchema);
      send("validation", { ...validation, repairAttempted: false, repairSucceeded: false });
      await updateRunStatus(run.id, "completed", {
        output: { text: fullText, structuredOutput: parsedOutput, validation },
        outputBlockIds,
        toolsUsed: Array.from(toolsUsed),
        schemaValidation: validation.valid ? "passed" : "failed",
        completedAt: new Date().toISOString(),
      }, serviceClient);
      send("complete", { runId: run.id, validation });
    } catch (error) {
      await updateRunStatus(run.id, "failed", { error: serializeError(error), completedAt: new Date().toISOString() }, serviceClient);
      send("error", serializeError(error));
    }
  });
}

function createServiceRoleClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  return createSupabaseJsClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function parseStructuredOutput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
