import { NextResponse, type NextRequest } from "next/server";
import { requireWorkspace } from "@/services/api-utils";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 10) || 10, 1),
    25
  );

  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  const auth = await requireWorkspace(request, workspaceId);
  if ("error" in auth) return auth.error;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("runs")
    .select(`
      id,
      status,
      type,
      created_at,
      page_id,
      trigger_block_id,
      command_id,
      commands(name, slug),
      pages(title)
    `)
    .eq("workspace_id", workspaceId)
    .in("status", ["completed", "failed", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    runs: (data ?? []).map((run) => {
      const command = Array.isArray(run.commands) ? run.commands[0] : run.commands;
      const page = Array.isArray(run.pages) ? run.pages[0] : run.pages;

      return {
        id: run.id,
        status: run.status,
        type: run.type,
        created_at: run.created_at,
        page_id: run.page_id,
        trigger_block_id: run.trigger_block_id,
        command_id: run.command_id,
        command_name: command?.name,
        command_slug: command?.slug,
        page_title: page?.title,
      };
    }),
  });
}
