import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { saveBlockVersion } from "@/services/block-version-service";

const paramsSchema = z.object({
  blockId: z.string().uuid(),
});

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ blockId: string }> }
) {
  const parsed = paramsSchema.safeParse(await context.params);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid block ID" }, { status: 400 });
  }

  try {
    const version = await saveBlockVersion(parsed.data.blockId);
    return NextResponse.json({ version: version.version });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save version" },
      { status: 500 }
    );
  }
}
