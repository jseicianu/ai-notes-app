import { PDFParse } from "pdf-parse";
import { createClient } from "@/lib/supabase/server";

export async function extractFileText(params: {
  storagePath: string;
  mimeType: string;
  filename: string;
}): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("files")
    .download(params.storagePath);

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`File not found: ${params.filename}`);

  const bytes = Buffer.from(await data.arrayBuffer());
  const mimeType = normalizeMimeType(params.mimeType, params.filename);

  if (isPlainText(mimeType, params.filename)) {
    return bytes.toString("utf8");
  }

  if (mimeType === "application/json") {
    return formatJson(bytes.toString("utf8"));
  }

  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      return result.text.trim();
    } finally {
      await parser.destroy();
    }
  }

  return `[Unsupported file type: ${params.mimeType}]`;
}

function normalizeMimeType(mimeType: string, filename: string) {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim() || "";
  const extension = filename.toLowerCase().split(".").pop();

  if (normalized) return normalized;
  if (extension === "md" || extension === "markdown") return "text/markdown";
  if (extension === "csv") return "text/csv";
  if (extension === "json") return "application/json";
  if (extension === "pdf") return "application/pdf";
  if (extension === "txt") return "text/plain";

  return "application/octet-stream";
}

function isPlainText(mimeType: string, filename: string) {
  const extension = filename.toLowerCase().split(".").pop();
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/csv" ||
    extension === "txt" ||
    extension === "md" ||
    extension === "markdown" ||
    extension === "csv"
  );
}

function formatJson(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
