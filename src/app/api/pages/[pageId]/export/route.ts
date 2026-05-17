import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Block } from "@/lib/models/types";
import { blocksToMarkdown } from "@/services/export-service";

export const runtime = "nodejs";

const paramsSchema = z.object({ pageId: z.string().uuid() });

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ pageId: string }> }
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return Response.json({ error: "Invalid page ID" }, { status: 400 });
  const format = new URL(request.url).searchParams.get("format") ?? "markdown";
  if (format !== "markdown") return Response.json({ error: "Unsupported format" }, { status: 400 });
  const supabase = await createClient();
  const { data: page, error: pageError } = await supabase
    .from("pages")
    .select("id,title,workspace_id")
    .eq("id", params.data.pageId)
    .single();
  if (pageError || !page) return Response.json({ error: "Page not found" }, { status: 404 });
  const { data: blocks, error: blocksError } = await supabase
    .from("blocks")
    .select("*")
    .eq("page_id", params.data.pageId)
    .order("sort_order", { ascending: true });
  if (blocksError) return Response.json({ error: blocksError.message }, { status: 400 });
  const filename = `${String(page.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page"}.md`;
  return new Response(blocksToMarkdown((blocks ?? []) as Block[], page.title), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
