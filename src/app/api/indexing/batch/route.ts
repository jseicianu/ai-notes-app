import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireWorkspace } from "@/services/api-utils";
import { embedBatch } from "@/services/embedding-service";

export const runtime = "nodejs";

const schema = z.object({
  workspaceId: z.string().uuid(),
  batchSize: z.number().int().positive().max(50).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requireWorkspace(request, parsed.data.workspaceId);
  if ("error" in auth) return auth.error;

  return NextResponse.json(await embedBatch(parsed.data));
}
