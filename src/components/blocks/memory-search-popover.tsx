"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Search,
  X,
  FileText,
  StickyNote,
  Boxes,
  Globe,
  Loader2,
  Check,
  Sparkles,
} from "lucide-react";

export interface SearchResult {
  id: string;
  content: string;
  sourceType: "block" | "page" | "file" | "web";
  sourceId: string;
  similarity: number;
  metadata: {
    breadcrumb: string;
    pageId?: string;
    pageTitle?: string;
    notebookId?: string;
    notebookName?: string;
    blockType?: string;
    filename?: string;
    url?: string;
    title?: string;
  };
}

interface MemorySearchPopoverProps {
  workspaceId: string;
  onAttach: (results: SearchResult[]) => void;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  page:  { label: "Page",      color: "text-blue-600",   bg: "bg-blue-50",   icon: StickyNote },
  block: { label: "Block",     color: "text-purple-600", bg: "bg-purple-50", icon: Boxes },
  file:  { label: "PDF",       color: "text-red-600",    bg: "bg-red-50",    icon: FileText },
  web:   { label: "Source Card", color: "text-emerald-600", bg: "bg-emerald-50", icon: Globe },
  output: { label: "AI Output", color: "text-emerald-600", bg: "bg-emerald-50", icon: Sparkles },
};

function getResultTitle(r: SearchResult): string {
  if (r.sourceType === "page" && r.metadata.pageTitle) return r.metadata.pageTitle;
  if (r.metadata.filename) return r.metadata.filename;
  if (r.metadata.title) return r.metadata.title;
  if (r.metadata.pageTitle) return r.metadata.pageTitle;
  return r.content.slice(0, 80).trim() + (r.content.length > 80 ? "…" : "");
}

function getTypeConfig(r: SearchResult) {
  if (r.sourceType === "block" && r.metadata.blockType === "output") return TYPE_CONFIG.output;
  return TYPE_CONFIG[r.sourceType] || TYPE_CONFIG.block;
}

function cleanBreadcrumb(breadcrumb: string, sourceType: string): string {
  if (!breadcrumb) return "";
  const parts = breadcrumb.split(/\s*>\s*/);
  const last = parts[parts.length - 1]?.toLowerCase() || "";
  if (last.endsWith(" block") || last === sourceType || last === "block block") {
    parts.pop();
  }
  return parts.join(" > ");
}

function matchColor(pct: number): string {
  if (pct >= 80) return "text-green-600";
  if (pct >= 60) return "text-amber-600";
  return "text-gray-400";
}

const indexedWorkspaces = new Set<string>();

