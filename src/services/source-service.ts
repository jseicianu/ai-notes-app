import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block, FileRecord } from "@/lib/models/types";
import { createClient } from "@/lib/supabase/server";
import { embedContent, searchWorkspace } from "@/services/embedding-service";
import { extractFileText } from "@/services/file-extraction-service";
import { webScrape } from "@/services/web-tools";

export type SourceReference =
  | { type: "block"; blockId: string }
  | { type: "file"; fileId: string }
  | { type: "url"; url: string }
  | { type: "paste"; content: string }
  | { type: "rag"; query: string; limit?: number }
  | { type: "image"; storageUrl: string; mimeType: string };

export interface ResolvedSource {
  type: SourceReference["type"];
  label: string;
  content: string;
  metadata?: {
    url?: string;
    filename?: string;
    mimeType?: string;
    blockId?: string;
    similarity?: number;
  };
}

export async function resolveSources(
  sources: SourceReference[],
  workspaceId: string,
  client?: SupabaseClient
): Promise<ResolvedSource[]> {
  const resolved: ResolvedSource[] = [];

  for (const source of sources) {
    switch (source.type) {
      case "block":
        resolved.push(await resolveBlockSource(source.blockId, workspaceId, client));
        break;
      case "file":
        resolved.push(await resolveFileSource(source.fileId, workspaceId, client));
        break;
      case "url":
        resolved.push(await resolveUrlSource(source.url));
        break;
      case "paste":
        resolved.push({
          type: "paste",
          label: "Pasted text",
          content: source.content,
        });
        break;
      case "rag":
        resolved.push(await resolveRagSource(source, workspaceId));
        break;
      case "image":
        resolved.push(resolveImageSource(source));
        break;
    }
  }

  return resolved;
}

function resolveImageSource(
  source: Extract<SourceReference, { type: "image" }>
): ResolvedSource {
  return {
    type: "image",
    label: "Uploaded image",
    content: "",
    metadata: { url: source.storageUrl, mimeType: source.mimeType },
  };
}

async function resolveBlockSource(
  blockId: string,
  workspaceId: string,
  client?: SupabaseClient
): Promise<ResolvedSource> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("blocks")
    .select("*")
    .eq("id", blockId)
    .eq("workspace_id", workspaceId)
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Source block not found");

  const block = data as Block;
  if (block.type === "image") {
    const storagePath =
      stringValue(block.content?.storage_path) || stringValue(block.content?.storagePath);
    const mimeType =
      stringValue(block.content?.mime_type) ||
      stringValue(block.content?.mimeType) ||
      "image/png";
    const filename = stringValue(block.content?.filename) || "Image";
    const caption = stringValue(block.content?.caption);

    if (!storagePath) {
      throw new Error("Image source block is missing a storage path");
    }

    const { data: signedUrl, error: signedUrlError } = await supabase.storage
      .from("files")
      .createSignedUrl(storagePath, 60 * 60);

    if (signedUrlError || !signedUrl?.signedUrl) {
      throw new Error(signedUrlError?.message ?? "Unable to create image source URL");
    }

    return {
      type: "image",
      label: caption || filename,
      content: caption || "",
      metadata: {
        blockId: block.id,
        url: signedUrl.signedUrl,
        filename,
        mimeType,
      },
    };
  }

  return {
    type: "block",
    label: `${block.type} block`,
    content: extractBlockText(block),
    metadata: {
      blockId: block.id,
    },
  };
}

async function resolveFileSource(
  fileId: string,
  workspaceId: string,
  client?: SupabaseClient
): Promise<ResolvedSource> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("id", fileId)
    .eq("workspace_id", workspaceId)
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Source file not found");

  const file = data as FileRecord;
  let content = file.extracted_text;

  if (!content) {
    content = await extractFileText({
      storagePath: file.storage_path,
      mimeType: file.mime_type,
      filename: file.filename,
    });

    const { error: updateError } = await supabase
      .from("files")
      .update({ extracted_text: content })
      .eq("id", file.id)
      .eq("workspace_id", workspaceId);

    if (updateError) throw new Error(updateError.message);

    if (content.trim() && !content.startsWith("[Unsupported file type:")) {
      await embedContent({
        workspaceId,
        sourceType: "file",
        sourceId: file.id,
        content,
      });
    }
  }

  return {
    type: "file",
    label: file.filename,
    content,
    metadata: {
      filename: file.filename,
      mimeType: file.mime_type,
    },
  };
}

async function resolveUrlSource(url: string): Promise<ResolvedSource> {
  const scraped = await webScrape(url);

  return {
    type: "url",
    label: scraped.title || scraped.url,
    content: scraped.content,
    metadata: {
      url: scraped.url,
    },
  };
}

async function resolveRagSource(
  source: Extract<SourceReference, { type: "rag" }>,
  workspaceId: string
): Promise<ResolvedSource> {
  const results = await searchWorkspace({
    workspaceId,
    query: source.query,
    limit: source.limit,
  });

  return {
    type: "rag",
    label: `Workspace search: ${source.query}`,
    content: results
      .map(
        (result, index) =>
          `<result index="${index + 1}" source_type="${escapeAttribute(
            result.sourceType
          )}" source_id="${escapeAttribute(
            result.sourceId
          )}" similarity="${result.similarity.toFixed(4)}">\n${
            result.content
          }\n</result>`
      )
      .join("\n\n"),
    metadata: {
      similarity: results[0]?.similarity,
    },
  };
}

export function extractBlockText(block: Block): string {
  const content = block.content;
  if (!content) return "";

  switch (block.type) {
    case "text":
    case "heading":
    case "callout": {
      const doc = stringValue(content.doc);
      return doc ? stripHtml(doc) : stringValue(content.text) ?? "";
    }
    case "bulleted_list":
    case "numbered_list": {
      const doc = stringValue(content.doc);
      if (doc) return stripHtml(doc);
      const items = Array.isArray(content.items) ? content.items : [];
      return items
        .map((item) =>
          typeof item === "string"
            ? item
            : stringValue((item as Record<string, unknown>).text) ?? ""
        )
        .filter(Boolean)
        .join("\n");
    }
    case "table":
      return safeStringify({ columns: content.columns, rows: content.rows });
    case "json":
      return safeStringify(content.data ?? content);
    case "todo": {
      const items = Array.isArray(content.items) ? content.items : [];
      return items
        .map((item) => {
          const record = objectValue(item);
          const done = record.done === true ? "[x]" : "[ ]";
          return `${done} ${stringValue(record.text) ?? ""}`.trim();
        })
        .filter(Boolean)
        .join("\n");
    }
    case "output":
      return typeof content.data === "string"
        ? content.data
        : safeStringify(content.data ?? content);
    case "ai_cell":
      return stringValue(content.prompt) ?? "";
    case "file":
      return (
        stringValue(content.extracted_text) ||
        stringValue(content.filename) ||
        safeStringify(content)
      );
    case "source_card":
      return [
        stringValue(content.title),
        stringValue(content.full_content) || stringValue(content.summary),
        stringValue(content.url) ? `URL: ${content.url}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    case "code": {
      const lang = stringValue(content.language) || "plain";
      const codeText = stringValue(content.code) || "";
      return `\`\`\`${lang}\n${codeText}\n\`\`\``;
    }
    default:
      return safeStringify(content);
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeStringify(value: unknown) {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeAttribute(value: string) {
  return value.replaceAll('"', "&quot;");
}
