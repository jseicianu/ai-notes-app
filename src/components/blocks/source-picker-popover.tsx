"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Search,
  Upload,
  Globe,
  Type,
  FileText,
  Check,
  ClipboardPaste,
  Settings,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  PlayCircle,
  FileDown,
  ImageIcon,
} from "lucide-react";
import { BlockTypeIcon } from "./block-wrapper";
import { getBlockNumberMap } from "./block-display-order";
import type { Block } from "@/lib/models/types";
import type { SourceReference } from "@/services/source-service";

/* ── Types ─────────────────────────────────────────────── */

export interface SourceItem {
  ref: SourceReference;
  label: string;
  sourceType: "file" | "url" | "block" | "paste" | "image";
  meta?: string;
}

type FilterTab = "all" | "files" | "blocks" | "web" | "paste";

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "files", label: "Files" },
  { id: "blocks", label: "Blocks" },
  { id: "web", label: "Web" },
  { id: "paste", label: "Paste" },
];

const SOURCE_TYPE_ICONS = {
  file: FileText,
  url: Globe,
  block: Type,
  paste: ClipboardPaste,
  image: ImageIcon,
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  file: "File",
  url: "Web Page",
  block: "Block",
  paste: "Pasted Text",
  image: "Image",
};

/* ── Block helpers ─────────────────────────────────────── */

const BLOCK_TYPE_LABELS: Record<string, string> = {
  text: "Text Note",
  heading: "Heading",
  table: "Table",
  json: "JSON",
  todo: "To-do",
  output: "Output",
  ai_cell: "AI Cell",
  callout: "Callout",
  command_ref: "Command",
  bulleted_list: "Bulleted List",
  numbered_list: "Numbered List",
  image: "Image",
};

function getBlockPreview(block: Block, maxLen = 40): string {
  const c = block.content;
  if (!c) return "";
  switch (block.type) {
    case "text":
    case "heading":
    case "callout": {
      const doc = c.doc as string | undefined;
      return doc
        ? doc.replace(/<[^>]*>/g, "").trim().slice(0, maxLen)
        : ((c.text as string) || "").slice(0, maxLen);
    }
    case "table": {
      const cols = c.columns as string[] | undefined;
      const rows = c.rows as unknown[] | undefined;
      return cols ? `${cols.join(", ")} · ${rows?.length ?? 0} rows` : "Table";
    }
    case "ai_cell":
      return ((c.prompt as string) || "").slice(0, maxLen);
    case "todo": {
      const items = c.items as Array<{ text: string }> | undefined;
      return items
        ? items.map((i) => i.text).join(", ").slice(0, maxLen)
        : "";
    }
    case "json":
      return JSON.stringify(c.data).slice(0, maxLen);
    case "image":
      return ((c.caption as string) || (c.filename as string) || "Image").slice(0, maxLen);
    default:
      return "";
  }
}

/* ── Add Source Sub-views ──────────────────────────────── */

function UploadView({
  onUploadFile,
}: {
  onUploadFile: (file: File) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onUploadFile(f);
    },
    [onUploadFile]
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadFile(f);
        }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`w-full h-28 flex flex-col items-center justify-center gap-2
                   border-2 border-dashed rounded-lg transition-all cursor-pointer
                   ${
                     dragOver
                       ? "border-blue-400 bg-blue-50/50"
                       : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/50"
                   }`}
      >
        <Upload
          className={`h-5 w-5 ${dragOver ? "text-blue-500" : "text-gray-400"}`}
        />
        <span className="text-[12px] text-gray-500">
          Drop file or click to browse
        </span>
        <span className="text-[10px] text-gray-400">
          PDF, CSV, TXT, Markdown, JSON
        </span>
      </button>
    </>
  );
}