export function MemorySearchPopover({ workspaceId, onAttach, onClose, triggerRef }: MemorySearchPopoverProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeWeb, setIncludeWeb] = useState(false);
  const [indexing, setIndexing] = useState(() => !indexedWorkspaces.has(workspaceId));
  const [indexResult, setIndexResult] = useState<{ processed: number; skipped: number; errors: number } | null>(null);
  const [indexError, setIndexError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const postIndexSearchRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (indexedWorkspaces.has(workspaceId)) return;
    let cancelled = false;
    fetch("/api/indexing/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        indexedWorkspaces.add(workspaceId);
        setIndexResult({ processed: data.processed ?? 0, skipped: data.skipped ?? 0, errors: data.errors ?? 0 });
      })
      .catch(() => {
        if (cancelled) return;
        setIndexError(true);
      })
      .finally(() => {
        if (!cancelled) setIndexing(false);
      });
    return () => { cancelled = true; };
  }, [workspaceId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current && !popoverRef.current.contains(target)
        && (!triggerRef?.current || !triggerRef.current.contains(target))) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose, triggerRef]);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim(), workspaceId, limit: 10, includeWeb }),
      });
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }, [workspaceId, includeWeb]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, runSearch, includeWeb]);

  useEffect(() => {
    if (!indexing && indexResult && query.trim().length >= 2) {
      postIndexSearchRef.current = setTimeout(() => runSearch(query), 0);
    }
    return () => clearTimeout(postIndexSearchRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexing]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleAttach() {
    const picked = results.filter((r) => selected.has(r.id));
    if (picked.length > 0) onAttach(picked);
    onClose();
  }

  const selectedCount = selected.size;

  return (
    <div
      ref={popoverRef}
      className="w-[540px] bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between mb-3.5">
          <h3 className="text-[15px] font-semibold text-gray-900">Search workspace memory</h3>
          <button
            onClick={() => setIncludeWeb((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium
                       border transition-colors cursor-pointer
                       ${includeWeb
                         ? "bg-blue-50 border-blue-200 text-blue-600"
                         : "bg-white border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-500"}`}
          >
            <Globe className="h-3 w-3" />
            Web
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              const nextQuery = e.target.value;
              setQuery(nextQuery);
              if (nextQuery.trim().length < 2) {
                setResults([]);
                setSearched(false);
              }
            }}
            placeholder="Search notes, files, outputs, and sources..."
            className="w-full h-10 pl-10 pr-10 rounded-lg border border-gray-200 bg-gray-50
                       text-[14px] text-gray-800 placeholder:text-gray-400 outline-none
                       focus:bg-white focus:border-blue-300 focus:ring-2 focus:ring-blue-100
                       transition-all"
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />
          )}
          {!loading && query && (
            <button
              onClick={() => { setQuery(""); setResults([]); setSearched(false); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="max-h-[420px] overflow-y-auto">
        {!searched && results.length === 0 && (
          <div className="py-14 text-center border-t border-gray-100">
            {indexing ? (
              <>
                <Loader2 className="h-7 w-7 text-blue-400 mx-auto mb-2.5 animate-spin" />
                <p className="text-[13px] text-gray-500 font-medium">Indexing your workspace…</p>
                <p className="text-[12px] text-gray-400 mt-1">This only happens once</p>
              </>
            ) : indexError ? (
              <>
                <Search className="h-7 w-7 text-gray-200 mx-auto mb-2.5" />
                <p className="text-[13px] text-gray-400">Indexing failed — search may be incomplete</p>
                <button
                  onClick={() => {
                    setIndexError(false);
                    indexedWorkspaces.delete(workspaceId);
                    setIndexing(true);
                    fetch("/api/indexing/batch", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ workspaceId }),
                    })
                      .then((res) => { if (!res.ok) throw new Error(); return res.json(); })
                      .then((data) => {
                        indexedWorkspaces.add(workspaceId);
                        setIndexResult({ processed: data.processed ?? 0, skipped: data.skipped ?? 0, errors: data.errors ?? 0 });
                      })
                      .catch(() => setIndexError(true))
                      .finally(() => setIndexing(false));
                  }}
                  className="text-[12px] text-blue-500 hover:text-blue-600 mt-1.5 cursor-pointer"
                >
                  Retry
                </button>
              </>
            ) : (
              <>
                <Search className="h-7 w-7 text-gray-200 mx-auto mb-2.5" />
                <p className="text-[13px] text-gray-400">Search your workspace knowledge</p>
                {indexResult && indexResult.processed > 0 && (
                  <p className="text-[12px] text-green-500 mt-1.5">
                    {indexResult.processed} item{indexResult.processed !== 1 ? "s" : ""} indexed
                  </p>
                )}
                {indexResult && indexResult.errors > 0 && (
                  <p className="text-[12px] text-amber-500 mt-1">
                    {indexResult.errors} error{indexResult.errors !== 1 ? "s" : ""} during indexing
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {searched && results.length === 0 && (
          <div className="py-14 text-center border-t border-gray-100">
            <p className="text-[13px] text-gray-500">No results found for &ldquo;{query}&rdquo;</p>
          </div>
        )}

        {results.length > 0 && (
          <div className="border-t border-gray-100">
            {results.map((r, i) => {
              const isSelected = selected.has(r.id);
              const pct = Math.round(r.similarity * 100);
              const config = getTypeConfig(r);
              const TypeIcon = config.icon;
              const title = getResultTitle(r);
              const breadcrumb = cleanBreadcrumb(r.metadata.breadcrumb, r.sourceType);
              const snippet = "…" + r.content.slice(0, 140).trim() + (r.content.length > 140 ? "…" : "");

              return (
                <button
                  key={r.id}
                  onClick={() => toggleSelect(r.id)}
                  className={`w-full text-left px-5 py-3.5 transition-colors cursor-pointer
                             ${i < results.length - 1 ? "border-b border-gray-100" : ""}
                             ${isSelected ? "bg-blue-50/60" : "hover:bg-gray-50/80"}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <div className="mt-0.5 shrink-0">
                      <div className={`h-[18px] w-[18px] rounded flex items-center justify-center border-[1.5px] transition-colors
                                      ${isSelected
                                        ? "bg-blue-500 border-blue-500"
                                        : "border-gray-300 bg-white"}`}>
                        {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                      </div>
                    </div>

                    {/* Number */}
                    <span className="text-[13px] text-gray-400 font-medium mt-px shrink-0 w-3 text-right tabular-nums">
                      {i + 1}
                    </span>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Row 1: type badge + breadcrumb + match % */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px]
                                         font-semibold ${config.bg} ${config.color}`}>
                          <TypeIcon className="h-3 w-3" />
                          {config.label}
                        </span>
                        {breadcrumb && (
                          <span className="text-[11.5px] text-gray-400 truncate">
                            {breadcrumb.split(" > ").map((part, pi, arr) => (
                              <span key={pi}>
                                {part}
                                {pi < arr.length - 1 && (
                                  <span className="mx-1 text-gray-300">&gt;</span>
                                )}
                              </span>
                            ))}
                          </span>
                        )}
                        <span className={`ml-auto text-[13px] font-semibold shrink-0 ${matchColor(pct)}`}>
                          {pct}%
                        </span>
                      </div>

                      {/* Row 2: title */}
                      <p className="text-[14px] font-semibold text-gray-900 truncate leading-snug">
                        {title}
                      </p>

                      {/* Row 3: snippet */}
                      <p className="text-[12.5px] text-gray-400 leading-relaxed mt-0.5 line-clamp-2">
                        {snippet}
                      </p>

                      {/* Row 4: metadata badges */}
                      <div className="flex items-center gap-2 mt-2.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                                         border border-gray-200 text-[11.5px] text-gray-500">
                          <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                          Indexed
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {results.length > 0 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 bg-gray-50/60">
          <span className="text-[13px]">
            {selectedCount > 0 ? (
              <span className="text-blue-600 font-medium">{selectedCount} source{selectedCount !== 1 ? "s" : ""} selected</span>
            ) : (
              <span className="text-gray-400">Click results to select</span>
            )}
          </span>
          <button
            onClick={handleAttach}
            disabled={selectedCount === 0}
            className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg text-[13px] font-semibold
                       bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-35 disabled:cursor-not-allowed
                       transition-colors cursor-pointer shadow-sm"
          >
            Attach sources
          </button>
        </div>
      )}
    </div>
  );
}
