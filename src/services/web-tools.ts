import { PDFParse } from "pdf-parse";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface JinaReaderResponse {
  code?: number;
  status?: number;
  data?: {
    title?: string;
    content?: string;
    url?: string;
  };
}

export async function webSearch(
  query: string,
  options: {
    maxResults?: number;
    searchDepth?: "basic" | "advanced";
    apiKey?: string;
  } = {}
): Promise<{
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
  }>;
}> {
  const apiKey = options.apiKey || process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is required for web search");

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: options.maxResults ?? 5,
      search_depth: options.searchDepth ?? "basic",
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed with status ${response.status}`);
  }

  const data = (await response.json()) as { results?: TavilyResult[] };

  return {
    results: (data.results ?? []).map((result) => ({
      title: result.title ?? "",
      url: result.url ?? "",
      content: result.content ?? "",
      score: result.score ?? 0,
    })),
  };
}

export async function fetchRemotePDF(url: string): Promise<{
  filename: string;
  text: string;
  pageCount: number;
}> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`PDF fetch failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/pdf") && !isPdfUrl(url)) {
    throw new Error("URL does not appear to be a PDF");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const parser = new PDFParse({ data: bytes });

  try {
    const result = await parser.getText();
    return {
      filename: filenameFromUrl(url),
      text: result.text.trim(),
      pageCount: result.total ?? 0,
    };
  } finally {
    await parser.destroy();
  }
}

export function isPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathMatch = /\.pdf$/i.test(parsed.pathname);
    const hint = Array.from(parsed.searchParams.entries()).some(([key, value]) =>
      `${key}=${value}`.toLowerCase().includes("pdf")
    );
    return pathMatch || hint;
  } catch {
    return /\.pdf(\?.*)?$/i.test(url);
  }
}

export async function webScrape(url: string): Promise<{
  title: string;
  content: string;
  url: string;
  scrapedAt: string;
}> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (process.env.JINA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  }

  const response = await fetch(`https://r.jina.ai/${url}`, { headers });
  if (!response.ok) {
    throw new Error(`Jina Reader failed with status ${response.status}`);
  }

  const payload = (await response.json()) as JinaReaderResponse;
  const data = payload.data;
  if (!data || (payload.code !== undefined && payload.code >= 400)) {
    throw new Error("Jina Reader could not extract readable content from URL");
  }

  const content = data.content?.trim();
  if (!content) {
    throw new Error("Jina Reader returned empty content for URL");
  }

  return {
    title: data.title?.trim() || url,
    content,
    url: data.url || url,
    scrapedAt: new Date().toISOString(),
  };
}

export function createSourceSummary(content: string, maxLength = 500): string {
  const unavailableSummary = getUnavailablePageSummary(content);
  if (unavailableSummary) return unavailableSummary;

  const paragraphs = content
    .split(/\n{2,}/)
    .map(markdownToPlainText)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => isUsefulSummaryParagraph(paragraph));

  const fallbackLines = content
    .split("\n")
    .map(markdownToPlainText)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => isUsefulSummaryLine(line));

  const text =
    paragraphs.join(" ").trim() ||
    fallbackLines.join(" ").trim() ||
    markdownToPlainText(content);
  return truncateAtWord(text.replace(/\s+/g, " ").trim(), maxLength);
}

function getUnavailablePageSummary(content: string) {
  const lines = content
    .split("\n")
    .map(markdownToPlainText)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const hasUnavailableSignal = lines.some((line) => {
    const lower = line.toLowerCase();
    return (
      line === "404" ||
      lower.includes("not found") ||
      lower.includes("outdated link") ||
      lower.includes("typed the address incorrectly")
    );
  });
  if (!hasUnavailableSignal) return "";

  const detail = lines.find((line) => {
    const lower = line.toLowerCase();
    return (
      !isBoilerplateText(line) &&
      !COMMON_NAV_LABELS.has(lower) &&
      line !== "404" &&
      line.length >= 25
    );
  });

  return detail
    ? `This page appears to be unavailable or moved. ${detail}`
    : "This page appears to be unavailable or moved.";
}

function markdownToPlainText(markdown: string) {
  return markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[*-]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .trim();
}

function isUsefulSummaryParagraph(paragraph: string) {
  if (paragraph.length < 60) return false;
  if (isBoilerplateText(paragraph)) return false;

  const wordCount = paragraph.split(/\s+/).filter(Boolean).length;
  const linkLikeTokenCount = (paragraph.match(/https?:\/\/|www\.|\.(com|org|net|io|gov)\b/gi) ?? []).length;
  return wordCount >= 12 && linkLikeTokenCount / wordCount < 0.2;
}

function isUsefulSummaryLine(line: string) {
  if (!line || isBoilerplateText(line)) return false;
  if (/^\d{3}$/.test(line)) return true;
  if (line.length < 25) return false;

  const lower = line.toLowerCase();
  if (COMMON_NAV_LABELS.has(lower)) return false;
  return true;
}

function isBoilerplateText(text: string) {
  const lower = text.toLowerCase();
  if (
    lower.includes("skip to main content") ||
    lower.includes("contact sales") ||
    lower.includes("get started") ||
    lower.includes("log in") ||
    lower.includes("try chatgpt") ||
    lower.includes("opens in a new window")
  ) {
    return true;
  }

  return false;
}

const COMMON_NAV_LABELS = new Set([
  "about",
  "blog",
  "business",
  "company",
  "contact",
  "developers",
  "docs",
  "foundation",
  "home",
  "login",
  "products",
  "research",
  "search",
  "support",
]);

function truncateAtWord(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, lastSpace > 120 ? lastSpace : maxLength).trim()}...`;
}

function filenameFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || "document.pdf");
  } catch {
    return "document.pdf";
  }
}
