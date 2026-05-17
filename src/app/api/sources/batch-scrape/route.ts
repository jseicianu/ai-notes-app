import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createSseStream, requireWorkspace, serializeError } from "@/services/api-utils";
import { embedContent } from "@/services/embedding-service";
import { webScrape, isPdfUrl, fetchRemotePDF, createSourceSummary } from "@/services/web-tools";

export const runtime = "nodejs";

const schema = z.object({
  urls: z.array(z.string().url()).min(1).max(10),
  workspaceId: z.string().uuid(),
  pageId: z.string().uuid(),
  createSourceCards: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const auth = await requireWorkspace(request, body.workspaceId);
  if ("error" in auth) return auth.error;
  const supabase = await createClient();

  return createSseStream(async (send) => {
    for (const url of body.urls) {
      try {
        const scraped = isPdfUrl(url)
          ? await fetchRemotePDF(url).then((pdf) => ({
              title: pdf.filename,
              content: pdf.text,
              url,
              scrapedAt: new Date().toISOString(),
            }))
          : await webScrape(url);
        let blockId: string | undefined;
        if (body.createSourceCards) {
          const { data: last } = await supabase
            .from("blocks")
            .select("sort_order")
            .eq("page_id", body.pageId)
            .order("sort_order", { ascending: false })
            .limit(1)
            .maybeSingle();
          const { data: block, error } = await supabase
            .from("blocks")
            .insert({
              workspace_id: body.workspaceId,
              page_id: body.pageId,
              type: "source_card",
              sort_order: (last?.sort_order ?? 0) + 1,
              content: {
                url,
                title: scraped.title,
                summary: createSourceSummary(scraped.content),
                full_content: scraped.content,
                scraped_at: scraped.scrapedAt,
              },
            })
            .select()
            .single();
          if (error) throw new Error(error.message);
          blockId = block.id;
          await embedContent({
            workspaceId: body.workspaceId,
            sourceType: "block",
            sourceId: block.id,
            content: scraped.content,
          });
        }
        send("progress", { url, status: "success", title: scraped.title, blockId });
      } catch (error) {
        send("progress", { url, status: "error", error: serializeError(error).message });
      }
    }
    send("complete", { total: body.urls.length });
  });
}
