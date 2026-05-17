import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createServiceRoleClient,
  requireWorkspace,
  serializeError,
} from "@/services/api-utils";
import {
  generateImage,
  storeGeneratedImageBlock,
  type ImageGenQuality,
  type ImageGenSize,
} from "@/services/image-gen-service";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  prompt: z.string().min(1),
  workspaceId: z.string().uuid(),
  pageId: z.string().uuid(),
  parentBlockId: z.string().uuid().nullable().optional(),
  caption: z.string().optional(),
  size: z.enum(["1024x1024", "1536x1024", "1024x1536"]).default("1024x1024"),
  quality: z.enum(["low", "medium", "high"]).default("medium"),
  outputMode: z.enum(["replace", "append", "version"]).default("append"),
  existingBlockId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;
  const auth = await requireWorkspace(request, body.workspaceId);
  if ("error" in auth) return auth.error;

  const serviceClient = createServiceRoleClient();

  try {
    await assertPageAndParentBelongToWorkspace({
      supabase: serviceClient,
      workspaceId: body.workspaceId,
      pageId: body.pageId,
      parentBlockId: body.parentBlockId ?? null,
    });

    const image = await generateImage(body.prompt, {
      apiKey: auth.workspace.modelOptions.apiKeys?.openai,
      size: body.size as ImageGenSize,
      quality: body.quality as ImageGenQuality,
    });
    const block = await storeGeneratedImageBlock({
      supabase: serviceClient,
      workspaceId: body.workspaceId,
      pageId: body.pageId,
      parentBlockId: body.parentBlockId ?? null,
      prompt: body.prompt,
      revisedPrompt: image.revisedPrompt,
      imageBuffer: image.imageBuffer,
      mimeType: image.mimeType,
      size: body.size,
      quality: body.quality,
      caption: body.caption,
      outputMode: body.outputMode,
      existingBlockId: body.existingBlockId,
    });

    return NextResponse.json({
      success: true,
      blockId: block.id,
      block,
      revisedPrompt: image.revisedPrompt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Image generation failed", details: serializeError(error) },
      { status: 500 }
    );
  }
}

async function assertPageAndParentBelongToWorkspace(params: {
  supabase: ReturnType<typeof createServiceRoleClient>;
  workspaceId: string;
  pageId: string;
  parentBlockId: string | null;
}) {
  const { data: page, error: pageError } = await params.supabase
    .from("pages")
    .select("id")
    .eq("id", params.pageId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();

  if (pageError) throw new Error(pageError.message);
  if (!page) throw new Error("Page not found in workspace.");

  if (!params.parentBlockId) return;

  const { data: block, error: blockError } = await params.supabase
    .from("blocks")
    .select("id")
    .eq("id", params.parentBlockId)
    .eq("page_id", params.pageId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();

  if (blockError) throw new Error(blockError.message);
  if (!block) throw new Error("Parent block not found in workspace.");
}
