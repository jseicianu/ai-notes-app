import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Block, BlockVersion } from "@/lib/models/types";

async function getSupabase(client?: SupabaseClient) {
  return client ?? (await createClient());
}

function assertData<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Supabase returned no data");
  return data;
}

export async function saveBlockVersion(
  blockId: string,
  client?: SupabaseClient
): Promise<BlockVersion> {
  const supabase = await getSupabase(client);
  const { data: blockData, error: blockError } = await supabase
    .from("blocks")
    .select("id,type,content,version")
    .eq("id", blockId)
    .single();

  const block = assertData(blockData as Pick<Block, "id" | "type" | "content" | "version"> | null, blockError);

  const { data: versionData, error: versionError } = await supabase
    .from("block_versions")
    .insert({
      block_id: block.id,
      version: block.version,
      content: block.content,
      type: block.type,
    })
    .select()
    .single();

  const blockVersion = assertData(versionData as BlockVersion | null, versionError);

  const { error: updateError } = await supabase
    .from("blocks")
    .update({
      version: block.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", block.id);

  if (updateError) throw new Error(updateError.message);
  return blockVersion;
}

export async function getBlockVersions(
  blockId: string,
  client?: SupabaseClient
): Promise<BlockVersion[]> {
  const supabase = await getSupabase(client);
  const { data, error } = await supabase
    .from("block_versions")
    .select("id,block_id,version,content,type,created_at")
    .eq("block_id", blockId)
    .order("version", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as BlockVersion[];
}

export async function getBlockVersion(
  blockId: string,
  version: number,
  client?: SupabaseClient
): Promise<BlockVersion> {
  const supabase = await getSupabase(client);
  const { data, error } = await supabase
    .from("block_versions")
    .select("id,block_id,version,content,type,created_at")
    .eq("block_id", blockId)
    .eq("version", version)
    .single();

  return assertData(data as BlockVersion | null, error);
}

export async function getVersionCount(
  blockId: string,
  client?: SupabaseClient
): Promise<number> {
  const supabase = await getSupabase(client);
  const { count, error } = await supabase
    .from("block_versions")
    .select("id", { count: "exact", head: true })
    .eq("block_id", blockId);

  if (error) throw new Error(error.message);
  return count ?? 0;
}
