import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block } from "@/lib/models/types";
import { saveBlockVersion } from "@/services/block-version-service";

type OutputMode = "replace" | "append" | "version";
type ExistingOutputBlockRef = { id: string; type: string };

interface EnsureTextOutputBlockParams {
  supabase: SupabaseClient;
  workspaceId: string;
  pageId: string;
  parentBlockId?: string | null;
  text: string;
  outputMode: OutputMode;
  existingOutputBlocks: ExistingOutputBlockRef[];
  outputBlockIds: string[];
}

export async function ensureTextOutputBlock(
  params: EnsureTextOutputBlockParams
): Promise<string | null> {
  const text = params.text;
  if (!text.trim()) return null;

  const existingRunOutputId = await findOutputBlockFromRun(params);
  if (existingRunOutputId) return existingRunOutputId;

  const reusableOutputId =
    params.outputMode === "append"
      ? undefined
      : params.existingOutputBlocks.find((block) => block.type === "output")?.id;
  const sortOrder = await getTextOutputSortOrder(params);

  if (reusableOutputId) {
    if (params.outputMode === "version") {
      await saveBlockVersion(reusableOutputId, params.supabase);
    }

    const query = params.supabase
      .from("blocks")
      .update({
        type: "output",
        content: { format: "text", data: text },
        sort_order: sortOrder,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reusableOutputId)
      .eq("workspace_id", params.workspaceId)
      .eq("page_id", params.pageId);

    const scopedQuery = params.parentBlockId
      ? query.eq("parent_block_id", params.parentBlockId)
      : query.is("parent_block_id", null);

    const { data, error } = await scopedQuery.select("id").single();

    if (error) throw new Error(error.message);
    return (data as Pick<Block, "id">).id;
  }

  const { data, error } = await params.supabase
    .from("blocks")
    .insert({
      workspace_id: params.workspaceId,
      page_id: params.pageId,
      parent_block_id: params.parentBlockId ?? null,
      sort_order: sortOrder,
      type: "output",
      content: { format: "text", data: text },
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return (data as Pick<Block, "id">).id;
}

async function findOutputBlockFromRun(params: EnsureTextOutputBlockParams) {
  if (params.outputBlockIds.length === 0) return null;

  const scopedQuery = params.parentBlockId
    ? params.supabase
        .from("blocks")
        .select("id")
        .eq("workspace_id", params.workspaceId)
        .eq("page_id", params.pageId)
        .eq("parent_block_id", params.parentBlockId)
        .eq("type", "output")
        .in("id", params.outputBlockIds)
        .limit(1)
        .maybeSingle()
    : params.supabase
        .from("blocks")
        .select("id")
        .eq("workspace_id", params.workspaceId)
        .eq("page_id", params.pageId)
        .is("parent_block_id", null)
        .eq("type", "output")
        .in("id", params.outputBlockIds)
        .limit(1)
        .maybeSingle();

  const { data, error } = await scopedQuery;
  if (error) throw new Error(error.message);
  return (data as Pick<Block, "id"> | null)?.id ?? null;
}

async function getTextOutputSortOrder(params: EnsureTextOutputBlockParams) {
  if (!params.parentBlockId) {
    const { data, error } = await params.supabase
      .from("blocks")
      .select("sort_order")
      .eq("workspace_id", params.workspaceId)
      .eq("page_id", params.pageId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return typeof data?.sort_order === "number" ? data.sort_order + 1 : 0;
  }

  const { data, error } = await params.supabase
    .from("blocks")
    .select("sort_order")
    .eq("id", params.parentBlockId)
    .eq("workspace_id", params.workspaceId)
    .eq("page_id", params.pageId)
    .single();

  if (error) throw new Error(error.message);
  return ((data as { sort_order: number } | null)?.sort_order ?? 0) + 0.5;
}
