import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { updateCommand } from "@/services/command-service";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const paramsSchema = z.object({
  commandId: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ commandId: string; version: string }> }
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid restore request" }, { status: 400 });

  const supabase = await createClient();
  const { data: version, error } = await supabase
    .from("command_versions")
    .select("*")
    .eq("command_id", parsed.data.commandId)
    .eq("version", parsed.data.version)
    .single();

  if (error || !version) {
    return NextResponse.json({ error: error?.message ?? "Version not found" }, { status: 404 });
  }

  const command = await updateCommand(parsed.data.commandId, {
    prompt_template: version.prompt_template,
    inputs: version.inputs,
    output_schema: version.output_schema,
    allowed_tools: version.allowed_tools ?? [],
  });

  return NextResponse.json(command);
}
