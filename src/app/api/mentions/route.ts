import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/services/api-utils";
import { extractBlockText } from "@/services/source-service";
import type { Block } from "@/lib/models/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const pageId = url.searchParams.get("pageId") ?? "";
  if (!workspaceId) return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  const auth = await requireWorkspace(request, workspaceId);
  if ("error" in auth) return auth.error;
  const supabase = await createClient();
  const pattern = `%${query}%`;
  const [blocks, pages, files, commands] = await Promise.all([
    supabase.from("blocks").select("*,pages!inner(title)").eq("workspace_id", workspaceId).limit(40),
    supabase.from("pages").select("id,title,notebooks!inner(name)").eq("workspace_id", workspaceId).ilike("title", pattern).limit(5),
    supabase.from("files").select("id,filename,mime_type").eq("workspace_id", workspaceId).ilike("filename", pattern).limit(5),
    supabase.from("commands").select("id,name,slug").eq("workspace_id", workspaceId).eq("is_archived", false).or(`name.ilike.${pattern},slug.ilike.${pattern}`).limit(5),
  ]);
  if (blocks.error) throw new Error(blocks.error.message);
  const blockResults = ((blocks.data ?? []) as Array<Block & { pages?: { title?: string } | Array<{ title?: string }> }>)
    .map((block) => ({ block, text: extractBlockText(block) }))
    .filter(({ text }) => text.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(b.block.page_id === pageId) - Number(a.block.page_id === pageId))
    .slice(0, 5)
    .map(({ block, text }) => {
      const page = Array.isArray(block.pages) ? block.pages[0] : block.pages;
      return { id: block.id, type: block.type, preview: text.slice(0, 80), pageTitle: page?.title ?? "" };
    });
  const pageResults = (pages.data ?? []).map((page) => {
    const notebook = Array.isArray(page.notebooks) ? page.notebooks[0] : page.notebooks;
    return { id: page.id, title: page.title, notebookName: notebook?.name ?? "" };
  });
  return NextResponse.json({
    blocks: blockResults,
    pages: pageResults,
    files: (files.data ?? []).map((file) => ({ id: file.id, filename: file.filename, mimeType: file.mime_type })),
    commands: commands.data ?? [],
  });
}
