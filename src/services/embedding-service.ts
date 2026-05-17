import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { createHash } from "crypto";
import type { Block, SearchResult } from "@/lib/models/types";
import { createClient } from "@/lib/supabase/server";
import { extractBlockText } from "@/services/source-service";

type SourceType = "block" | "file" | "page";
const SKIPPED_BLOCK_TYPES = new Set(["separator", "input", "input_group", "error"]);

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
  sourceTypes?: SourceType[];
}): Promise<
  Array<{
    id: string;
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

  return ((data ?? []) as EmbeddingSearchRow[])
    .filter(
      (row) =>
        !params.sourceTypes?.length ||
        params.sourceTypes.includes(row.source_type as SourceType)
    )
    .map((row) => ({
      id: row.id,
      content: row.content,
      sourceType: row.source_type,
      sourceId: row.source_id,
      similarity: row.similarity,
    }));
}

export async function embedBlock(params: {
  workspaceId: string;
  blockId: string;
}): Promise<{ embedded: boolean; reason?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blocks")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.blockId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Block not found");

  const block = data as Block;
  if (SKIPPED_BLOCK_TYPES.has(block.type)) {
    return { embedded: false, reason: "skipped_type" };
  }

  const text = extractBlockText(block).trim();
  if (text.length < 20) return { embedded: false, reason: "too_short" };

  const hash = computeHash(text);
  if (await hasUnchangedEmbedding("block", block.id, hash)) {
    return { embedded: false, reason: "unchanged" };
  }

  await embedContent({
    workspaceId: params.workspaceId,
    sourceType: "block",
    sourceId: block.id,
    content: text,
  });
  await setContentHash("block", block.id, hash);

  return { embedded: true };
}

export async function embedPage(params: {
  workspaceId: string;
  pageId: string;
}): Promise<{ embedded: boolean; reason?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blocks")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("page_id", params.pageId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);

  const text = ((data ?? []) as Block[])
    .filter((block) => !SKIPPED_BLOCK_TYPES.has(block.type))
    .map(extractBlockText)
    .map((content) => content.trim())
    .filter(Boolean)
    .join("\n\n");

  if (text.length < 20) return { embedded: false, reason: "too_short" };

  const hash = computeHash(text);
  if (await hasUnchangedEmbedding("page", params.pageId, hash)) {
    return { embedded: false, reason: "unchanged" };
  }

  await embedContent({
    workspaceId: params.workspaceId,
    sourceType: "page",
    sourceId: params.pageId,
    content: text,
  });
  await setContentHash("page", params.pageId, hash);

  return { embedded: true };
}

export async function embedBatch(params: {
  workspaceId: string;
  batchSize?: number;
}): Promise<{ total: number; processed: number; skipped: number; errors: number }> {
  const supabase = await createClient();
  const { data: blocks, error: blocksError } = await supabase
    .from("blocks")
    .select("id,type")
    .eq("workspace_id", params.workspaceId)
    .not("type", "in", `(${Array.from(SKIPPED_BLOCK_TYPES).join(",")})`);

  if (blocksError) throw new Error(blocksError.message);

  const { data: pages, error: pagesError } = await supabase
    .from("pages")
    .select("id")
    .eq("workspace_id", params.workspaceId)
    .eq("is_archived", false);

  if (pagesError) throw new Error(pagesError.message);

  const tasks = [
    ...((blocks ?? []) as Array<{ id: string }>).map((block) => ({
      type: "block" as const,
      id: block.id,
    })),
    ...((pages ?? []) as Array<{ id: string }>).map((page) => ({
      type: "page" as const,
      id: page.id,
    })),
  ];

  let processed = 0;
  let skipped = 0;
  let errors = 0;
  const batchSize = params.batchSize ?? 10;

  for (let index = 0; index < tasks.length; index += batchSize) {
    const batch = tasks.slice(index, index + batchSize);
    const results = await Promise.allSettled(
      batch.map((task) =>
        task.type === "block"
          ? embedBlock({ workspaceId: params.workspaceId, blockId: task.id })
          : embedPage({ workspaceId: params.workspaceId, pageId: task.id })
      )
    );

    for (const result of results) {
      if (result.status === "rejected") {
        errors += 1;
      } else if (result.value.embedded) {
        processed += 1;
      } else {
        skipped += 1;
      }
    }
  }

  return { total: tasks.length, processed, skipped, errors };
}

