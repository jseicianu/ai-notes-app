import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/services/api-utils";
import { computeNextRun } from "@/services/schedule-service";

export const runtime = "nodejs";

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  commandId: z.string().uuid(),
  presetId: z.string().uuid().optional(),
  targetPageId: z.string().uuid().optional(),
  inputValues: z.record(z.string(), z.unknown()).default({}),
  sourceRefs: z.array(z.unknown()).default([]),
  outputMode: z.enum(["append", "replace", "version"]).default("append"),
  name: z.string().min(1),
  cronExpression: z.string().min(1),
  timezone: z.string().default("UTC"),
});

export async function GET(request: NextRequest) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!workspaceId) return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  const auth = await requireWorkspace(request, workspaceId);
  if ("error" in auth) return auth.error;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  const auth = await requireWorkspace(request, parsed.data.workspaceId);
  if ("error" in auth) return auth.error;
  if (!parsed.data.targetPageId) {
    return NextResponse.json({ error: "Target page is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const validationError = await validateScheduleReferences(supabase, parsed.data);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  let nextRunAt: string;
  try {
    nextRunAt = computeNextRun(
      parsed.data.cronExpression,
      parsed.data.timezone
    ).toISOString();
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid schedule",
        details: error instanceof Error ? error.message : "Invalid cron expression or timezone",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("schedules")
    .insert({
      workspace_id: parsed.data.workspaceId,
      command_id: parsed.data.commandId,
      preset_id: parsed.data.presetId,
      target_page_id: parsed.data.targetPageId,
      input_values: parsed.data.inputValues,
      source_refs: parsed.data.sourceRefs,
      output_mode: parsed.data.outputMode,
      name: parsed.data.name,
      cron_expression: parsed.data.cronExpression,
      timezone: parsed.data.timezone,
      next_run_at: nextRunAt,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

async function validateScheduleReferences(
  supabase: Awaited<ReturnType<typeof createClient>>,
  data: z.infer<typeof createSchema>
) {
  const { data: command, error: commandError } = await supabase
    .from("commands")
    .select("id")
    .eq("id", data.commandId)
    .eq("workspace_id", data.workspaceId)
    .eq("is_archived", false)
    .maybeSingle();
  if (commandError) throw new Error(commandError.message);
  if (!command) return "Command not found in workspace";

  const { data: page, error: pageError } = await supabase
    .from("pages")
    .select("id")
    .eq("id", data.targetPageId)
    .eq("workspace_id", data.workspaceId)
    .maybeSingle();
  if (pageError) throw new Error(pageError.message);
  if (!page) return "Target page not found in workspace";

  if (!data.presetId) return null;

  const { data: preset, error: presetError } = await supabase
    .from("input_presets")
    .select("id")
    .eq("id", data.presetId)
    .eq("command_id", data.commandId)
    .maybeSingle();
  if (presetError) throw new Error(presetError.message);
  return preset ? null : "Preset not found for command";
}
