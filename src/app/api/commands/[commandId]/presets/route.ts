import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const paramsSchema = z.object({ commandId: z.string().uuid() });
const bodySchema = z.object({
  name: z.string().min(1),
  inputValues: z.record(z.string(), z.unknown()).default({}),
  sourceRefs: z.array(z.unknown()).default([]),
  workspaceId: z.string().uuid(),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ commandId: string }> }
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid command ID" }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("input_presets")
    .select("*")
    .eq("command_id", parsed.data.commandId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ commandId: string }> }
) {
  const [params, body] = await Promise.all([
    paramsSchema.safeParseAsync(await context.params),
    bodySchema.safeParseAsync(await request.json().catch(() => null)),
  ]);
  if (!params.success || !body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("input_presets")
    .insert({
      command_id: params.data.commandId,
      workspace_id: body.data.workspaceId,
      name: body.data.name,
      input_values: body.data.inputValues,
      source_refs: body.data.sourceRefs,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
