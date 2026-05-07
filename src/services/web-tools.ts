import { extract } from "@extractus/article-extractor";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

export async function webSearch(
  query: string,
  options: {
    maxResults?: number;
    searchDepth?: "basic" | "advanced";
  } = {}
): Promise<{
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
  }>;
}> {
  const apiKey = process.env.TAVILY_API_KEY;
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

export async function webScrape(url: string): Promise<{
  title: string;
  content: string;
  url: string;
  scrapedAt: string;
}> {
  const article = await extract(url, {
    contentLengthThreshold: 80,
    descriptionLengthThreshold: 40,
  });

  if (!article) {
    throw new Error("Could not extract readable content from URL");
  }

  return {
    title: article.title ?? url,
    content: stripHtml(article.content ?? article.description ?? ""),
    url: article.url ?? url,
    scrapedAt: new Date().toISOString(),
  };
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
