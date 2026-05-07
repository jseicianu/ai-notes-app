import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getBlockVersions } from "@/services/block-version-service";

const paramsSchema = z.object({
  blockId: z.string().uuid(),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ blockId: string }> }
) {
  const parsed = paramsSchema.safeParse(await context.params);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid block ID" }, { status: 400 });
  }

  const versions = await getBlockVersions(parsed.data.blockId);

  return NextResponse.json({
    versions: versions.map((version) => ({
      version: version.version,
      type: version.type,
      created_at: version.created_at,
    })),
  });
}
