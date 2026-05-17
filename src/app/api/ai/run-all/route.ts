import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createSseStream, requireWorkspace, serializeError } from "@/services/api-utils";
import { createRun, updateRunStatus } from "@/services/run-service";

export const runtime = "nodejs";

const schema = z.object({
  pageId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  stopOnError: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;
  const auth = await requireWorkspace(request, body.workspaceId);
  if ("error" in auth) return auth.error;
  const supabase = await createClient();
  const { data: cells, error } = await supabase
    .from("blocks")
    .select("*")
    .eq("workspace_id", body.workspaceId)
    .eq("page_id", body.pageId)
    .in("type", ["ai_cell", "command_ref"])
    .order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const parentRun = await createRun({
    workspaceId: body.workspaceId,
    pageId: body.pageId,
    triggerBlockId: cells?.[0]?.id ?? body.pageId,
    type: "ai_cell",
    input: { mode: "run_all", cellCount: cells?.length ?? 0 },
    modelProvider: auth.workspace.modelProvider ?? "anthropic",
    modelName: auth.workspace.modelName ?? "",
  }, supabase);

  return createSseStream(async (send) => {
    let completed = 0;
    let failed = 0;
    for (const [index, cell] of (cells ?? []).entries()) {
      send("cell-start", { blockId: cell.id, index: index + 1, total: cells?.length ?? 0 });
      try {
        const run = await createRun({
          workspaceId: body.workspaceId,
          pageId: body.pageId,
          triggerBlockId: cell.id,
          parentRunId: parentRun.id,
          type: cell.type === "command_ref" ? "command" : "ai_cell",
          input: { mode: "run_all_cell", content: cell.content },
          modelProvider: auth.workspace.modelProvider ?? "anthropic",
          modelName: auth.workspace.modelName ?? "",
        }, supabase);
        await updateRunStatus(run.id, "completed", {
          output: { message: "Cell queued by run-all endpoint." },
          completedAt: new Date().toISOString(),
        }, supabase);
        completed += 1;
        send("cell-complete", { blockId: cell.id, index: index + 1, total: cells?.length ?? 0, status: "completed", runId: run.id });
      } catch (error) {
        failed += 1;
        send("cell-complete", { blockId: cell.id, index: index + 1, total: cells?.length ?? 0, status: "failed", error: serializeError(error).message });
        if (body.stopOnError) {
          send("batch-stopped", { blockId: cell.id, index: index + 1 });
          break;
        }
      }
    }
    await updateRunStatus(parentRun.id, "completed", {
      output: { total: cells?.length ?? 0, completed, failed },
      completedAt: new Date().toISOString(),
    }, supabase);
    send("batch-complete", { total: cells?.length ?? 0, completed, failed });
  });
}
