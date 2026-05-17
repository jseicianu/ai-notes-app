import { NextResponse, type NextRequest } from "next/server";
import { requireWorkspace } from "@/services/api-utils";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ACTIONS = [
  { id: "new-page", label: "New Page", shortcut: "Cmd+N", type: "create" },
  { id: "new-notebook", label: "New Notebook", type: "create" },
  { id: "settings", label: "Settings", shortcut: "Cmd+,", type: "navigate" },
  { id: "run-all", label: "Run All Cells", shortcut: "Cmd+Shift+Enter", type: "action" },
  { id: "export", label: "Export Page", type: "action" },
] as const;

function rankByQuery(value: string | null | undefined, query: string) {
  const text = (value ?? "").toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;
  if (text === q) return 0;
  if (text.startsWith(q)) return 1;
  if (text.includes(q)) return 2;
  return 3;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!workspaceId) return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });

  const auth = await requireWorkspace(request, workspaceId);
  if ("error" in auth) return auth.error;

  const supabase = await createClient();
  const pattern = `%${query}%`;
  const [pages, commands] = await Promise.all([
    supabase
      .from("pages")
      .select("id,title,notebook_id,updated_at,notebooks!inner(id,name)")
      .eq("workspace_id", workspaceId)
      .eq("is_archived", false)
      .ilike("title", pattern)
      .order("updated_at", { ascending: false })
      .limit(25),
    supabase
      .from("commands")
      .select("id,name,slug,description")
      .eq("workspace_id", workspaceId)
      .eq("is_archived", false)
      .order("name", { ascending: true })
      .limit(100),
  ]);

  if (pages.error) throw new Error(pages.error.message);
  if (commands.error) throw new Error(commands.error.message);

  return NextResponse.json({
    pages: (pages.data ?? [])
      .sort((a, b) => rankByQuery(a.title, query) - rankByQuery(b.title, query))
      .slice(0, 5)
      .map((page) => {
        const notebook = Array.isArray(page.notebooks) ? page.notebooks[0] : page.notebooks;
        return {
          id: page.id,
          title: page.title,
          notebookId: notebook?.id,
          notebookName: notebook?.name,
          updatedAt: page.updated_at,
        };
      }),
    commands: (commands.data ?? [])
      .filter((command) => {
        if (!query) return true;
        const q = query.toLowerCase();
        return [command.name, command.slug, command.description]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        const aRank = Math.min(
          rankByQuery(a.slug, query),
          rankByQuery(a.name, query),
          rankByQuery(a.description, query)
        );
        const bRank = Math.min(
          rankByQuery(b.slug, query),
          rankByQuery(b.name, query),
          rankByQuery(b.description, query)
        );
        return aRank - bRank || a.name.localeCompare(b.name);
      })
      .slice(0, 5),
    actions: ACTIONS.filter((action) =>
      action.label.toLowerCase().includes(query.toLowerCase())
    ).sort((a, b) => rankByQuery(a.label, query) - rankByQuery(b.label, query)),
  });
}
