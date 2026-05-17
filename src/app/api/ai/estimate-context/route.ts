import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireWorkspace } from "@/services/api-utils";
import { resolveSources } from "@/services/source-service";
import { estimateTokens, getModelContextLimit } from "@/services/token-service";

export const runtime = "nodejs";

const sourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("block"), blockId: z.string().uuid() }),
  z.object({ type: z.literal("file"), fileId: z.string().uuid() }),
  z.object({ type: z.literal("url"), url: z.string().url() }),
  z.object({ type: z.literal("paste"), content: z.string() }),
  z.object({ type: z.literal("rag"), query: z.string().min(1), limit: z.number().int().positive().optional() }),
  z.object({ type: z.literal("image"), storageUrl: z.string().url(), mimeType: z.string() }),
]);

const schema = z.object({
  prompt: z.string(),
  sources: z.array(sourceSchema).default([]),
  contextBlocks: z
    .array(
      z.object({
        id: z.string().optional(),
        type: z.string().optional(),
        label: z.string().optional(),
        content: z.unknown(),
      })
    )
    .default([]),
  contextMode: z.enum(["selected_sources", "blocks_above", "none"]).default("selected_sources"),
  model: z.object({ provider: z.string(), name: z.string() }),
  workspaceId: z.string().uuid(),
  pageId: z.string().uuid().optional(),
  agentMode: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const auth = await requireWorkspace(request, body.workspaceId);
  if ("error" in auth) return auth.error;

  const resolved =
    body.contextMode !== "none" && body.sources.length
      ? await resolveSources(body.sources, body.workspaceId)
      : [];
  const systemPrompt = body.agentMode ? 800 : 500;
  const userPrompt = estimateTokens(body.prompt);
  const IMAGE_TOKEN_ESTIMATE = 1600;
  const explicitSources = resolved.reduce((sum, source) => sum + (source.type === "image" ? IMAGE_TOKEN_ESTIMATE : estimateTokens(source.content)), 0);
  const contextBlocks =
    body.contextMode === "blocks_above"
      ? body.contextBlocks.reduce(
          (sum, block) => sum + estimateTokens(JSON.stringify(block.content ?? "")),
          0
        )
      : 0;
  const sources = explicitSources + contextBlocks;
  const total = systemPrompt + userPrompt + sources;
  const modelLimit = getModelContextLimit(body.model.provider, body.model.name);
  const percentUsed = Math.round((total / modelLimit) * 10000) / 100;

  return NextResponse.json({
    estimatedTokens: total,
    modelLimit,
    percentUsed,
    breakdown: { systemPrompt, userPrompt, sources, contextBlocks, total },
    ...(percentUsed > 80 ? { warning: `Context is ${percentUsed}% of model limit` } : {}),
  });
}
