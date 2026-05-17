import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { SearchResult } from "@/lib/models/types";
import { requireWorkspace } from "@/services/api-utils";
import { enrichSearchResults, searchWorkspace } from "@/services/embedding-service";
import { webSearch } from "@/services/web-tools";

export const runtime = "nodejs";

const schema = z.object({
  query: z.string().min(1),
  workspaceId: z.string().uuid(),
  limit: z.number().int().min(1).max(20).default(10),
  sourceTypes: z.array(z.enum(["block", "page", "file"])).optional(),
  includeWeb: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const auth = await requireWorkspace(request, body.workspaceId);
  if ("error" in auth) return auth.error;

  const [workspaceResults, webResults] = await Promise.all([
    searchWorkspace({
      workspaceId: body.workspaceId,
      query: body.query,
      limit: body.limit,
      sourceTypes: body.sourceTypes,
    }),
    body.includeWeb
      ? webSearch(body.query, {
          maxResults: body.limit,
          apiKey: auth.workspace.tavilyApiKey,
        }).catch(() => ({ results: [] }))
      : Promise.resolve({ results: [] }),
  ]);

  const enriched = await enrichSearchResults(workspaceResults, body.workspaceId);
  const web: SearchResult[] = webResults.results.map((result) => ({
    id: `web:${result.url}`,
    content: result.content,
    sourceType: "web",
    sourceId: result.url,
    similarity: result.score,
    metadata: {
      breadcrumb: result.title || result.url,
      url: result.url,
      title: result.title,
    },
  }));

  return NextResponse.json({
    results: [...enriched, ...web]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, body.limit),
  });
}
