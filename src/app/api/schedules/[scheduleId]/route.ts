import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { computeNextRun } from "@/services/schedule-service";

export const runtime = "nodejs";

const paramsSchema = z.object({ scheduleId: z.string().uuid() });
const bodySchema = z.object({
  name: z.string().min(1).optional(),
  cronExpression: z.string().min(1).optional(),
  timezone: z.string().optional(),
  isActive: z.boolean().optional(),
  presetId: z.string().uuid().nullable().optional(),
  targetPageId: z.string().uuid().nullable().optional(),
  inputValues: z.record(z.string(), z.unknown()).optional(),
  sourceRefs: z.array(z.unknown()).optional(),
  outputMode: z.enum(["append", "replace", "version"]).optional(),
});

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ scheduleId: string }> }
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const supabase = await createClient();
  const { data: current, error: currentError } = await supabase
    .from("schedules")
    .select("id,workspace_id,command_id,cron_expression,timezone")
    .eq("id", params.data.scheduleId)
    .maybeSingle();
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 400 });
  if (!current) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  if (body.data.targetPageId) {
    const { data: page, error: pageError } = await supabase
      .from("pages")
      .select("id")
      .eq("id", body.data.targetPageId)
      .eq("workspace_id", current.workspace_id)
      .maybeSingle();
    if (pageError) return NextResponse.json({ error: pageError.message }, { status: 400 });
    if (!page) return NextResponse.json({ error: "Target page not found in workspace" }, { status: 400 });
  }

  if (body.data.presetId) {
    const { data: preset, error: presetError } = await supabase
      .from("input_presets")
      .select("id")
      .eq("id", body.data.presetId)
      .eq("command_id", current.command_id)
      .maybeSingle();
    if (presetError) return NextResponse.json({ error: presetError.message }, { status: 400 });
    if (!preset) return NextResponse.json({ error: "Preset not found for command" }, { status: 400 });
  }

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.data.name !== undefined) payload.name = body.data.name;
  if (body.data.cronExpression !== undefined) payload.cron_expression = body.data.cronExpression;
  if (body.data.timezone !== undefined) payload.timezone = body.data.timezone;
  if (body.data.isActive !== undefined) payload.is_active = body.data.isActive;
  if (body.data.presetId !== undefined) payload.preset_id = body.data.presetId;
  if (body.data.targetPageId !== undefined) payload.target_page_id = body.data.targetPageId;
  if (body.data.inputValues !== undefined) payload.input_values = body.data.inputValues;
  if (body.data.sourceRefs !== undefined) payload.source_refs = body.data.sourceRefs;
  if (body.data.outputMode !== undefined) payload.output_mode = body.data.outputMode;
  if (body.data.cronExpression || body.data.timezone) {
    try {
      payload.next_run_at = computeNextRun(
        body.data.cronExpression ?? current.cron_expression,
        body.data.timezone ?? current.timezone ?? "UTC"
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
  }
  const { data, error } = await supabase
    .from("schedules")
    .update(payload)
    .eq("id", params.data.scheduleId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ scheduleId: string }> }
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.from("schedules").delete().eq("id", params.data.scheduleId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
