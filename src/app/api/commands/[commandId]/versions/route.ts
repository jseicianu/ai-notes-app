import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { diffCommandVersions } from "@/services/command-service";

export const runtime = "nodejs";

const paramsSchema = z.object({ commandId: z.string().uuid() });

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ commandId: string }> }
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid command ID" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("command_versions")
    .select("*")
    .eq("command_id", parsed.data.commandId)
    .order("version", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const versions = data ?? [];
  return NextResponse.json(
    versions.map((version, index) => ({
      ...version,
      diff:
        versions[index + 1] !== undefined
          ? diffCommandVersions(versions[index + 1], version)
          : undefined,
    }))
  );
}
