import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const paramsSchema = z.object({
  commandId: z.string().uuid(),
  presetId: z.string().uuid(),
});
const bodySchema = z.object({
  name: z.string().min(1).optional(),
  inputValues: z.record(z.string(), z.unknown()).optional(),
  sourceRefs: z.array(z.unknown()).optional(),
});

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ commandId: string; presetId: string }> }
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.data.name !== undefined) payload.name = body.data.name;
  if (body.data.inputValues !== undefined) payload.input_values = body.data.inputValues;
  if (body.data.sourceRefs !== undefined) payload.source_refs = body.data.sourceRefs;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("input_presets")
    .update(payload)
    .eq("id", params.data.presetId)
    .eq("command_id", params.data.commandId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ commandId: string; presetId: string }> }
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase
    .from("input_presets")
    .delete()
    .eq("id", params.data.presetId)
    .eq("command_id", params.data.commandId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
