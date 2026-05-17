import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block } from "@/lib/models/types";
import { saveBlockVersion } from "@/services/block-version-service";

export type ImageGenSize = "1024x1024" | "1536x1024" | "1024x1536";
export type ImageGenQuality = "low" | "medium" | "high";

export interface ImageGenOptions {
  apiKey?: string;
  size?: ImageGenSize;
  quality?: ImageGenQuality;
}

export interface ImageGenResult {
  imageBuffer: Buffer;
  revisedPrompt: string;
  mimeType: string;
}

export interface StoreGeneratedImageBlockParams {
  supabase: SupabaseClient;
  workspaceId: string;
  pageId: string;
  parentBlockId?: string | null;
  prompt: string;
  revisedPrompt: string;
  imageBuffer: Buffer;
  mimeType: string;
  size: ImageGenSize;
  quality: ImageGenQuality;
  caption?: string;
  outputMode?: "replace" | "append" | "version";
  existingBlockId?: string;
}

export async function generateImage(
  prompt: string,
  options: ImageGenOptions = {}
): Promise<ImageGenResult> {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to generate images.");
  }

  const client = new OpenAI({ apiKey });
  const size = options.size ?? "1024x1024";
  const quality = options.quality ?? "medium";

  try {
    const response = await client.images.generate({
      model: "gpt-image-2",
      prompt,
      n: 1,
      size,
      quality,
    });

    const image = response.data?.[0];
    if (!image) {
      throw new Error("OpenAI returned no image data.");
    }

    if (image.b64_json) {
      return {
        imageBuffer: Buffer.from(image.b64_json, "base64"),
        revisedPrompt: image.revised_prompt ?? prompt,
        mimeType: "image/png",
      };
    }

    if (image.url) {
      const imageResponse = await fetch(image.url);
      if (!imageResponse.ok) {
        throw new Error(`Failed to download generated image (${imageResponse.status}).`);
      }

      return {
        imageBuffer: Buffer.from(await imageResponse.arrayBuffer()),
        revisedPrompt: image.revised_prompt ?? prompt,
        mimeType: imageResponse.headers.get("content-type") || "image/png",
      };
    }

    throw new Error("OpenAI returned an unsupported image payload.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Image generation failed: ${message}`);
  }
}

export async function storeGeneratedImageBlock(
  params: StoreGeneratedImageBlockParams
): Promise<Block> {
  const filename = `generated-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;
  const storagePath = `${params.workspaceId}/generated/${filename}`;
  const now = new Date().toISOString();
  let uploaded = false;

  const { error: uploadError } = await params.supabase.storage
    .from("files")
    .upload(storagePath, params.imageBuffer, {
      contentType: params.mimeType,
      upsert: false,
    });

  if (uploadError) throw new Error(uploadError.message);
  uploaded = true;

  try {
    const { data: fileRecord, error: fileError } = await params.supabase
      .from("files")
      .insert({
        workspace_id: params.workspaceId,
        filename,
        mime_type: params.mimeType,
        size_bytes: params.imageBuffer.length,
        storage_path: storagePath,
        metadata: {
          source: "ai_generated",
          original_prompt: params.prompt,
          revised_prompt: params.revisedPrompt,
          size: params.size,
          quality: params.quality,
        },
      })
      .select("id")
      .single();

    if (fileError || !fileRecord) {
      throw new Error(fileError?.message || "Failed to save generated image file.");
    }

    const content = {
      file_id: fileRecord.id as string,
      filename,
      mime_type: params.mimeType,
      size: params.imageBuffer.length,
      storage_path: storagePath,
      caption: params.caption?.trim() || params.revisedPrompt,
      width_percent: 100,
      original_prompt: params.prompt,
      revised_prompt: params.revisedPrompt,
      generated_at: now,
    };

    if (params.existingBlockId && params.outputMode !== "append") {
      if (params.outputMode === "version") {
        await saveBlockVersion(params.existingBlockId, params.supabase);
      }

      const query = params.supabase
        .from("blocks")
        .update({
          type: "image",
          content,
          updated_at: now,
        })
        .eq("id", params.existingBlockId)
        .eq("workspace_id", params.workspaceId)
        .eq("page_id", params.pageId)
        .eq("type", "image");

      const scopedQuery = params.parentBlockId
        ? query.eq("parent_block_id", params.parentBlockId)
        : query.is("parent_block_id", null);

      const { data, error } = await scopedQuery.select().single();
      if (error) throw new Error(error.message);
      return data as Block;
    }

    const sortOrder = await getNextSortOrder(params.supabase, params.pageId);
    const { data, error } = await params.supabase
      .from("blocks")
      .insert({
        workspace_id: params.workspaceId,
        page_id: params.pageId,
        parent_block_id: params.parentBlockId ?? null,
        sort_order: sortOrder,
        type: "image",
        content,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as Block;
  } catch (error) {
    if (uploaded) {
      await params.supabase.storage.from("files").remove([storagePath]);
    }
    throw error;
  }
}

async function getNextSortOrder(
  supabase: SupabaseClient,
  pageId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("blocks")
    .select("sort_order")
    .eq("page_id", pageId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return typeof data?.sort_order === "number" ? data.sort_order + 1 : 0;
}
