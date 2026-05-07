import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getBlockVersion } from "@/services/block-version-service";

const paramsSchema = z.object({
  blockId: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ blockId: string; version: string }> }
) {
  const parsed = paramsSchema.safeParse(await context.params);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid version request" }, { status: 400 });
  }

  const blockVersion = await getBlockVersion(
    parsed.data.blockId,
    parsed.data.version
  );

  return NextResponse.json({
    version: blockVersion.version,
    type: blockVersion.type,
    content: blockVersion.content,
    created_at: blockVersion.created_at,
  });
}
