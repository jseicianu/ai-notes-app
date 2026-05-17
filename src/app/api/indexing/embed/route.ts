import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { embedBlock, embedPage } from "@/services/embedding-service";
import { requireWorkspace } from "@/services/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  sourceType: z.enum(["block", "page"]),
  sourceId: z.string().uuid(),
  workspaceId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requireWorkspace(request, parsed.data.workspaceId);
  if ("error" in auth) return auth.error;

  const result =
    parsed.data.sourceType === "block"
      ? await embedBlock({ workspaceId: parsed.data.workspaceId, blockId: parsed.data.sourceId })
      : await embedPage({ workspaceId: parsed.data.workspaceId, pageId: parsed.data.sourceId });

  return NextResponse.json({ success: true, ...result });
}