export async function enrichSearchResults(
  results: Array<{
    id?: string;
    content: string;
    sourceType: string;
    sourceId: string;
    similarity: number;
  }>,
  workspaceId: string
): Promise<SearchResult[]> {
  const supabase = await createClient();
  const blockIds = uniqueIds(results, "block");
  const pageIds = uniqueIds(results, "page");
  const fileIds = uniqueIds(results, "file");

  const [blockRows, fileRows] = await Promise.all([
    blockIds.length
      ? supabase
          .from("blocks")
          .select("id,type,page_id")
          .eq("workspace_id", workspaceId)
          .in("id", blockIds)
      : Promise.resolve({ data: [], error: null }),
    fileIds.length
      ? supabase
          .from("files")
          .select("id,filename")
          .eq("workspace_id", workspaceId)
          .in("id", fileIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (blockRows.error) throw new Error(blockRows.error.message);
  if (fileRows.error) throw new Error(fileRows.error.message);

  const blockPageIds = (blockRows.data ?? [])
    .map((row) => row.page_id as string | undefined)
    .filter((id): id is string => Boolean(id));
  const allPageIds = Array.from(new Set([...pageIds, ...blockPageIds]));

  const pageRows = allPageIds.length
    ? await supabase
        .from("pages")
        .select("id,title,notebook_id")
        .eq("workspace_id", workspaceId)
        .in("id", allPageIds)
    : { data: [], error: null };

  if (pageRows.error) throw new Error(pageRows.error.message);

  const notebookIds = Array.from(
    new Set(
      (pageRows.data ?? [])
        .map((row) => row.notebook_id as string | undefined)
        .filter((id): id is string => Boolean(id))
    )
  );

  const notebookRows = notebookIds.length
    ? await supabase
        .from("notebooks")
        .select("id,name")
        .eq("workspace_id", workspaceId)
        .in("id", notebookIds)
    : { data: [], error: null };

  if (notebookRows.error) throw new Error(notebookRows.error.message);

  const notebooksById = new Map(
    (notebookRows.data ?? []).map((row) => [
      row.id as string,
      { id: row.id as string, name: row.name as string },
    ])
  );
  const pagesById = new Map(
    (pageRows.data ?? []).map((row) => {
      const notebook = notebooksById.get(row.notebook_id as string);
      return [
        row.id as string,
        {
          pageId: row.id as string,
          pageTitle: row.title as string,
          notebookId: notebook?.id,
          notebookName: notebook?.name,
        },
      ];
    })
  );

  const blocks = new Map(
    (blockRows.data ?? []).map((row) => {
      const page = pagesById.get(row.page_id as string);
      return [
        row.id as string,
        {
          pageId: page?.pageId,
          pageTitle: page?.pageTitle,
          notebookId: page?.notebookId,
          notebookName: page?.notebookName,
          blockType: row.type as string,
        },
      ];
    })
  );
  const files = new Map(
    (fileRows.data ?? []).map((row) => [
      row.id as string,
      { filename: row.filename as string },
    ])
  );

  await removeStaleSearchEmbeddings({
    blockIds,
    foundBlockIds: Array.from(blocks.keys()),
    pageIds,
    foundPageIds: Array.from(pagesById.keys()),
    fileIds,
    foundFileIds: Array.from(files.keys()),
  });

  const enriched: SearchResult[] = [];

  for (const result of results) {
    if (result.sourceType === "block") {
      const metadata = blocks.get(result.sourceId);
      if (!metadata?.pageTitle || !metadata.notebookName) continue;
      const notebookName = metadata?.notebookName ?? "Notebook";
      const pageTitle = metadata?.pageTitle ?? "Page";
      const blockType = metadata?.blockType ?? "block";
      enriched.push({
        ...baseSearchResult(result),
        sourceType: "block",
        metadata: {
          ...metadata,
          breadcrumb: `${notebookName} > ${pageTitle} > ${blockType} block`,
        },
      });
      continue;
    }

    if (result.sourceType === "page") {
      const metadata = pagesById.get(result.sourceId);
      if (!metadata?.pageTitle || !metadata.notebookName) continue;
      const notebookName = metadata?.notebookName ?? "Notebook";
      const pageTitle = metadata?.pageTitle ?? "Page";
      enriched.push({
        ...baseSearchResult(result),
        sourceType: "page",
        metadata: {
          ...metadata,
          breadcrumb: `${notebookName} > ${pageTitle}`,
        },
      });
      continue;
    }

    if (result.sourceType === "file") {
      const metadata = files.get(result.sourceId);
      if (!metadata?.filename) continue;
      enriched.push({
        ...baseSearchResult(result),
        sourceType: "file",
        metadata: {
          ...metadata,
          breadcrumb: metadata?.filename ?? "File",
        },
      });
      continue;
    }

    enriched.push({
      ...baseSearchResult(result),
      sourceType: "web",
      metadata: { breadcrumb: "Web result" },
    });
  }

  return enriched;
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
  id: string;
  content: string;
  source_type: string;
  source_id: string;
  similarity: number;
}

function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function hasUnchangedEmbedding(
  sourceType: SourceType,
  sourceId: string,
  contentHash: string
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("embeddings")
    .select("id")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .eq("content_hash", contentHash)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function setContentHash(
  sourceType: SourceType,
  sourceId: string,
  contentHash: string
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("embeddings")
    .update({ content_hash: contentHash })
    .eq("source_type", sourceType)
    .eq("source_id", sourceId);

  if (error) throw new Error(error.message);
}

function uniqueIds(
  results: Array<{ sourceType: string; sourceId: string }>,
  sourceType: SourceType
) {
  return Array.from(
    new Set(
      results
        .filter((result) => result.sourceType === sourceType)
        .map((result) => result.sourceId)
    )
  );
}

function baseSearchResult(result: {
  id?: string;
  content: string;
  sourceType: string;
  sourceId: string;
  similarity: number;
}) {
  return {
    id: result.id ?? `${result.sourceType}:${result.sourceId}`,
    content: result.content,
    sourceId: result.sourceId,
    similarity: result.similarity,
  };
}

async function removeStaleSearchEmbeddings(params: {
  blockIds: string[];
  foundBlockIds: string[];
  pageIds: string[];
  foundPageIds: string[];
  fileIds: string[];
  foundFileIds: string[];
}) {
  const stale = [
    ...difference(params.blockIds, params.foundBlockIds).map((id) => ({
      sourceType: "block" as const,
      sourceId: id,
    })),
    ...difference(params.pageIds, params.foundPageIds).map((id) => ({
      sourceType: "page" as const,
      sourceId: id,
    })),
    ...difference(params.fileIds, params.foundFileIds).map((id) => ({
      sourceType: "file" as const,
      sourceId: id,
    })),
  ];

  if (stale.length === 0) return;

  const supabase = await createClient();
  await Promise.all(
    stale.map((source) =>
      supabase
        .from("embeddings")
        .delete()
        .eq("source_type", source.sourceType)
        .eq("source_id", source.sourceId)
    )
  );
}

function difference(values: string[], foundValues: string[]) {
  const found = new Set(foundValues);
  return values.filter((value) => !found.has(value));
}

function chunkText(content: string, targetWords = 375): string[] {
  const words = content.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];

  for (let index = 0; index < words.length; index += targetWords) {
    chunks.push(words.slice(index, index + targetWords).join(" "));
  }

  return chunks;
}