function PasteView({
  onAddPaste,
}: {
  onAddPaste: (text: string) => void;
}) {
  const [pasteValue, setPasteValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="space-y-2">
      <textarea
        ref={textareaRef}
        placeholder="Paste text, notes, or data..."
        value={pasteValue}
        onChange={(e) => setPasteValue(e.target.value)}
        className="w-full h-20 px-3 py-2 text-[13px] border border-gray-300 rounded-lg
                   outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500
                   placeholder:text-gray-400 resize-none leading-relaxed"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-400">
          {pasteValue
            ? `${pasteValue.split(/\s+/).filter(Boolean).length} words`
            : ""}
        </span>
        <button
          onClick={() => {
            if (pasteValue.trim()) {
              onAddPaste(pasteValue.trim());
              setPasteValue("");
            }
          }}
          disabled={!pasteValue.trim()}
          className="h-8 px-3 text-[12px] font-medium text-white bg-blue-500
                     rounded-md hover:bg-blue-600 transition-colors cursor-pointer
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add text
        </button>
      </div>
    </div>
  );
}

function BlocksView({
  pageBlocks,
  numberingBlocks,
  selectedBlockIds,
  onToggleBlock,
}: {
  pageBlocks: Block[];
  numberingBlocks?: Block[];
  selectedBlockIds: Set<string>;
  onToggleBlock: (block: Block) => void;
}) {
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const selectableBlocks = useMemo(
    () =>
      pageBlocks.filter(
        (b) => !["separator", "input", "input_group"].includes(b.type)
      ),
    [pageBlocks]
  );

  const blockNumberMap = useMemo(
    () => getBlockNumberMap(numberingBlocks ?? pageBlocks),
    [numberingBlocks, pageBlocks]
  );

  const filtered = search
    ? selectableBlocks.filter((b) => {
        const label = (
          BLOCK_TYPE_LABELS[b.type] || b.type
        ).toLowerCase();
        const preview = getBlockPreview(b).toLowerCase();
        const q = search.toLowerCase();
        return label.includes(q) || preview.includes(q);
      })
    : selectableBlocks;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search blocks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-8 pl-8 pr-3 text-[12px] border border-gray-200 rounded-md
                     outline-none focus:border-gray-300 bg-gray-50
                     placeholder:text-gray-400"
        />
      </div>
      <div className="max-h-44 overflow-y-auto -mx-1">
        {filtered.length > 0 ? (
          <div className="py-0.5">
            {filtered.map((b) => {
              const label = BLOCK_TYPE_LABELS[b.type] || b.type;
              const preview = getBlockPreview(b);
              const selected = selectedBlockIds.has(b.id);
              const blockNum = blockNumberMap.get(b.id);
              return (
                <button
                  key={b.id}
                  onClick={() => onToggleBlock(b)}
                  className={`flex w-full items-start gap-2 px-2.5 py-2
                             rounded-md cursor-pointer transition-colors
                             ${selected ? "bg-blue-50" : "hover:bg-gray-50"}`}
                >
                  <div
                    className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 mt-0.5
                               ${selected ? "bg-blue-500 border-blue-500" : "border-gray-300"}`}
                  >
                    {selected && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                  <span className="text-[10px] text-gray-300 w-3 text-right shrink-0 font-mono mt-0.5">
                    {blockNum ?? "·"}
                  </span>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-1.5">
                      <BlockTypeIcon blockType={b.type} />
                      <span className={`text-[12px] font-medium ${selected ? "text-blue-600" : "text-gray-700"}`}>
                        {label}
                      </span>
                    </div>
                    {preview && (
                      <p className="text-[11px] text-gray-400 truncate mt-0.5 pl-[22px]">
                        {preview}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[12px] text-gray-400 text-center py-4">
            {search ? "No matching blocks" : "No blocks on this page"}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── URL type detection helpers ───────────────────────── */

function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "www.youtube.com" ||
      u.hostname === "youtube.com" ||
      u.hostname === "youtu.be" ||
      u.hostname === "m.youtube.com"
    );
  } catch {
    return false;
  }
}

function isPdfUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /\.pdf(\?.*)?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

function getDomainColor(domain: string): string {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-orange-500",
    "bg-pink-500", "bg-teal-500", "bg-indigo-500", "bg-red-500",
    "bg-amber-500", "bg-cyan-500",
  ];
  return colors[Math.abs(hash) % colors.length];
}

function truncateUrl(url: string, max = 35): string {
  try {
    const u = new URL(url);
    const full = u.hostname.replace(/^www\./, "") + u.pathname;
    return full.length > max ? full.slice(0, max) + "..." : full;
  } catch {
    return url.slice(0, max);
  }
}

function parseUrls(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/^https?:\/\//i.test(line) ? line : `https://${line}`))
    .filter((line) => {
      try {
        const u = new URL(line);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    });
}

function scrollToBlock(blockId: string) {
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

/* ── Batch Web View ──────────────────────────────────── */

type UrlStatus = "queued" | "scraping" | "success" | "error";

interface UrlResult {
  url: string;
  status: UrlStatus;
  title?: string;
  error?: string;
  blockId?: string;
}

export function BatchWebView({
  workspaceId,
  pageId,
  onAddSources,
  onSourceCardsReady,
  onViewSourceCards,
  onClose,
}: {
  workspaceId: string;
  pageId: string;
  onAddSources: (sources: SourceItem[]) => void;
  onSourceCardsReady?: (blockIds: string[]) => void | Promise<void>;
  onViewSourceCards?: (blockIds: string[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [urlText, setUrlText] = useState("");
  const [createSourceCards, setCreateSourceCards] = useState(true);
  const [scrapeStatus, setScrapeStatus] = useState<"idle" | "scraping" | "done">("idle");
  const [urlResults, setUrlResults] = useState<UrlResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const notifiedSourceCardsRef = useRef("");

  const parsedUrls = useMemo(() => parseUrls(urlText), [urlText]);

  const completedCount = urlResults.filter((r) => r.status === "success" || r.status === "error").length;
  const successCount = urlResults.filter((r) => r.status === "success").length;
  const sourceCardIds = useMemo(
    () =>
      urlResults
        .map((r) => r.blockId)
        .filter((blockId): blockId is string => Boolean(blockId)),
    [urlResults]
  );

  const handleScrapeAll = useCallback(async () => {
    if (parsedUrls.length === 0) return;

    const initial: UrlResult[] = parsedUrls.map((url, i) => ({
      url,
      status: i === 0 ? "scraping" : "queued",
    }));
    notifiedSourceCardsRef.current = "";
    setUrlResults(initial);
    setScrapeStatus("scraping");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/sources/batch-scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: parsedUrls, workspaceId, pageId, createSourceCards }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const message = res.ok ? "No response stream" : `Scrape request failed (${res.status})`;
        setUrlResults((prev) =>
          prev.map((r) =>
            r.status === "success" || r.status === "error"
              ? r
              : { ...r, status: "error", error: message }
          )
        );
        setScrapeStatus("done");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let processedCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === "progress") {
                processedCount++;
                setUrlResults((prev) =>
                  prev.map((r, i) => {
                    if (r.url === data.url) {
                      return {
                        ...r,
                        status: data.status === "success" ? "success" : "error",
                        title: data.title,
                        error: data.error,
                        blockId: data.blockId,
                      };
                    }
                    if (r.status === "queued" && i === processedCount) {
                      return { ...r, status: "scraping" };
                    }
                    return r;
                  })
                );
              } else if (eventType === "error") {
                const message = data.message || "Batch scrape failed";
                setUrlResults((prev) =>
                  prev.map((r) =>
                    r.status === "success" || r.status === "error"
                      ? r
                      : { ...r, status: "error", error: message }
                  )
                );
              }
            } catch { /* ignore parse errors */ }
            eventType = "";
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Batch scrape failed";
      setUrlResults((prev) =>
        prev.map((r) =>
          r.status === "success" || r.status === "error"
            ? r
            : { ...r, status: "error", error: message }
        )
      );
    }

    setScrapeStatus("done");
  }, [parsedUrls, workspaceId, pageId, createSourceCards]);

  useEffect(() => {
    if (scrapeStatus !== "done" || sourceCardIds.length === 0) return;
    const key = sourceCardIds.join(",");
    if (notifiedSourceCardsRef.current === key) return;
    notifiedSourceCardsRef.current = key;
    void onSourceCardsReady?.(sourceCardIds);
  }, [scrapeStatus, sourceCardIds, onSourceCardsReady]);

  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    notifiedSourceCardsRef.current = "";
    setUrlText("");
    setUrlResults([]);
    setScrapeStatus("idle");
  }, []);

  const handleAddToCell = useCallback(() => {
    const successItems: SourceItem[] = urlResults
      .filter((r) => r.status === "success")
      .map((r) => ({
        ref: { type: "url" as const, url: r.url },
        label: r.title || new URL(r.url).hostname,
        sourceType: "url" as const,
      }));
    onAddSources(successItems);
    onClose();
  }, [urlResults, onAddSources, onClose]);

  const handleViewSourceCards = useCallback(async () => {
    await onViewSourceCards?.(sourceCardIds);
    onClose();
    if (sourceCardIds.length > 0) {
      setTimeout(() => scrollToBlock(sourceCardIds[0]), 300);
    }
  }, [sourceCardIds, onViewSourceCards, onClose]);

  return (
    <div className="flex flex-col">
      {/* URL textarea */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[12px] font-semibold text-gray-700">URLs</span>
          {parsedUrls.length > 0 && (
            <span className="text-[11px] text-gray-400">
              {parsedUrls.length} URL{parsedUrls.length !== 1 ? "s" : ""} detected
            </span>
          )}
        </div>
        <textarea
          value={urlText}
          onChange={(e) => setUrlText(e.target.value)}
          placeholder={"https://example.com/pricing\nhttps://example.com/blog/update\nhttps://competitor.com/features"}
          disabled={scrapeStatus === "scraping"}
          className="w-full h-24 px-3 py-2 text-[13px] font-mono border border-gray-200 rounded-lg
                     outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400
                     placeholder:text-gray-300 resize-none leading-relaxed bg-white
                     disabled:bg-gray-50 disabled:text-gray-400"
        />
        <p className="text-[11px] text-gray-400 mt-1">One URL per line</p>
      </div>

      {/* Action bar */}
      <div className="px-4 pb-3 flex items-center gap-2">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-[11px] text-gray-500">Create source cards</span>
          <button
            role="switch"
            aria-checked={createSourceCards}
            onClick={() => setCreateSourceCards((v) => !v)}
            className={`relative h-5 w-9 rounded-full transition-colors ${
              createSourceCards ? "bg-blue-500" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                createSourceCards ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </button>
        </label>
        <div className="flex-1" />
        <button
          onClick={handleClear}
          disabled={scrapeStatus === "scraping"}
          className="h-8 px-3.5 text-[12px] font-medium text-gray-600 bg-white
                     border border-gray-200 rounded-lg hover:bg-gray-50
                     transition-colors cursor-pointer
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Clear
        </button>
        <button
          onClick={handleScrapeAll}
          disabled={parsedUrls.length === 0 || scrapeStatus === "scraping"}
          className="h-8 px-3.5 text-[12px] font-medium text-white bg-blue-500
                     rounded-lg hover:bg-blue-600 transition-colors cursor-pointer
                     disabled:opacity-40 disabled:cursor-not-allowed
                     flex items-center gap-1.5"
        >
          <Globe className="h-3.5 w-3.5" />
          Scrape All
        </button>
      </div>

      {/* Progress section */}
      {urlResults.length > 0 && (
        <div className="border-t border-gray-100">
          {/* Progress header + bar */}
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] font-semibold text-gray-700">
                {scrapeStatus === "done"
                  ? `${successCount} of ${urlResults.length} scraped`
                  : `${completedCount} of ${urlResults.length} scraped`}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${(completedCount / urlResults.length) * 100}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              {createSourceCards
                ? "Source cards will be added to this page."
                : "Source cards will not be created."}
            </p>
          </div>

          {/* URL status list */}
          <div className="max-h-48 overflow-y-auto px-2 pb-2">
            {urlResults.map((result) => {
              const isYT = isYouTubeUrl(result.url);
              const isPdf = isPdfUrl(result.url);
              let domain = "";
              try { domain = new URL(result.url).hostname.replace(/^www\./, ""); } catch { domain = result.url; }

              return (
                <div
                  key={result.url}
                  className="flex items-center gap-3 px-2.5 py-2 rounded-lg"
                >
                  {/* Favicon circle */}
                  {isYT ? (
                    <div className="h-7 w-7 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                      <PlayCircle className="h-3.5 w-3.5 text-red-600" />
                    </div>
                  ) : isPdf ? (
                    <div className="h-7 w-7 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                      <FileDown className="h-3.5 w-3.5 text-orange-600" />
                    </div>
                  ) : (
                    <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${getDomainColor(domain)}`}>
                      <span className="text-[11px] font-bold text-white uppercase">
                        {domain.charAt(0)}
                      </span>
                    </div>
                  )}

                  {/* URL text */}
                  <span className="flex-1 min-w-0 text-[13px] text-gray-700 truncate">
                    {truncateUrl(result.url)}
                  </span>

                  {/* Status */}
                  {result.status === "queued" && (
                    <>
                      <span className="text-[12px] text-gray-400 shrink-0">Queued</span>
                      <Clock className="h-4 w-4 text-gray-300 shrink-0" />
                    </>
                  )}
                  {result.status === "scraping" && (
                    <>
                      <span className="text-[12px] text-blue-500 shrink-0">Scraping...</span>
                      <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
                    </>
                  )}
                  {result.status === "success" && (
                    <>
                      <span className="text-[12px] text-green-600 shrink-0">Scraped</span>
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    </>
                  )}
                  {result.status === "error" && (
                    <>
                      <span className="text-[12px] text-red-500 shrink-0">Failed</span>
                      <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      {scrapeStatus === "done" && successCount > 0 && (
        <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-[12px] font-medium text-gray-700">
              {successCount} source{successCount !== 1 ? "s" : ""} ready
            </span>
          </div>
          <div className="flex items-center gap-2">
            {sourceCardIds.length > 0 && (
              <button
                onClick={handleViewSourceCards}
                className="h-8 px-3.5 text-[12px] font-medium text-gray-600 bg-white
                           border border-gray-200 rounded-lg hover:bg-gray-50
                           transition-colors cursor-pointer"
              >
                View source cards
              </button>
            )}
            <button
              onClick={handleAddToCell}
              className="h-8 px-3.5 text-[12px] font-medium text-white bg-blue-500
                         rounded-lg hover:bg-blue-600 transition-colors cursor-pointer"
            >
              Add to AI cell
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

/* ── Main Popover ─────────────────────────────────────── */

interface SourcePickerPopoverProps {
  sources: SourceItem[];
  onSourcesChange: (sources: SourceItem[]) => void;
  pageBlocks: Block[];
  onClose: () => void;
  workspaceId: string;
  pageId?: string;
  triggerBlockId: string;
  onSourceCardsReady?: (blockIds: string[]) => void | Promise<void>;
  onViewSourceCards?: (blockIds: string[]) => void | Promise<void>;
  acceptedTypes?: ("block" | "file" | "url" | "paste" | "rag")[];
  excludeOutputBlocks?: boolean;
}


const TAB_TYPE_MAP: Record<FilterTab, string[]> = {
  all: [],
  files: ["file"],
  blocks: ["block"],
  web: ["url"],
  paste: ["paste"],
};

export function SourcePickerPopover({
  sources,
  onSourcesChange,
  pageBlocks,
  onClose,
  workspaceId,
  pageId,
  triggerBlockId,
  onSourceCardsReady,
  onViewSourceCards,
  acceptedTypes,
  excludeOutputBlocks,
}: SourcePickerPopoverProps) {
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredPageBlocks = useMemo(() => {
    if (!excludeOutputBlocks) return pageBlocks;
    return pageBlocks.filter((b) => b.type !== "output");
  }, [pageBlocks, excludeOutputBlocks]);

  const visibleTabs = useMemo(() => {
    if (!acceptedTypes) return FILTER_TABS;
    return FILTER_TABS.filter((tab) => {
      if (tab.id === "all") return true;
      const needed = TAB_TYPE_MAP[tab.id];
      return needed.some((t) => acceptedTypes.includes(t as "block" | "file" | "url" | "paste" | "rag"));
    });
  }, [acceptedTypes]);
  const searchRef = useRef<HTMLInputElement>(null);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    searchRef.current?.focus();
  }, [filterTab]);

  const selectedBlockIds = useMemo(
    () =>
      new Set(
        sources
          .filter((s) => s.ref.type === "block")
          .map((s) => (s.ref as { type: "block"; blockId: string }).blockId)
      ),
    [sources]
  );

  const filteredSources = useMemo(() => {
    let filtered = sources;
    if (filterTab === "files")
      filtered = sources.filter((s) => s.sourceType === "file");
    if (filterTab === "blocks")
      filtered = sources.filter((s) => s.sourceType === "block" || s.sourceType === "image");
    if (filterTab === "paste")
      filtered = sources.filter((s) => s.sourceType === "paste");
    if (filterTab === "web")
      filtered = sources.filter((s) => s.sourceType === "url");

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          SOURCE_TYPE_LABELS[s.sourceType].toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [sources, filterTab, searchQuery]);

  const removeSource = useCallback(
    (index: number) => {
      const realIndex = sources.indexOf(filteredSources[index]);
      if (realIndex >= 0) {
        onSourcesChange(sources.filter((_, i) => i !== realIndex));
      }
    },
    [sources, filteredSources, onSourcesChange]
  );

  const clearAll = useCallback(() => {
    onSourcesChange([]);
  }, [onSourcesChange]);

  const handleUploadFile = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop() || "";
      const storagePath = `${workspaceId}/${triggerBlockId}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("files")
        .upload(storagePath, file, { upsert: true });
      if (uploadError) return;

      const { data: fileRecord } = await supabase
        .from("files")
        .insert({
          workspace_id: workspaceId,
          filename: file.name,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          storage_path: storagePath,
          metadata: {},
        })
        .select()
        .single();

      if (fileRecord) {
        onSourcesChange([
          ...sources,
          {
            ref: { type: "file", fileId: fileRecord.id },
            label: file.name,
            sourceType: "file",
            meta: formatBytes(file.size),
          },
        ]);
      }
    },
    [supabase, workspaceId, triggerBlockId, sources, onSourcesChange]
  );


  const handleAddPaste = useCallback(
    (text: string) => {
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      onSourcesChange([
        ...sources,
        {
          ref: { type: "paste", content: text },
          label: `Pasted text (${wordCount} words)`,
          sourceType: "paste",
        },
      ]);
    },
    [sources, onSourcesChange]
  );

  const handleToggleBlock = useCallback(
    (block: Block) => {
      const blockId = block.id;
      if (selectedBlockIds.has(blockId)) {
        onSourcesChange(
          sources.filter(
            (s) =>
              !(
                s.ref.type === "block" &&
                (s.ref as { type: "block"; blockId: string }).blockId ===
                  blockId
              )
          )
        );
      } else {
        const label =
          BLOCK_TYPE_LABELS[block.type] || block.type;
        const preview = getBlockPreview(block);
        onSourcesChange([
          ...sources,
          {
            ref: { type: "block", blockId },
            label: preview ? `${label}: ${preview}` : label,
            sourceType: block.type === "image" ? "image" : "block",
          },
        ]);
      }
    },
    [sources, selectedBlockIds, onSourcesChange]
  );

  return (
    <div className="w-[500px] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
      {/* Search bar */}
      <div className="px-4 pt-4 pb-2.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search files, notes, web pages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-[13px] border border-gray-200 rounded-lg
                       outline-none focus:border-gray-300 bg-gray-50/80
                       placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1.5 px-4 pb-3">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilterTab(tab.id)}
            className={`px-3 py-1 text-[12px] font-medium rounded-md transition-colors cursor-pointer
                       ${
                         filterTab === tab.id
                           ? "bg-blue-500 text-white"
                           : "text-gray-500 hover:bg-gray-100"
                       }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Selected sources */}
      <div className="border-t border-gray-100">
        {filteredSources.length > 0 && (
          <>
            <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Selected ({filteredSources.length})
              </span>
              <button
                onClick={clearAll}
                className="text-[12px] text-blue-500 hover:text-blue-600 font-medium
                           cursor-pointer transition-colors"
              >
                Clear all
              </button>
            </div>
            <div className="max-h-44 overflow-y-auto px-2">
              {filteredSources.map((source, index) => {
                const Icon = SOURCE_TYPE_ICONS[source.sourceType];
                return (
                  <div
                    key={index}
                    className="flex items-center gap-3 px-2.5 py-2.5 rounded-lg
                               hover:bg-gray-50 transition-colors"
                  >
                    <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] text-gray-800 font-medium truncate block">
                        {source.label}
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-400 shrink-0">
                      {SOURCE_TYPE_LABELS[source.sourceType]}
                    </span>
                    {source.meta && (
                      <span className="text-[11px] text-gray-400 shrink-0">
                        {source.meta}
                      </span>
                    )}
                    <button
                      onClick={() => removeSource(index)}
                      className="h-5 w-5 rounded-full bg-blue-500 flex items-center justify-center
                                 shrink-0 hover:bg-blue-600 transition-colors cursor-pointer"
                    >
                      <Check className="h-3 w-3 text-white" />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {filteredSources.length === 0 && (
          <div className="px-4 py-5 text-center">
            <p className="text-[12px] text-gray-400">
              No sources selected. Add files, URLs, or blocks below.
            </p>
          </div>
        )}
      </div>

      {/* Web tab: batch URL view */}
      {filterTab === "web" && pageId ? (
        <div className="border-t border-gray-100">
        <BatchWebView
          workspaceId={workspaceId}
          pageId={pageId}
          onAddSources={(newSources) => {
            onSourcesChange([...sources, ...newSources]);
          }}
          onSourceCardsReady={onSourceCardsReady}
          onViewSourceCards={async (blockIds) => {
            await onViewSourceCards?.(blockIds);
            const firstBlockId = blockIds[0];
            if (firstBlockId) scrollToBlock(firstBlockId);
          }}
          onClose={onClose}
        />
        </div>
      ) : (
      <>

      {/* Tab-specific content */}
      {(filterTab === "files" || filterTab === "blocks" || filterTab === "paste") && (
      <div className="border-t border-gray-100 px-4 pt-4 pb-4">
        {filterTab === "files" && (
          <UploadView onUploadFile={handleUploadFile} />
        )}
        {filterTab === "blocks" && (
          <BlocksView
            pageBlocks={filteredPageBlocks}
            numberingBlocks={pageBlocks}
            selectedBlockIds={selectedBlockIds}
            onToggleBlock={handleToggleBlock}
          />
        )}
        {filterTab === "paste" && (
          <PasteView onAddPaste={handleAddPaste} />
        )}
      </div>
      )}

      {/* Footer — Manage sources + Apply */}
      <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between">
        <button
          className="text-[12px] font-semibold text-gray-500 hover:text-gray-700 cursor-pointer
                     transition-colors flex items-center gap-1.5"
        >
          <Settings className="h-3.5 w-3.5" />
          Manage sources
        </button>
        <button
          onClick={onClose}
          className="h-9 px-5 text-[13px] font-semibold text-white bg-blue-500
                     rounded-lg hover:bg-blue-600 transition-colors cursor-pointer"
        >
          Apply sources{sources.length > 0 ? ` (${sources.length})` : ""}
        </button>
      </div>
      </>
      )}
    </div>
  );
}

/* ── Compact trigger (for control panel) ──────────────── */

export function SourceTriggerPill({
  sources,
}: {
  sources: SourceItem[];
}) {
  const uniqueTypes = useMemo(() => {
    const types = new Set(sources.map((s) => s.sourceType));
    return Array.from(types);
  }, [sources]);

  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-[13px] font-medium text-blue-600">
        {sources.length} selected
      </span>
      {uniqueTypes.length > 0 && (
        <div className="flex items-center gap-1">
          {uniqueTypes.map((type) => {
            const Icon = SOURCE_TYPE_ICONS[type];
            return (
              <div
                key={type}
                className="h-5 w-5 rounded bg-gray-100 flex items-center justify-center"
              >
                <Icon className="h-3 w-3 text-gray-500" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
