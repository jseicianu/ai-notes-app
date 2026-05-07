import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { createClient } from "@/lib/supabase/server";

type SourceType = "block" | "file" | "page";

export async function embedContent(params: {
  workspaceId: string;
  sourceType: SourceType;
  sourceId: string;
  content: string;
}): Promise<void> {
  const supabase = await createClient();
  const chunks = chunkText(params.content);

  await deleteEmbeddings({
    sourceType: params.sourceType,
    sourceId: params.sourceId,
  });

  if (chunks.length === 0) return;

  const rows = await Promise.all(
    chunks.map(async (chunk, index) => {
      const { embedding } = await embed({
        model: openai.embedding("text-embedding-3-small"),
        value: chunk,
      });

      return {
        workspace_id: params.workspaceId,
        source_type: params.sourceType,
        source_id: params.sourceId,
        chunk_index: index,
        content: chunk,
        embedding,
      };
    })
  );

  const { error } = await supabase.from("embeddings").insert(rows);
  if (error) throw new Error(error.message);
}

export async function searchWorkspace(params: {
  workspaceId: string;
  query: string;
  limit?: number;
}): Promise<
  Array<{
    content: string;
    sourceType: string;
    sourceId: string;
    similarity: number;
  }>
> {
  const supabase = await createClient();
  const { embedding } = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: params.query,
  });

  const { data, error } = await supabase.rpc("search_embeddings", {
    query_embedding: embedding,
    match_workspace_id: params.workspaceId,
    match_count: params.limit ?? 10,
  });

  if (error) throw new Error(error.message);

  return ((data ?? []) as EmbeddingSearchRow[]).map((row) => ({
    content: row.content,
    sourceType: row.source_type,
    sourceId: row.source_id,
    similarity: row.similarity,
  }));
}

export async function deleteEmbeddings(params: {
  sourceType: string;
  sourceId: string;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("embeddings")
    .delete()
    .eq("source_type", params.sourceType)
    .eq("source_id", params.sourceId);

  if (error) throw new Error(error.message);
}

interface EmbeddingSearchRow {
  content: string;
  source_type: string;
  source_id: string;
  similarity: number;
}

function chunkText(content: string, targetWords = 375): string[] {
  const words = content.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];

  for (let index = 0; index < words.length; index += targetWords) {
    chunks.push(words.slice(index, index + targetWords).join(" "));
  }

  return chunks;
}
