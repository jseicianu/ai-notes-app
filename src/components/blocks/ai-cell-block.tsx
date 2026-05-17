"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo, type CSSProperties, type Dispatch, type RefObject, type SetStateAction } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import {
  Play,
  Loader2,
  ChevronDown,
  AlertCircle,
  Paperclip,
  Slash,
  PackagePlus,
  X,
  FileText,
  Globe,
  Type,
  Search,
  Upload,
  Zap,
  Clock,
  Eye,
  History,
  Sparkles,
  Info,
  ImageIcon,
  MessageSquare,
  AlignLeft,
  Bookmark,
  Table2,
  ChevronUp,
  MoreHorizontal,
  LayoutGrid,
  Braces,
  CheckSquare,
  List,
  ListOrdered,
  Database,
  Layers,
  ChevronRight,
  Check,
} from "lucide-react";
import Markdown from "react-markdown";
import { ModelSelector } from "./model-selector";
import { MakeReusableDrawer } from "./make-reusable-drawer";
import { MemorySearchPopover } from "./memory-search-popover";
import { BatchWebView, type SourceItem } from "./source-picker-popover";
import { getBlockNumberMap } from "./block-display-order";
import type { AiCellContextMode, Block } from "@/lib/models/types";
import type { SourceReference } from "@/services/source-service";

interface AiCellBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
  onRun?: (prompt: string) => void;
  pageBlocks?: Block[];
  onRunComplete?: () => Promise<void>;
  onRunningChange?: (running: boolean) => void;
  onViewRun?: () => void;
  onActiveRunChange?: (runId: string | null) => void;
  onSchedule?: () => void;
}

type RunState = null | "running" | "completed" | "failed";

interface RunResult {
  text: string;
  contextUsed: string[];
  durationMs: number;
  tokens: number;
  error?: { message: string; code?: string; details?: string };
}

interface AttachedSource {
  ref: SourceReference;
  label: string;
  icon: "file" | "url" | "block" | "paste" | "rag" | "image";
  thumbnailUrl?: string;
  mimeType?: string;
  previewContent?: string;
}

type ConversationTurn = { role: "user" | "assistant"; content: string; runId?: string };
type MenuAlign = "start" | "end";
type MenuPlacement = "above" | "below";

const MAX_CONVERSATION_TURNS = 10;
const MAX_CONVERSATION_MESSAGES = MAX_CONVERSATION_TURNS * 2;

function defaultModelForProvider(provider: string): string {
  switch (provider.toLowerCase()) {
    case "openai":
      return "gpt-4o-mini";
    case "google":
      return "gemini-2.0-flash";
    case "anthropic":
      return "claude-sonnet-4-6";
    default:
      return "";
  }
}

function supportsVision(provider: string, model: string): boolean {
  const p = provider.toLowerCase();
  const m = (model || defaultModelForProvider(provider)).toLowerCase();
  if (p === "anthropic" || m.includes("claude")) return m.includes("claude-3") || m.includes("claude-sonnet") || m.includes("claude-opus") || m.includes("claude-haiku");
  if (p === "openai" || m.includes("gpt")) return m.includes("gpt-4o") || m.includes("gpt-4-turbo") || m.includes("gpt-4.1");
  if (p === "google" || m.includes("gemini")) return m.includes("gemini-1.5") || m.includes("gemini-2.");
  if (p === "local" || m.includes("llava") || m.includes("vision")) return m.includes("llava") || m.includes("vision");
  return false;
}

function getSourcePreviewContent(source: AttachedSource, pageBlocks?: Block[]): string {
  if (source.previewContent) return source.previewContent;
  const ref = source.ref;
  if (ref.type === "paste") return ref.content;
  if (ref.type === "url") return ref.url;
  if (ref.type === "image") return "";
  if (ref.type === "rag") return ref.query;
  if (ref.type === "block" && pageBlocks) {
    const b = pageBlocks.find((pb) => pb.id === ref.blockId);
    if (b?.content) {
      const c = b.content as Record<string, unknown>;
      if (typeof c.doc === "string") return c.doc.replace(/<[^>]+>/g, "");
      if (typeof c.text === "string") return c.text;
      if (typeof c.prompt === "string") return c.prompt;
      if (typeof c.data === "string") return c.data;
      if (c.data) return JSON.stringify(c.data, null, 2);
      if (c.items && Array.isArray(c.items)) {
        return c.items.map((item: unknown) => {
          if (typeof item === "string") return item;
          const r = item as Record<string, unknown>;
          return typeof r.text === "string" ? r.text : "";
        }).filter(Boolean).join("\n");
      }
    }
  }
  return "";
}

function limitConversationHistory(history: ConversationTurn[]): ConversationTurn[] {
  return history.slice(-MAX_CONVERSATION_MESSAGES);
}

function latestRunIdFromHistory(history: ConversationTurn[]): string | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const runId = history[i]?.runId;
    if (runId) return runId;
  }
  return null;
}

function appendTurnIfMissing(
  history: ConversationTurn[],
  userContent: string,
  assistantContent: string,
  runId?: string | null
): ConversationTurn[] {
  if (!userContent.trim() || !assistantContent.trim()) return limitConversationHistory(history);

  const lastUser = history.at(-2);
  const lastAssistant = history.at(-1);
  if (
    lastUser?.role === "user" &&
    lastUser.content === userContent &&
    lastAssistant?.role === "assistant" &&
    lastAssistant.content === assistantContent
  ) {
    return limitConversationHistory(history);
  }

  return limitConversationHistory([
    ...history,
    { role: "user", content: userContent },
    { role: "assistant", content: assistantContent, ...(runId ? { runId } : {}) },
  ]);
}

function getAnchoredMenuStyle(
  anchor: HTMLElement,
  options: { width: number; height: number; align: MenuAlign; prefer: MenuPlacement; gap?: number }
): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const gap = options.gap ?? 8;
  const margin = 8;
  const belowTop = rect.bottom + gap;
  const aboveTop = rect.top - gap - options.height;
  const canOpenBelow = belowTop + options.height <= window.innerHeight - margin;
  const canOpenAbove = aboveTop >= margin;
  const openBelow = options.prefer === "below"
    ? canOpenBelow || !canOpenAbove
    : !canOpenAbove && canOpenBelow;
  const rawTop = openBelow ? belowTop : aboveTop;
  const top = Math.max(margin, Math.min(rawTop, window.innerHeight - margin - options.height));
  const rawLeft = options.align === "end" ? rect.right - options.width : rect.left;
  const left = Math.max(margin, Math.min(rawLeft, window.innerWidth - margin - options.width));

  return {
    position: "fixed",
    top,
    left,
    width: options.width,
  };
}

function useAnchoredMenuPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  setStyle: Dispatch<SetStateAction<CSSProperties | null>>,
  options: { width: number; height: number; align: MenuAlign; prefer: MenuPlacement; gap?: number }
) {
  const { width, height, align, prefer, gap } = options;
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setStyle(null);
      return;
    }

    const updatePosition = () => {
      if (anchorRef.current) {
        setStyle(getAnchoredMenuStyle(anchorRef.current, { width, height, align, prefer, gap }));
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, anchorRef, setStyle, width, height, align, prefer, gap]);
}

function formatTokenCount(n: number): string {
  if (n >= 1000000) {
    const v = n / 1000000;
    return v % 1 === 0 ? `${v}M` : `${v.toFixed(1)}M`;
  }
  if (n >= 1000) {
    const v = n / 1000;
    return v % 1 === 0 ? `${v}K` : `${v.toFixed(1)}K`;
  }
  return String(n);
}

interface TokenEstimate {
  estimatedTokens: number;
  modelLimit: number;
  percentUsed: number;
  breakdown: { systemPrompt: number; userPrompt: number; sources: number; total: number };
}

interface RunOutcome {
  output_block_ids?: string[] | null;
  tools_used?: string[] | null;
}

type OutputBlockSnapshot = Pick<Block, "id" | "type" | "content">;

interface CollectedOutputBlocks {
  runId: string;
  outputBlocks: OutputBlockSnapshot[];
  outcome: RunOutcome | null;
}

const OUTPUT_BLOCK_COLLECTION_ATTEMPTS = 5;
const OUTPUT_BLOCK_COLLECTION_DELAY_MS = 200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractVariables(prompt: string): string[] {
  const matches = prompt.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.replace(/\{|\}/g, "")))];
}

function blockToContext(b: Block) {
  const typeLabels: Record<string, string> = {
    text: "Text", heading: "Heading", bulleted_list: "List",
    numbered_list: "Numbered list", table: "Table", json: "JSON",
    todo: "To-do", callout: "Callout", output: "Output", file: "File",
  };
  const baseLabel = typeLabels[b.type] || b.type;
  const custom = b.content?.label as string | undefined;
  const label = custom ? `${baseLabel} · ${custom}` : baseLabel;
  let content: unknown = b.content;
  if (b.type === "text" || b.type === "heading") {
    content = (b.content?.doc as string)?.replace(/<[^>]*>/g, "") || b.content?.text || "";
  } else if (b.type === "table") {
    content = { columns: b.content?.columns, rows: b.content?.rows };
  } else if (b.type === "json") {
    content = b.content?.data;
  } else if (b.type === "todo") {
    content = b.content?.items;
  } else if (b.type === "output") {
    content = b.content?.data || b.content;
  }
  return { id: b.id, type: b.type, label, content };
}

const SOURCE_ICONS = {
  file: FileText,
  url: Globe,
  block: Type,
  paste: Type,
  rag: Search,
  image: ImageIcon,
};

const TOOL_INFO: Record<string, string> = {
  web_search: "Searching the web",
  web_scrape: "Scraping web page",
  search_workspace: "Searching workspace",
  create_table: "Creating table",
  create_text_output: "Creating text output",
  create_json: "Creating JSON",
  create_todo: "Creating to-do list",
  create_bulleted_list: "Creating list",
  create_numbered_list: "Creating numbered list",
  create_callout: "Creating callout",
  create_source_card: "Creating source card",
  run_command: "Running command",
  read_block: "Reading block",
  read_page: "Reading page",
  read_inputs: "Reading inputs",
  youtube_transcript: "Extracting YouTube transcript",
};

function describeStep(step: Record<string, unknown>): string {
  const calls = step.toolCalls as Array<{ name: string }> | undefined;
  if (calls?.length) return TOOL_INFO[calls[0].name] || calls[0].name;
  return "Processing...";
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `00:${String(sec).padStart(2, "0")}`;
}

/* ── Attach menu ─────────────────────────────────────────── */

interface AttachMenuProps {
  onUploadFile: (file: File) => void;
  onAddBatchSources: (sources: SourceItem[]) => void;
  onAddPaste: (text: string) => void;
  onSelectBlock: (block: Block) => void;
  pageBlocks: Block[];
  workspaceId: string;
  pageId: string;
  onSourceCardsReady?: () => void | Promise<void>;
  onViewSourceCards?: (blockIds: string[]) => void | Promise<void>;
  onClose: () => void;
}

type AttachTab = "upload" | "url" | "blocks" | "paste";

const ATTACH_TABS: { id: AttachTab; label: string; icon: typeof Upload }[] = [
  { id: "upload", label: "Upload", icon: Upload },
  { id: "url", label: "URL", icon: Globe },
  { id: "blocks", label: "Blocks", icon: Type },
  { id: "paste", label: "Paste", icon: FileText },
];

const TAB_META: Record<AttachTab, { title: string; subtitle: string }> = {
  upload: { title: "Upload file or image", subtitle: "Drag & drop or browse for a file or image to use as AI context." },
  url: { title: "Attach from URL", subtitle: "Add a web page and include its content in this AI cell." },
  blocks: { title: "Insert notebook blocks", subtitle: "Select blocks from this page to use as context." },
  paste: { title: "Paste content", subtitle: "Paste text, notes, or data to include as AI context." },
};

const BLOCK_ICONS: Record<string, typeof FileText> = {
  ai_cell: Sparkles, text: Type, heading: Type, table: LayoutGrid,
  json: Braces, todo: CheckSquare, output: Sparkles, callout: AlertCircle,
  file: FileText, command_ref: Slash, bulleted_list: List,
  numbered_list: ListOrdered, error: AlertCircle, image: ImageIcon,
};

const BLOCK_DESCRIPTIONS: Record<string, string> = {
  ai_cell: "AI cell and its output", text: "Rich text content", heading: "Section heading",
  table: "Table block", json: "JSON data", todo: "To-do items", output: "AI output",
  callout: "Callout note", file: "File or document", command_ref: "Command and result",
  bulleted_list: "Bullet list", numbered_list: "Numbered list", error: "Error output",
  image: "Image source",
};

const BLOCK_TYPE_LABELS: Record<string, string> = {
  text: "Text Note", heading: "Heading", table: "Table", json: "JSON",
  todo: "To-do", output: "Output", ai_cell: "AI Cell",
  callout: "Callout", file: "File Block", command_ref: "Command",
  bulleted_list: "Bulleted List", numbered_list: "Numbered List", image: "Image",
};

function AttachMenu({
  onUploadFile, onAddPaste, onSelectBlock,
  onAddBatchSources, pageBlocks, workspaceId, pageId, onSourceCardsReady, onViewSourceCards, onClose,
}: AttachMenuProps) {
  const [tab, setTab] = useState<AttachTab>("upload");
  const [pasteValue, setPasteValue] = useState("");
  const [blockSearch, setBlockSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const blockSearchRef = useRef<HTMLInputElement>(null);

  const visibleNumberMap = useMemo(() => getBlockNumberMap(pageBlocks), [pageBlocks]);

  const selectableBlocks = pageBlocks.filter(
    (b) => !["separator", "input", "input_group", "ai_cell", "file"].includes(b.type)
  );

  const filteredBlocks = blockSearch
    ? selectableBlocks.filter((b) => {
        const label = (BLOCK_TYPE_LABELS[b.type] || b.type).toLowerCase();
        return label.includes(blockSearch.toLowerCase());
      })
    : selectableBlocks;

  useEffect(() => {
    if (tab === "paste") pasteRef.current?.focus();
    if (tab === "blocks") blockSearchRef.current?.focus();
  }, [tab]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) { onUploadFile(f); onClose(); }
  }, [onUploadFile, onClose]);

  const meta = TAB_META[tab];

  return (
    <div className="w-[400px] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 px-1">
        {ATTACH_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium
                       transition-colors cursor-pointer relative
                       ${tab === t.id
                         ? "text-gray-900"
                         : "text-gray-400 hover:text-gray-600"}`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {tab === t.id && (
              <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-blue-500 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Title + subtitle */}
      <div className="px-4 pt-3.5 pb-2">
        <h3 className="text-[15px] font-semibold text-gray-900">{meta.title}</h3>
        <p className="text-[12px] text-gray-400 mt-0.5 leading-relaxed">{meta.subtitle}</p>
      </div>

      {/* Content — fixed height */}
      <div className={`${tab === "url" ? "px-0 pb-0" : "h-[220px] px-4 pb-4"} flex flex-col`}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.csv,.txt,.md,.json,.png,.jpg,.jpeg,.gif,.webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) { onUploadFile(f); onClose(); }
          }}
        />

        {tab === "upload" && (
          <button
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex-1 flex flex-col items-center justify-center gap-3
                       border-2 border-dashed rounded-lg transition-all cursor-pointer
                       ${dragOver
                         ? "border-blue-400 bg-blue-50/50"
                         : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/50"}`}
          >
            <div className={`h-11 w-11 rounded-full flex items-center justify-center transition-colors
                            ${dragOver ? "bg-blue-100" : "bg-gray-100"}`}>
              <Upload className={`h-5 w-5 ${dragOver ? "text-blue-500" : "text-gray-400"}`} />
            </div>
            <div className="text-center">
              <span className="text-[13px] text-gray-600 font-medium block">
                {dragOver ? "Drop to upload" : "Drop file or click to browse"}
              </span>
              <span className="text-[11px] text-gray-400 mt-1 block">
                PDF, CSV, TXT, Markdown, JSON, PNG, JPG, WebP
              </span>
            </div>
          </button>
        )}

        {tab === "url" && (
          <BatchWebView
            workspaceId={workspaceId}
            pageId={pageId}
            onAddSources={onAddBatchSources}
            onSourceCardsReady={onSourceCardsReady}
            onViewSourceCards={onViewSourceCards}
            onClose={onClose}
          />
        )}

        {tab === "blocks" && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                ref={blockSearchRef}
                type="text"
                placeholder="Search blocks..."
                value={blockSearch}
                onChange={(e) => setBlockSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-3 text-[13px] border border-gray-200 rounded-lg
                           outline-none focus:border-gray-300 bg-gray-50
                           placeholder:text-gray-400"
              />
            </div>
            <div className="flex-1 overflow-y-auto -mx-1">
              {filteredBlocks.length > 0 ? filteredBlocks.map((b) => {
                const label = BLOCK_TYPE_LABELS[b.type] || b.type;
                const desc = BLOCK_DESCRIPTIONS[b.type] || "";
                const Icon = BLOCK_ICONS[b.type] || FileText;
                const visNum = visibleNumberMap.get(b.id) ?? 0;
                return (
                  <button
                    key={b.id}
                    onClick={() => { onSelectBlock(b); onClose(); }}
                    className="flex w-full items-center gap-3 px-3 py-2.5
                               hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
                  >
                    <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <span className="text-[13px] font-medium text-gray-800 block">{label}</span>
                      <span className="text-[11px] text-gray-400 block truncate">{desc}</span>
                    </div>
                    <span className="h-6 w-6 rounded-md bg-gray-100 flex items-center justify-center
                                     text-[11px] font-medium text-gray-400 shrink-0">
                      {visNum}
                    </span>
                  </button>
                );
              }) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-[13px] text-gray-400">
                    {blockSearch ? "No matching blocks" : "No blocks on this page"}
                  </p>
                </div>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-2 pt-2 border-t border-gray-100
                          flex items-center gap-1.5 shrink-0">
              <Type className="h-3 w-3 shrink-0" />
              Attached blocks will be added to AI context.
            </p>
          </div>
        )}

        {tab === "paste" && (
          <div className="flex flex-col flex-1">
            <textarea
              ref={pasteRef}
              placeholder="Paste text, meeting notes, CSV, or copied content..."
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              className="flex-1 px-3 py-2.5 text-[13px] border border-gray-300 rounded-lg
                         outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500
                         placeholder:text-gray-400 resize-none leading-relaxed"
            />
            <div className="flex items-center justify-between mt-2.5">
              <span className="text-[11px] text-gray-400">
                {pasteValue ? `${pasteValue.split(/\s+/).filter(Boolean).length} words` : ""}
              </span>
              <button
                onClick={() => { if (pasteValue.trim()) { onAddPaste(pasteValue.trim()); onClose(); } }}
                disabled={!pasteValue.trim()}
                className="h-9 px-4 text-[13px] font-medium text-white bg-blue-500
                           rounded-lg hover:bg-blue-600 transition-colors cursor-pointer
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Attach pasted content
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Source Chip with Portal Preview ─────────────────────── */

function SourceChipWithPreview({
  source,
  index,
  modelProvider,
  modelId,
  pageBlocks,
  onRemove,
}: {
  source: AttachedSource;
  index: number;
  modelProvider: string;
  modelId?: string;
  pageBlocks?: Block[];
  onRemove: (index: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const chipRef = useRef<HTMLSpanElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const Icon = SOURCE_ICONS[source.icon];
  const isRag = source.icon === "rag";
  const isImg = source.icon === "image";
  const visionModel = modelId || defaultModelForProvider(modelProvider);
  const hasVision = isImg && supportsVision(modelProvider, visionModel);
  const previewContent = getSourcePreviewContent(source, pageBlocks);

  const typeLabel = source.icon === "file" ? "File" :
    source.icon === "url" ? "URL" :
    source.icon === "block" ? "Block" :
    source.icon === "paste" ? "Pasted text" :
    source.icon === "rag" ? "Memory" :
    source.icon === "image" ? "Image" : "Source";

  const hasContent = previewContent.length > 0 || (isImg && !!source.thumbnailUrl);
  const CARD_W = 320;

  const enter = useCallback(() => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    setHovered(true);
  }, []);
  const leave = useCallback(() => {
    leaveTimer.current = setTimeout(() => setHovered(false), 100);
  }, []);

  useLayoutEffect(() => {
    if (!hovered || !chipRef.current) { setPos(null); return; }
    const rect = chipRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - CARD_W / 2, window.innerWidth - CARD_W - 8));
    setPos({ top: rect.top - 8, left });
  }, [hovered]);

  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);

  return (
    <span
      ref={chipRef}
      onMouseEnter={enter}
      onMouseLeave={leave}
      className={`relative inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-md
                 text-[13px] transition-colors cursor-default
                 ${isRag
                   ? "bg-blue-50 border border-blue-200 text-blue-700 hover:border-blue-300"
                   : "bg-white border border-gray-300 text-gray-700 hover:border-gray-400"}`}
    >
      {isImg && source.thumbnailUrl ? (
        <Image src={source.thumbnailUrl} alt="" width={20} height={20} unoptimized className="h-5 w-5 rounded object-cover shrink-0" />
      ) : (
        <Icon className={`h-3.5 w-3.5 shrink-0 ${isRag ? "text-blue-500" : "text-gray-500"}`} />
      )}
      <span className="truncate max-w-[180px]">{source.label}</span>
      {isImg && (
        <Eye className={`h-3.5 w-3.5 shrink-0 ${hasVision ? "text-green-500" : "text-amber-400"}`} />
      )}
      <button
        onClick={() => onRemove(index)}
        className={`h-5 w-5 flex items-center justify-center rounded transition-colors cursor-pointer
                   ${isRag ? "text-blue-400 hover:text-blue-600" : "text-gray-400 hover:text-gray-600"}`}
      >
        <X className="h-3 w-3" />
      </button>

      {hovered && hasContent && pos && typeof document !== "undefined" && createPortal(
        <div
          onMouseEnter={enter}
          onMouseLeave={leave}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: CARD_W, transform: "translateY(-100%)" }}
          className="z-[9999]"
        >
          <div className="bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-gray-100">
              <Icon className={`h-3.5 w-3.5 shrink-0 ${isRag ? "text-blue-500" : "text-gray-400"}`} />
              <span className="text-[12px] font-medium text-gray-900 truncate">{source.label}</span>
              <span className="text-[10px] text-gray-400 ml-auto shrink-0">{typeLabel}</span>
            </div>
            {isImg && source.thumbnailUrl && (
              <div className="px-3 py-2">
                <Image src={source.thumbnailUrl} alt="" width={280} height={180} unoptimized
                  className="w-full max-h-[180px] object-contain rounded" />
              </div>
            )}
            {previewContent && (
              <div className="px-3 py-2 max-h-[200px] overflow-y-auto">
                <p className="text-[12px] text-gray-600 leading-relaxed whitespace-pre-wrap break-words">
                  {previewContent.length > 600 ? previewContent.slice(0, 600) + "…" : previewContent}
                </p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

/* ── Context Mode Picker ───────────────────────────────── */

const CONTEXT_MODES = [
  { mode: "selected_sources" as const, label: "Sources only", icon: Paperclip, desc: "Only attached sources" },
  { mode: "blocks_above" as const, label: "Page context", icon: AlignLeft, desc: "Reads all blocks above" },
  { mode: "none" as const, label: "Prompt only", icon: MessageSquare, desc: "No extra context" },
];

function ContextModePicker({
  mode,
  onChange,
}: {
  mode: AiCellContextMode;
  onChange: (mode: AiCellContextMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const current = CONTEXT_MODES.find((m) => m.mode === mode) || CONTEXT_MODES[0];
  const Icon = current.icon;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-medium
                   transition-colors cursor-pointer select-none
                   ${mode === "blocks_above"
                     ? "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                     : mode === "none"
                       ? "bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200"
                       : "bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100"}`}
      >
        <Icon className="h-3 w-3" />
        {current.label}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-48 bg-white border border-gray-200
                        rounded-lg shadow-lg py-1 z-50 animate-in fade-in duration-75">
          {CONTEXT_MODES.map(({ mode: m, label, icon: MIcon, desc }) => (
            <button
              key={m}
              onClick={() => { onChange(m); setOpen(false); }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-[13px]
                         cursor-pointer transition-colors
                         ${mode === m ? "bg-gray-50 text-gray-900" : "text-gray-600 hover:bg-gray-50"}`}
            >
              <MIcon className="h-3.5 w-3.5 shrink-0" />
              <div className="text-left">
                <div className="font-medium">{label}</div>
                <div className="text-[10px] text-gray-400">{desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── AI Cell Block ───────────────────────────────────────── */

export function AiCellBlock({ block, onUpdate, pageBlocks = [], onRunComplete, onRunningChange, onViewRun, onActiveRunChange, onSchedule }: AiCellBlockProps) {
  const initialConversationHistory = limitConversationHistory(
    (block.content?.conversationHistory as ConversationTurn[]) || []
  );
  const [prompt, setPrompt] = useState(
    (block.content?.prompt as string) || ""
  );
  const [runState, setRunState] = useState<RunState>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [showMakeReusable, setShowMakeReusable] = useState(false);
  const [showRunDropdown, setShowRunDropdown] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [sources, setSources] = useState<AttachedSource[]>([]);
  const [tokenEstimate, setTokenEstimate] = useState<TokenEstimate | null>(null);
  const [agentMode, setAgentMode] = useState(!!block.content?.agentMode);
  const [outputMode, setOutputMode] = useState<"replace" | "append" | "version">(
    (block.content?.outputMode as "replace" | "append" | "version") || "replace"
  );
  const contextMode =
    (block.content?.contextMode as AiCellContextMode | undefined) ?? "selected_sources";
  const [agentSteps, setAgentSteps] = useState<Array<Record<string, unknown>>>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>(
    initialConversationHistory
  );
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [refinementStatus, setRefinementStatus] = useState<string | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(
    latestRunIdFromHistory(initialConversationHistory)
  );
  const [lastOutputBlocks, setLastOutputBlocks] = useState<OutputBlockSnapshot[]>([]);
  const [activeOutputAction, setActiveOutputAction] = useState<"refine" | "follow-up" | null>(null);
  const [showOutputModeFlyout, setShowOutputModeFlyout] = useState(false);
  const outputModeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const runMenuRef = useRef<HTMLDivElement>(null);
  const attachRef = useRef<HTMLDivElement>(null);
  const memoryRef = useRef<HTMLDivElement>(null);
  const memoryMenuRef = useRef<HTMLDivElement>(null);
  const attachMenuInner = useRef<HTMLDivElement>(null);
  const tokenAbortRef = useRef<AbortController | null>(null);
  const runAbortRef = useRef<AbortController | null>(null);
  const refinementSnapshotRef = useRef<RunResult | null>(null);
  const refineFocusBlockIdRef = useRef<string | null>(null);
  const stepPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [attachMenuStyle, setAttachMenuStyle] = useState<CSSProperties | null>(null);
  const [memoryMenuStyle, setMemoryMenuStyle] = useState<CSSProperties | null>(null);
  const [runMenuStyle, setRunMenuStyle] = useState<CSSProperties | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const childBlocks = pageBlocks.filter((b) => b.parent_block_id === block.id);
  const hasChildBlocks = childBlocks.length > 0;
  const hasContextBlocks = pageBlocks.some(
    (b) =>
      b.sort_order < block.sort_order &&
      !["input", "input_group", "separator"].includes(b.type)
  );

  useEffect(() => {
    if (hasChildBlocks && !runResult && runState === null) {
      void Promise.resolve().then(() => {
        const latestAssistant = conversationHistory.findLast(
          (turn) => turn.role === "assistant" && turn.content.trim()
        );
        const text = latestAssistant?.content ?? "";
        setRunState("completed");
        setRunResult({ text, contextUsed: [], durationMs: 0, tokens: 0 });
        setShowFollowUp(!!text);
      });
    }
  }, [hasChildBlocks, conversationHistory, runResult, runState]);

  const fetchChildOutputBlocks = useCallback(async (): Promise<OutputBlockSnapshot[]> => {
    const { data, error } = await supabase
      .from("blocks")
      .select("id,type,content,sort_order")
      .eq("workspace_id", block.workspace_id)
      .eq("page_id", block.page_id)
      .eq("parent_block_id", block.id)
      .order("sort_order");
    if (error) throw error;
    return ((data ?? []) as Array<OutputBlockSnapshot & { sort_order?: number }>).map(
      ({ id, type, content }) => ({ id, type, content })
    );
  }, [supabase, block.workspace_id, block.page_id, block.id]);

  const fetchLatestRunId = useCallback(async (): Promise<string | null> => {
    const { data, error } = await supabase
      .from("runs")
      .select("id")
      .eq("workspace_id", block.workspace_id)
      .eq("page_id", block.page_id)
      .eq("trigger_block_id", block.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data?.id as string | undefined) ?? null;
  }, [supabase, block.workspace_id, block.page_id, block.id]);

  const fetchRunOutcome = useCallback(async (runId: string | null): Promise<RunOutcome | null> => {
    if (!runId) return null;
    const { data, error } = await supabase
      .from("runs")
      .select("output_block_ids, tools_used")
      .eq("id", runId)
      .maybeSingle();
    if (error) throw error;
    return (data as RunOutcome | null) ?? null;
  }, [supabase]);

  const collectOutputBlocks = useCallback(async (runId: string | null): Promise<CollectedOutputBlocks | null> => {
    if (!runId) return null;

    let latestOutcome: RunOutcome | null = null;

    for (let attempt = 0; attempt < OUTPUT_BLOCK_COLLECTION_ATTEMPTS; attempt += 1) {
      latestOutcome = await fetchRunOutcome(runId);
      const blockIds = latestOutcome?.output_block_ids ?? [];

      if (blockIds.length === 0) {
        if (attempt < OUTPUT_BLOCK_COLLECTION_ATTEMPTS - 1) {
          await delay(OUTPUT_BLOCK_COLLECTION_DELAY_MS);
          continue;
        }

        setLastRunId(runId);
        setLastOutputBlocks([]);
        return { runId, outputBlocks: [], outcome: latestOutcome };
      }

      const { data, error } = await supabase
        .from("blocks")
        .select("id, type, content")
        .in("id", blockIds);
      if (error) throw error;

      const blocksById = new Map(
        ((data ?? []) as OutputBlockSnapshot[]).map((outputBlock) => [
          outputBlock.id,
          outputBlock,
        ])
      );
      const outputBlocks = blockIds
        .map((blockId) => blocksById.get(blockId))
        .filter((outputBlock): outputBlock is OutputBlockSnapshot =>
          Boolean(outputBlock)
        );

      if (
        outputBlocks.length === blockIds.length ||
        attempt === OUTPUT_BLOCK_COLLECTION_ATTEMPTS - 1
      ) {
        setLastRunId(runId);
        setLastOutputBlocks(outputBlocks);
        return { runId, outputBlocks, outcome: latestOutcome };
      }

      await delay(OUTPUT_BLOCK_COLLECTION_DELAY_MS);
    }

    setLastRunId(runId);
    setLastOutputBlocks([]);
    return { runId, outputBlocks: [], outcome: latestOutcome };
  }, [supabase, fetchRunOutcome]);

  const handleToolOnlySuccess = useCallback(async (hasRefinableOutput: boolean) => {
    setRefinementStatus(null);
    if (onRunComplete) {
      await onRunComplete();
    }
    setRunState("completed");
    setRunResult({ text: "", contextUsed: [], durationMs: 0, tokens: 0 });
    setShowFollowUp(hasRefinableOutput);
  }, [onRunComplete]);

  useEffect(() => {
    if (!showRunDropdown) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        !runMenuRef.current?.contains(target)
      ) {
        setShowRunDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showRunDropdown]);

  useEffect(() => {
    if (!showAttachMenu) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        attachRef.current &&
        !attachRef.current.contains(target) &&
        !attachMenuInner.current?.contains(target)
      ) {
        setShowAttachMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showAttachMenu]);

  useEffect(() => {
    if (!showMemory) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        memoryRef.current &&
        !memoryRef.current.contains(target) &&
        !memoryMenuRef.current?.contains(target)
      ) {
        setShowMemory(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMemory]);

  useAnchoredMenuPosition(showAttachMenu, attachRef, setAttachMenuStyle, {
    width: 400,
    height: 380,
    align: "start",
    prefer: "above",
  });
  useAnchoredMenuPosition(showMemory, memoryRef, setMemoryMenuStyle, {
    width: 540,
    height: 200,
    align: "start",
    prefer: "below",
    gap: 4,
  });
  useAnchoredMenuPosition(showRunDropdown, dropdownRef, setRunMenuStyle, {
    width: 220,
    height: 168,
    align: "end",
    prefer: "below",
    gap: 4,
  });

  const [workspaceDefaultLoaded, setWorkspaceDefaultLoaded] = useState(false);
  const modelProvider = (block.content?.model_provider as string) || "anthropic";
  const modelId = (block.content?.model_name as string) || undefined;
  const variables = extractVariables(prompt);

  useEffect(() => {
    if (workspaceDefaultLoaded || block.content?.model_name) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("workspaces")
        .select("settings")
        .eq("id", block.workspace_id)
        .single();
      if (cancelled) return;
      const settings = data?.settings as Record<string, unknown> | null;
      const defaultModelId = settings?.defaultModel as string | undefined;
      if (defaultModelId && !block.content?.model_name) {
        const KNOWN_PROVIDERS: Record<string, string> = {
          "claude-sonnet-4-6": "anthropic", "claude-opus-4-6": "anthropic",
          "gpt-4o": "openai", "gpt-4o-mini": "openai",
          "gemini-2.0-flash": "google",
          "local-ollama": "local",
        };
        const provider = KNOWN_PROVIDERS[defaultModelId] || "anthropic";
        onUpdate({ ...block.content, model_name: defaultModelId, model_provider: provider });
      }
      setWorkspaceDefaultLoaded(true);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!prompt.trim()) {
        setTokenEstimate(null);
        return;
      }
      tokenAbortRef.current?.abort();
      const controller = new AbortController();
      tokenAbortRef.current = controller;
      try {
        const contextBlocks = contextMode === "blocks_above"
          ? pageBlocks
              .filter((b) => b.sort_order < block.sort_order && b.type !== "input" && b.type !== "separator")
              .map(blockToContext)
          : [];
        const res = await fetch("/api/ai/estimate-context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            sources: sources.map((s) => s.ref),
            contextBlocks,
            contextMode,
            model: { provider: modelProvider, name: modelId || "" },
            agentMode,
            workspaceId: block.workspace_id,
            pageId: block.page_id,
          }),
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          setTokenEstimate(data);
        }
      } catch {
        // abort or network error — silent
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [prompt, sources, modelId, modelProvider, agentMode, contextMode, pageBlocks, block.sort_order, block.workspace_id, block.page_id]);

  const removeSource = useCallback((index: number) => {
    setSources((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUploadFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop() || "";
    const storagePath = `${block.workspace_id}/${block.id}/${Date.now()}.${ext}`;
    const isImage = file.type.startsWith("image/");

    const { error: uploadError } = await supabase.storage
      .from("files")
      .upload(storagePath, file, { upsert: true });
    if (uploadError) return;

    if (isImage) {
      const { data: signedData } = await supabase.storage
        .from("files")
        .createSignedUrl(storagePath, 60 * 60 * 24);
      const storageUrl = signedData?.signedUrl || "";
      setSources((prev) => [...prev, {
        ref: { type: "image" as const, storageUrl, mimeType: file.type },
        label: file.name,
        icon: "image",
        thumbnailUrl: storageUrl,
        mimeType: file.type,
      }]);
      return;
    }

    const { data: fileRecord } = await supabase
      .from("files")
      .insert({
        workspace_id: block.workspace_id,
        filename: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        storage_path: storagePath,
        metadata: {},
      })
      .select()
      .single();

    if (fileRecord) {
      const textTypes = ["text/", "application/json", "text/csv", "text/markdown"];
      const isTextFile = textTypes.some((t) => file.type.startsWith(t)) || /\.(txt|md|csv|json|tsv|log|xml|yaml|yml)$/i.test(file.name);
      let preview: string | undefined;
      if (isTextFile) {
        try { preview = await file.text(); } catch { /* ignore */ }
      }
      setSources((prev) => [...prev, {
        ref: { type: "file", fileId: fileRecord.id },
        label: file.name,
        icon: "file",
        ...(preview ? { previewContent: preview } : {}),
      }]);
    }
  }, [supabase, block.workspace_id, block.id]);

  const handleAddBatchSources = useCallback((items: SourceItem[]) => {
    setSources((prev) => [
      ...prev,
      ...items.map((item) => ({
        ref: item.ref,
        label: item.label,
        icon: item.sourceType,
      })),
    ]);
  }, []);

  const handleSourceCardsReady = useCallback(async () => {
    await onRunComplete?.();
  }, [onRunComplete]);

  const handleViewSourceCards = useCallback(async (blockIds: string[]) => {
    await onRunComplete?.();
    const firstBlockId = blockIds[0];
    if (!firstBlockId) return;
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-block-id="${CSS.escape(firstBlockId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [onRunComplete]);

  const handleAddPaste = useCallback((text: string) => {
    const wordCount = text.split(/\s+/).length;
    setSources((prev) => [...prev, {
      ref: { type: "paste", content: text },
      label: `Pasted text (${wordCount} words)`,
      icon: "paste",
    }]);
  }, []);

  const handleSelectBlock = useCallback((sourceBlock: Block) => {
    const label = BLOCK_TYPE_LABELS[sourceBlock.type] || sourceBlock.type;
    const storagePath = sourceBlock.content?.storage_path as string | undefined;
    const mimeType = sourceBlock.content?.mime_type as string | undefined;

    if (sourceBlock.type === "image" && storagePath) {
      void supabase.storage
        .from("files")
        .createSignedUrl(storagePath, 60 * 60)
        .then(({ data }) => {
          setSources((prev) => [...prev, {
            ref: { type: "block", blockId: sourceBlock.id },
            label: (sourceBlock.content?.caption as string | undefined) ||
              (sourceBlock.content?.filename as string | undefined) ||
              label,
            icon: "image",
            thumbnailUrl: data?.signedUrl,
            mimeType,
          }]);
        });
      return;
    }

    setSources((prev) => [...prev, {
      ref: { type: "block", blockId: sourceBlock.id },
      label,
      icon: "block",
    }]);
  }, [supabase]);

  const clearStepPoll = useCallback(() => {
    if (stepPollRef.current) {
      clearInterval(stepPollRef.current);
      stepPollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => { clearStepPoll(); runAbortRef.current?.abort(); };
  }, [clearStepPoll]);

  const handleCancel = useCallback(async () => {
    runAbortRef.current?.abort();
    clearStepPoll();
    if (activeRunId) {
      await supabase.from("runs").update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", activeRunId);
    }
    if (refinementSnapshotRef.current) {
      setRunState("completed");
      setRunResult(refinementSnapshotRef.current);
      setShowFollowUp(true);
      setRefinementStatus("Refinement cancelled");
      refinementSnapshotRef.current = null;
    } else {
      setRunState("failed");
      setRunResult({ text: "", contextUsed: [], durationMs: 0, tokens: 0, error: { message: "Run cancelled", code: "CANCELLED" } });
    }
    setActiveRunId(null);
    setAgentSteps([]);
    onRunningChange?.(false);
    onActiveRunChange?.(null);
  }, [activeRunId, supabase, clearStepPoll, onRunningChange, onActiveRunChange]);

  const handleRun = useCallback(async () => {
    if (!prompt.trim()) return;

    const hasImages = sources.some((s) => s.icon === "image");
    const modelForVision = modelId || defaultModelForProvider(modelProvider);
    if (hasImages && !supportsVision(modelProvider, modelForVision)) {
      setRunState("failed");
      setRunResult({
        text: "", contextUsed: [], durationMs: 0, tokens: 0,
        error: { message: "Selected model does not support vision. Remove image sources or switch to a vision-capable model.", code: "NO_VISION" },
      });
      return;
    }

    runAbortRef.current?.abort();
    clearStepPoll();
    refinementSnapshotRef.current = null;
    const controller = new AbortController();
    runAbortRef.current = controller;

    setRunState("running");
    setRunResult(null);
    setAgentSteps([]);
    setActiveRunId(null);
    setConversationHistory([]);
    setLastRunId(null);
    setLastOutputBlocks([]);
    onUpdate({ ...block.content, prompt, conversationHistory: [] });
    setRefinementStatus(null);
    const start = Date.now();
    onRunningChange?.(true);

    try {
      const aboveBlocks = contextMode === "blocks_above"
        ? pageBlocks
            .filter((b) => b.sort_order < block.sort_order && b.type !== "input" && b.type !== "separator")
            .map(blockToContext)
        : [];

      const existingOutputBlocks = (await fetchChildOutputBlocks()).map((b) => ({
        id: b.id,
        type: b.type,
      }));

      const res = await fetch("/api/ai/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          contextBlocks: aboveBlocks,
          existingOutputBlocks,
          sources: sources.map((s) => s.ref),
          modelProvider,
          modelName: modelId || "",
          agentMode,
          outputMode,
          contextMode,
          pageId: block.page_id,
          triggerBlockId: block.id,
          workspaceId: block.workspace_id,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setRunState("failed");
        setRunResult({
          text: "", contextUsed: variables, durationMs: 0, tokens: 0,
          error: { message: err.error || err.message || `Request failed (${res.status})`, code: `HTTP_${res.status}` },
        });
        onRunningChange?.(false);
        return;
      }

      const runId = res.headers.get("x-run-id");
      if (runId) {
        setActiveRunId(runId);
        onActiveRunChange?.(runId);
      }

      if (agentMode && runId) {
        stepPollRef.current = setInterval(async () => {
          try {
            const { data } = await supabase
              .from("runs").select("output, status")
              .eq("id", runId).single();
            const out = data?.output as Record<string, unknown> | null;
            if (out?.steps) setAgentSteps(out.steps as Array<Record<string, unknown>>);
            if (data?.status && data.status !== "running" && data.status !== "pending") {
              clearStepPoll();
            }
          } catch { /* poll error — silent */ }
        }, 1500);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setRunResult({
          text: fullText, contextUsed: variables,
          durationMs: Date.now() - start, tokens: 0,
        });
      }

      clearStepPoll();
      setRunState("completed");
      const elapsed = Date.now() - start;
      onRunningChange?.(false);
      onActiveRunChange?.(null);
      setActiveRunId(null);

      if (!fullText.trim()) {
        const collected = await collectOutputBlocks(runId);
        if (
          (collected?.outputBlocks.length ?? 0) > 0 ||
          (collected?.outcome?.tools_used?.length ?? 0) > 0
        ) {
          await handleToolOnlySuccess((collected?.outputBlocks.length ?? 0) > 0);
          return;
        }

        setRunState("failed");
        setRunResult({
          text: "", contextUsed: variables, durationMs: elapsed, tokens: 0,
          error: { message: "No response received from the model", code: "EMPTY_RESPONSE" },
        });
      } else {
        await collectOutputBlocks(runId);
        setShowFollowUp(true);
        const updatedHistory = appendTurnIfMissing([], prompt, fullText, runId);
        setConversationHistory(updatedHistory);
        setLastRunId(runId ?? null);
        onUpdate({ ...block.content, prompt, conversationHistory: updatedHistory });
        if (onRunComplete) setTimeout(() => { onRunComplete(); }, 500);
      }
    } catch (err) {
      clearStepPoll();
      onRunningChange?.(false);
      onActiveRunChange?.(null);
      setActiveRunId(null);
      if ((err as Error).name === "AbortError") return;
      setRunState("failed");
      setRunResult({
        text: "", contextUsed: variables, durationMs: 0, tokens: 0,
        error: { message: (err as Error).message || "An unexpected error occurred" },
      });
    }
  }, [prompt, block, modelId, modelProvider, variables, sources, agentMode, outputMode, contextMode, onRunComplete, onRunningChange, onActiveRunChange, pageBlocks, supabase, clearStepPoll, onUpdate, handleToolOnlySuccess, collectOutputBlocks, fetchChildOutputBlocks]);

  const handleFollowUp = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const hasImages = sources.some((s) => s.icon === "image");
    const modelForVision = modelId || defaultModelForProvider(modelProvider);
    if (hasImages && !supportsVision(modelProvider, modelForVision)) {
      setRunState("failed");
      setRunResult({
        text: "", contextUsed: [], durationMs: 0, tokens: 0,
        error: { message: "Selected model does not support vision. Remove image sources or switch to a vision-capable model.", code: "NO_VISION" },
      });
      return;
    }

    const newHistory = appendTurnIfMissing(
      conversationHistory,
      prompt,
      runResult?.text ?? "",
      lastRunId
    );
    if (Math.floor(newHistory.length / 2) >= MAX_CONVERSATION_TURNS) return;
    const previousResult = runResult;
    refinementSnapshotRef.current = previousResult;

    let refinementContext:
      | { runId: string | null; outputBlocks: OutputBlockSnapshot[] }
      | null = null;

    try {
      const freshOutputBlocks = await fetchChildOutputBlocks();
      if (freshOutputBlocks.length > 0) {
        const runId =
          lastRunId ??
          latestRunIdFromHistory(newHistory) ??
          await fetchLatestRunId();
        refinementContext = { runId, outputBlocks: freshOutputBlocks };
        if (runId) setLastRunId(runId);
        setLastOutputBlocks(freshOutputBlocks);
      }
    } catch {
      refinementContext = null;
    }

    if (!refinementContext && lastRunId && lastOutputBlocks.length > 0) {
      refinementContext = { runId: lastRunId, outputBlocks: lastOutputBlocks };
    }

    if (lastRunId && !refinementContext) {
      try {
        const collected = await collectOutputBlocks(lastRunId);
        if (collected && collected.outputBlocks.length > 0) {
          refinementContext = {
            runId: collected.runId,
            outputBlocks: collected.outputBlocks,
          };
        }
      } catch (err) {
        setRunState(previousResult ? "completed" : "failed");
        setRunResult(previousResult ?? {
          text: "", contextUsed: [], durationMs: 0, tokens: 0,
          error: {
            message: "Could not load the previous output blocks for refinement.",
            code: "REFINEMENT_CONTEXT",
          },
        });
        setShowFollowUp(!!previousResult || lastOutputBlocks.length > 0);
        setRefinementStatus(
          `Refinement failed: ${(err as Error).message || "could not load previous output blocks"}`
        );
        refinementSnapshotRef.current = null;
        return;
      }
    }

    const focusBlockId = refineFocusBlockIdRef.current;
    refineFocusBlockIdRef.current = null;
    const focusedOutputBlocks = focusBlockId && refinementContext
      ? refinementContext.outputBlocks.filter((outputBlock) => outputBlock.id === focusBlockId)
      : null;

    if (focusBlockId && (!focusedOutputBlocks || focusedOutputBlocks.length === 0)) {
      setRunState(previousResult ? "completed" : "failed");
      setRunResult(previousResult ?? {
        text: "", contextUsed: [], durationMs: 0, tokens: 0,
        error: {
          message: "Could not load the selected output block for refinement.",
          code: "REFINEMENT_TARGET",
        },
      });
      setShowFollowUp(!!previousResult || lastOutputBlocks.length > 0);
      setRefinementStatus("Refinement failed: selected output block was not found");
      refinementSnapshotRef.current = null;
      return;
    }

    const refinementOutputBlocks =
      focusedOutputBlocks && focusedOutputBlocks.length > 0
        ? focusedOutputBlocks
        : refinementContext?.outputBlocks;

    setConversationHistory(newHistory);
    setPrompt(text);
    onUpdate({ ...block.content, prompt: text, conversationHistory: newHistory });
    setFollowUpPrompt("");
    setShowFollowUp(false);
    setRefinementStatus(null);

    runAbortRef.current?.abort();
    clearStepPoll();
    const controller = new AbortController();
    runAbortRef.current = controller;

    setRunState("running");
    setAgentSteps([]);
    setActiveRunId(null);
    const start = Date.now();
    onRunningChange?.(true);

    try {
      const aboveBlocks = contextMode === "blocks_above"
        ? pageBlocks
            .filter((b) => b.sort_order < block.sort_order && b.type !== "input" && b.type !== "separator")
            .map(blockToContext)
        : [];
      const existingOutputBlocks = (refinementOutputBlocks?.length
        ? refinementOutputBlocks
        : await fetchChildOutputBlocks()
      ).map((b) => ({ id: b.id, type: b.type }));

      const res = await fetch("/api/ai/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          contextBlocks: aboveBlocks,
          existingOutputBlocks,
          sources: sources.map((s) => s.ref),
          modelProvider,
          modelName: modelId || "",
          agentMode,
          outputMode,
          contextMode,
          conversationHistory: newHistory,
          ...(refinementContext && refinementOutputBlocks ? {
            refinementTarget: {
              ...(refinementContext.runId ? { runId: refinementContext.runId } : {}),
              triggerBlockId: block.id,
              outputBlocks: refinementOutputBlocks,
            },
          } : {}),
          pageId: block.page_id,
          triggerBlockId: block.id,
          workspaceId: block.workspace_id,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setRunState(previousResult ? "completed" : "failed");
        setRunResult(previousResult ?? {
          text: "", contextUsed: [], durationMs: 0, tokens: 0,
          error: { message: err.error || `Request failed (${res.status})`, code: `HTTP_${res.status}` },
        });
        setShowFollowUp(!!previousResult);
        setRefinementStatus(`Refinement failed: ${err.error || `Request failed (${res.status})`}`);
        refinementSnapshotRef.current = null;
        onRunningChange?.(false);
        return;
      }

      const runId = res.headers.get("x-run-id");
      if (runId) {
        setActiveRunId(runId);
        onActiveRunChange?.(runId);
      }

      if (agentMode && runId) {
        stepPollRef.current = setInterval(async () => {
          try {
            const { data } = await supabase
              .from("runs").select("output, status")
              .eq("id", runId).single();
            const out = data?.output as Record<string, unknown> | null;
            if (out?.steps) setAgentSteps(out.steps as Array<Record<string, unknown>>);
            if (data?.status && data.status !== "running" && data.status !== "pending") {
              clearStepPoll();
            }
          } catch { /* poll error — silent */ }
        }, 1500);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setRunResult({ text: fullText, contextUsed: [], durationMs: Date.now() - start, tokens: 0 });
      }
      clearStepPoll();
      setRunState("completed");
      onRunningChange?.(false);
      onActiveRunChange?.(null);
      setActiveRunId(null);
      if (fullText.trim()) {
        await collectOutputBlocks(runId);
        setRefinementStatus(null);
        refinementSnapshotRef.current = null;
        setShowFollowUp(true);
        const updatedHistory = appendTurnIfMissing(newHistory, text, fullText, runId);
        setConversationHistory(updatedHistory);
        setLastRunId(runId ?? refinementContext?.runId ?? null);
        onUpdate({ ...block.content, prompt: text, conversationHistory: updatedHistory });
        if (onRunComplete) setTimeout(() => { onRunComplete(); }, 500);
      } else {
        const collected = await collectOutputBlocks(runId);
        if (
          (collected?.outputBlocks.length ?? 0) > 0 ||
          (collected?.outcome?.tools_used?.length ?? 0) > 0
        ) {
          refinementSnapshotRef.current = null;
          await handleToolOnlySuccess((collected?.outputBlocks.length ?? 0) > 0);
          return;
        }

        setRunState(previousResult ? "completed" : "failed");
        setRunResult(previousResult ?? {
          text: "", contextUsed: [], durationMs: Date.now() - start, tokens: 0,
          error: { message: "No response received from the model", code: "EMPTY_RESPONSE" },
        });
        setShowFollowUp(!!previousResult);
        setRefinementStatus("Refinement failed: no response received from the model");
        refinementSnapshotRef.current = null;
      }
    } catch (err) {
      clearStepPoll();
      onRunningChange?.(false);
      onActiveRunChange?.(null);
      setActiveRunId(null);
      if ((err as Error).name === "AbortError") return;
      setRunState(previousResult ? "completed" : "failed");
      setRunResult(previousResult ?? {
        text: "", contextUsed: [], durationMs: 0, tokens: 0,
        error: { message: (err as Error).message || "An unexpected error occurred" },
      });
      setShowFollowUp(!!previousResult);
      setRefinementStatus(`Refinement failed: ${(err as Error).message || "An unexpected error occurred"}`);
      refinementSnapshotRef.current = null;
    }
  }, [prompt, runResult, conversationHistory, block, modelId, modelProvider, sources, agentMode, outputMode, contextMode, onRunComplete, onRunningChange, onActiveRunChange, pageBlocks, supabase, clearStepPoll, onUpdate, handleToolOnlySuccess, collectOutputBlocks, lastRunId, lastOutputBlocks, fetchChildOutputBlocks, fetchLatestRunId]);

  const completedTurns = Math.floor(conversationHistory.length / 2);
  const maxTurns = MAX_CONVERSATION_TURNS;
  const turnCount = Math.min(Math.max(completedTurns, 1), maxTurns);
  const atTurnLimit = completedTurns >= maxTurns;

  const clearConversation = useCallback(() => {
    setConversationHistory([]);
    setShowFollowUp(false);
    onUpdate({ ...block.content, conversationHistory: [] });
  }, [block.content, onUpdate]);

  useEffect(() => {
    function handleChildRefine(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.parentBlockId === block.id && detail?.prompt) {
        refineFocusBlockIdRef.current = detail.focusBlockId ?? null;
        handleFollowUp(detail.prompt);
      }
    }
    window.addEventListener("cell-refine-request", handleChildRefine);
    return () => window.removeEventListener("cell-refine-request", handleChildRefine);
  }, [block.id, handleFollowUp]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleRun();
    }
  };

  const isRunning = runState === "running";
  const hasOutput = runState === "completed" || runState === "failed";
  const isError = runState === "failed";
  const showInlineOutput = isRunning || hasOutput;

  return (
    <div data-running={isRunning ? "true" : undefined}>
      {/* Prompt area */}
      <div className={`px-4 pt-3 ${sources.length > 0 ? "pb-0" : "pb-3"}`}>
        <textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            onUpdate({ ...block.content, prompt: e.target.value });
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={handleKeyDown}
          ref={(el) => {
            if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
          }}
          placeholder="Describe what you want the AI to do..."
          rows={1}
          className="w-full resize-none bg-transparent text-[14px] text-gray-800
                     font-mono leading-relaxed placeholder:text-gray-400 outline-none overflow-hidden"
        />
      </div>

      {/* Attached sources — bordered pills */}
      {sources.length > 0 && (
        <div className="px-4 pt-3 pb-2.5 flex items-center gap-2 flex-wrap">
          {sources.map((source, index) => (
            <SourceChipWithPreview
              key={index}
              source={source}
              index={index}
              modelProvider={modelProvider}
              modelId={modelId}
              pageBlocks={pageBlocks}
              onRemove={removeSource}
            />
          ))}
        </div>
      )}

      {/* Action bar — bold bordered buttons | model box + run */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100">
        {/* Left actions — bold text, black borders */}
        <div className="flex items-center gap-2">
          <div className="relative" ref={attachRef}>
            <button
              onClick={() => setShowAttachMenu(!showAttachMenu)}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md
                         border text-[13px] font-semibold transition-colors cursor-pointer
                         ${showAttachMenu
                           ? "border-gray-500 bg-gray-50 text-gray-800"
                           : "border-gray-400 bg-white text-gray-700 hover:border-gray-500 hover:bg-gray-50"}`}
            >
              <Paperclip className="h-3.5 w-3.5" />
              Attach
            </button>

            {showAttachMenu && attachMenuStyle && typeof document !== "undefined" && createPortal(
              <div ref={attachMenuInner} style={attachMenuStyle} className="z-[1000]">
                <AttachMenu
                  onUploadFile={handleUploadFile}
                  onAddBatchSources={handleAddBatchSources}
                  onAddPaste={handleAddPaste}
                  onSelectBlock={handleSelectBlock}
                  pageBlocks={pageBlocks}
                  workspaceId={block.workspace_id}
                  pageId={block.page_id}
                  onSourceCardsReady={handleSourceCardsReady}
                  onViewSourceCards={handleViewSourceCards}
                  onClose={() => setShowAttachMenu(false)}
                />
              </div>,
              document.body
            )}
          </div>

          <div className="relative" ref={memoryRef}>
            <button
              onClick={() => setShowMemory(!showMemory)}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md
                         border text-[13px] font-semibold transition-colors cursor-pointer
                         ${showMemory
                           ? "border-gray-500 bg-gray-50 text-gray-800"
                           : "border-gray-400 bg-white text-gray-700 hover:border-gray-500 hover:bg-gray-50"}`}
            >
              <Database className="h-3.5 w-3.5" />
              Memory
            </button>

            {showMemory && memoryMenuStyle && typeof document !== "undefined" && createPortal(
              <div ref={memoryMenuRef} style={memoryMenuStyle} className="z-[1000]">
                <MemorySearchPopover
                  workspaceId={block.workspace_id}
                  triggerRef={memoryRef}
                  onClose={() => setShowMemory(false)}
                  onAttach={(results) => {
                    const typeLabels: Record<string, string> = { page: "Page", block: "Block", file: "File", web: "Source" };
                    const newSources: AttachedSource[] = results.map((r) => {
                      const typeName = typeLabels[r.sourceType] || "Memory";
                      const name = r.metadata.pageTitle || r.metadata.filename || r.metadata.title
                        || r.metadata.breadcrumb || r.content.slice(0, 40);
                      return {
                        ref: { type: "paste" as const, content: r.content },
                        label: `${typeName}: ${name}`,
                        icon: "rag" as const,
                      };
                    });
                    setSources((prev) => [...prev, ...newSources]);
                  }}
                />
              </div>,
              document.body
            )}
          </div>

          <button
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md
                       border border-gray-400 bg-white text-[13px] font-semibold text-gray-700
                       hover:border-gray-500 hover:bg-gray-50
                       transition-colors cursor-pointer"
          >
            <Slash className="h-3.5 w-3.5" />
            Command
          </button>

          {/* Context mode selector */}
          <ContextModePicker
            mode={contextMode}
            onChange={(mode) => onUpdate({ ...block.content, contextMode: mode })}
          />
        </div>

        {/* Right — agent toggle, model selector, token counter, Run */}
        <div className="flex items-center gap-2.5">
          <button
            role="switch"
            aria-checked={agentMode}
            onClick={() => {
              const next = !agentMode;
              setAgentMode(next);
              onUpdate({ ...block.content, agentMode: next });
            }}
            className={`h-7 px-3 rounded-full text-[12px] font-medium transition-colors cursor-pointer
                       inline-flex items-center gap-1.5 select-none
                       ${agentMode
                         ? "bg-blue-500 text-white"
                         : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
          >
            <Zap className="h-3 w-3" />
            Agent
          </button>

          <ModelSelector
            value={modelId}
            onChange={(id, provider) => {
              onUpdate({ ...block.content, model_name: id, model_provider: provider });
            }}
          />

          {tokenEstimate && (() => {
            const circ = 50.27;
            const limit = tokenEstimate.modelLimit || 1;
            const promptPct = (tokenEstimate.breakdown.userPrompt / limit) * 100;
            const sourcesPct = (tokenEstimate.breakdown.sources / limit) * 100;
            const systemPct = (tokenEstimate.breakdown.systemPrompt / limit) * 100;
            const promptLen = Math.min(promptPct, 100) * circ / 100;
            const sourcesLen = Math.min(sourcesPct, 100) * circ / 100;
            const systemLen = Math.min(systemPct, 100) * circ / 100;
            const promptOffset = 0;
            const sourcesOffset = promptLen;
            const systemOffset = promptLen + sourcesLen;
            return (
              <div className="relative group/tokens">
                {/* Multi-color progress ring */}
                <svg className="h-5 w-5 cursor-default" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="8" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                  {promptLen > 0 && (
                    <circle cx="10" cy="10" r="8" fill="none" strokeWidth="3"
                      className="stroke-blue-500"
                      strokeDasharray={`${promptLen} ${circ - promptLen}`}
                      strokeDashoffset={-promptOffset}
                      transform="rotate(-90 10 10)" />
                  )}
                  {sourcesLen > 0 && (
                    <circle cx="10" cy="10" r="8" fill="none" strokeWidth="3"
                      className="stroke-green-500"
                      strokeDasharray={`${sourcesLen} ${circ - sourcesLen}`}
                      strokeDashoffset={-sourcesOffset}
                      transform="rotate(-90 10 10)" />
                  )}
                  {systemLen > 0 && (
                    <circle cx="10" cy="10" r="8" fill="none" strokeWidth="3"
                      className="stroke-purple-500"
                      strokeDasharray={`${systemLen} ${circ - systemLen}`}
                      strokeDashoffset={-systemOffset}
                      transform="rotate(-90 10 10)" />
                  )}
                </svg>
                {/* Popover — below with triangle */}
                <div className="absolute top-full mt-3 left-1/2 -translate-x-1/2 w-[230px] opacity-0 pointer-events-none
                                group-hover/tokens:opacity-100 group-hover/tokens:pointer-events-auto
                                transition-opacity z-[200]">
                  {/* Card */}
                  <div className="relative bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3.5">
                    {/* Triangle — centered under ring */}
                    <div className="absolute -top-[7px] left-1/2 -translate-x-1/2
                                    w-3.5 h-3.5 rotate-45 bg-white border-l border-t border-gray-200" />
                    <div className="space-y-3 text-[13px]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="h-[7px] w-[7px] rounded-full bg-blue-500 shrink-0" />
                          <span className="text-gray-700">Prompt</span>
                        </div>
                        <span className="text-gray-900 font-medium tabular-nums">
                          {formatTokenCount(tokenEstimate.breakdown.userPrompt)} tokens
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="h-[7px] w-[7px] rounded-full bg-green-500 shrink-0" />
                          <span className="text-gray-700">Sources</span>
                        </div>
                        <span className="text-gray-900 font-medium tabular-nums">
                          {formatTokenCount(tokenEstimate.breakdown.sources)} tokens
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="h-[7px] w-[7px] rounded-full bg-purple-500 shrink-0" />
                          <span className="text-gray-700">System/tools</span>
                        </div>
                        <span className="text-gray-900 font-medium tabular-nums">
                          {formatTokenCount(tokenEstimate.breakdown.systemPrompt)} tokens
                        </span>
                      </div>
                      <div className="border-t border-gray-100 pt-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span className="h-[7px] w-[7px] rounded-full bg-gray-400 shrink-0" />
                            <span className="text-gray-700">Model limit</span>
                          </div>
                          <span className="text-gray-900 font-medium tabular-nums">
                            {formatTokenCount(tokenEstimate.modelLimit)} tokens
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center">
              {isRunning ? (
                <button
                  onClick={handleCancel}
                  className="h-8 px-3 flex items-center gap-1.5 rounded-md
                             bg-red-500 hover:bg-red-600
                             transition-all cursor-pointer"
                >
                  <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
                  <span className="text-[13px] text-white font-semibold">
                    Cancel
                  </span>
                </button>
              ) : (
                <>
                  <button
                    data-run-button
                    onClick={handleRun}
                    disabled={!prompt.trim()}
                    className="h-8 pl-3 pr-2 flex items-center gap-1.5 rounded-l-md
                               bg-blue-500 hover:bg-blue-600
                               transition-all cursor-pointer
                               disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Play className="h-3 w-3 text-white fill-white" />
                    <span className="text-[13px] text-white font-semibold">
                      Run
                    </span>
                  </button>
                  <button
                    onClick={() => setShowRunDropdown(!showRunDropdown)}
                    className="h-8 w-6 flex items-center justify-center rounded-r-md
                               bg-blue-500 hover:bg-blue-600
                               border-l border-white/20
                               transition-all cursor-pointer"
                  >
                    <ChevronDown className="h-3 w-3 text-white" />
                  </button>
                </>
              )}
            </div>

            {showRunDropdown && runMenuStyle && typeof document !== "undefined" && createPortal(
              <div
                ref={runMenuRef}
                style={runMenuStyle}
                className="z-[1000] bg-white border border-gray-200 rounded-lg shadow-lg py-1.5"
              >
                <button
                  onClick={() => {
                    if (runState === "completed") {
                      setShowMakeReusable(true);
                      setShowRunDropdown(false);
                    }
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-[13px]
                             transition-colors
                             ${runState === "completed"
                               ? "text-gray-700 hover:bg-gray-50 cursor-pointer"
                               : "text-gray-300 cursor-not-allowed"}`}
                >
                  <PackagePlus className="h-4 w-4" />
                  Make Reusable
                </button>
                <button
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px]
                             text-gray-300 cursor-not-allowed transition-colors"
                >
                  <Zap className="h-4 w-4" />
                  Make Callable
                </button>
                <div className="border-t border-gray-100 my-1 mx-2" />
                {/* Output mode — hover submenu */}
                <div
                  className="relative"
                  onMouseEnter={() => {
                    if (outputModeTimerRef.current) clearTimeout(outputModeTimerRef.current);
                    setShowOutputModeFlyout(true);
                  }}
                  onMouseLeave={() => {
                    outputModeTimerRef.current = setTimeout(() => setShowOutputModeFlyout(false), 250);
                  }}
                >
                  <div
                    className={`flex w-full items-center justify-between px-3 py-2 text-[13px]
                               text-gray-700 cursor-default transition-colors
                               ${showOutputModeFlyout ? "bg-gray-50" : "hover:bg-gray-50"}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Layers className="h-4 w-4" />
                      <span>Output mode</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-gray-400 capitalize">
                        {outputMode}
                      </span>
                      <ChevronRight className="h-3 w-3 text-gray-400" />
                    </div>
                  </div>
                  {/* Flyout submenu */}
                  {showOutputModeFlyout && (
                    <div className="absolute right-full top-0 w-52 bg-white border border-gray-200
                                    rounded-lg shadow-lg py-1.5
                                    animate-in fade-in duration-75
                                    after:content-[''] after:absolute after:top-0 after:left-full after:w-3 after:h-full">
                      {([
                        { mode: "replace" as const, label: "Replace", desc: "Overwrite existing output" },
                        { mode: "append" as const, label: "Append", desc: "Add new output below" },
                        { mode: "version" as const, label: "Version", desc: "Save old output as version" },
                      ]).map(({ mode, label, desc }) => (
                        <button
                          key={mode}
                          onClick={() => {
                            setOutputMode(mode);
                            onUpdate({ ...block.content, outputMode: mode });
                          }}
                          className="flex w-full items-center px-3 py-2 text-[13px]
                                     text-gray-700 hover:bg-gray-50 cursor-pointer transition-colors"
                        >
                          <span className="h-4 w-4 flex items-center justify-center shrink-0">
                            {outputMode === mode && <Check className="h-3.5 w-3.5 text-blue-500" />}
                          </span>
                          <div className="flex-1 text-center">
                            <div className="font-medium">{label}</div>
                            <div className="text-[11px] text-gray-400">{desc}</div>
                          </div>
                          <span className="h-4 w-4 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (!onSchedule) return;
                    setShowRunDropdown(false);
                    onSchedule?.();
                  }}
                  disabled={!onSchedule}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors
                    ${onSchedule
                      ? "text-gray-700 hover:bg-gray-50 cursor-pointer"
                      : "text-gray-300 cursor-not-allowed"}`}
                >
                  <Clock className="h-4 w-4" />
                  Schedule Run
                </button>
                <button
                  onClick={() => {
                    if (runState && onViewRun) {
                      onViewRun();
                      setShowRunDropdown(false);
                    }
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-[13px]
                             transition-colors
                             ${runState
                               ? "text-gray-700 hover:bg-gray-50 cursor-pointer"
                               : "text-gray-300 cursor-not-allowed"}`}
                >
                  <Eye className="h-4 w-4" />
                  View Run
                </button>
                <button
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px]
                             text-gray-300 cursor-not-allowed transition-colors"
                >
                  <History className="h-4 w-4" />
                  View Versions
                </button>
              </div>,
              document.body
            )}
          </div>
        </div>
      </div>

      {/* Agent progress panel */}
      {agentMode && isRunning && (
        <div className="border-t border-gray-200 bg-white mx-4 my-3 rounded-lg border border-gray-200 shadow-sm">
          {/* Header */}
          <div className="px-5 pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[14px] font-semibold text-gray-900">
                  Agent is working...
                </div>
                <p className="text-[12px] text-gray-400 mt-0.5">You can observe progress in real time and interrupt at any time.</p>
              </div>
              <div className="flex items-end gap-[3px] h-5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="w-[3px] rounded-sm bg-blue-500/80"
                    style={{
                      animation: `agent-bars 1.2s ease-in-out ${i * 0.15}s infinite alternate`,
                    }} />
                ))}
                <style>{`
                  @keyframes agent-bars {
                    0% { height: 4px; }
                    100% { height: 18px; }
                  }
                `}</style>
              </div>
            </div>
          </div>

          {/* Steps */}
          <div className="divide-y divide-gray-100">
            {agentSteps.map((step, i) => {
              const isActive = i === agentSteps.length - 1;
              const calls = step.toolCalls as Array<{ name: string; args?: Record<string, unknown> }> | undefined;
              const tokenUsage = step.tokenUsage as Record<string, number> | null;
              const argsPreview = calls?.[0]?.args
                ? Object.values(calls[0].args).filter((v) => typeof v === "string").join(", ").slice(0, 40)
                : "";
              return (
                <div key={i} className={`flex items-center gap-3 px-5 py-3 ${isActive ? "bg-blue-50/60" : ""} animate-in fade-in slide-in-from-bottom-1 duration-300`}>
                  {isActive ? (
                    <span className="h-5 w-5 flex items-center justify-center shrink-0">
                      <span className="h-3 w-3 rounded-full bg-blue-500 animate-pulse" />
                    </span>
                  ) : (
                    <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                      <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className={`text-[13px] ${isActive ? "font-semibold text-blue-700" : "font-medium text-gray-700"}`}>
                      {describeStep(step)}
                    </span>
                    {isActive && argsPreview && (
                      <p className="text-[11px] text-blue-500/70 mt-0.5 truncate">{argsPreview}</p>
                    )}
                  </div>
                  {tokenUsage?.total && (
                    <span className="text-[11px] text-gray-400 font-mono tabular-nums shrink-0">
                      {tokenUsage.total.toLocaleString()}
                    </span>
                  )}
                </div>
              );
            })}
            {(agentSteps.length === 0 || agentSteps[agentSteps.length - 1]?.finishReason !== "stop") && (
              <div className="flex items-center gap-3 px-5 py-3">
                <span className="h-5 w-5 flex items-center justify-center shrink-0">
                  <span className="h-3 w-3 rounded-full border-2 border-gray-300" />
                </span>
                <span className="text-[13px] text-gray-400">Deciding next step</span>
                <span className="flex gap-[3px] ml-1">
                  <span className="h-[5px] w-[5px] rounded-full bg-blue-400 animate-pulse" />
                  <span className="h-[5px] w-[5px] rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: "0.15s" }} />
                  <span className="h-[5px] w-[5px] rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: "0.3s" }} />
                </span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200">
            <button
              onClick={handleCancel}
              className="text-[12px] text-gray-500 hover:text-gray-700 font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            {onViewRun && (
              <button
                onClick={onViewRun}
                className="text-[12px] text-blue-600 font-semibold px-4 py-1.5 rounded-md
                           bg-blue-50 border border-blue-200 hover:bg-blue-100
                           transition-colors cursor-pointer"
              >
                View full run
              </button>
            )}
          </div>
        </div>
      )}

      {/* Agent completed summary */}
      {agentMode && runState === "completed" && agentSteps.length > 0 && (
        <div className="border-t border-gray-200 px-5 py-2.5">
          <div className="flex items-center gap-2 text-[12px] text-gray-500">
            <div className="h-4 w-4 rounded-full bg-green-500 flex items-center justify-center shrink-0">
              <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span>Agent completed · {agentSteps.length} step{agentSteps.length !== 1 ? "s" : ""}{runResult?.durationMs ? ` · ${formatElapsed(runResult.durationMs)}` : ""}</span>
          </div>
        </div>
      )}

      {/* Inline output */}
      {showInlineOutput && (
        <div className="border-t border-gray-200 bg-white">
          {isRunning && !runResult?.text && !agentMode && (
            <div className="px-4 py-6 flex items-center justify-center">
              <div className="flex items-center gap-2 text-[13px] text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                Generating response...
              </div>
            </div>
          )}

          {/* Inline text — visible during streaming and after completion */}
          {runResult?.text && (
            <div className="px-5 py-4">
              <div className="ai-output text-[13px] text-gray-700 leading-relaxed select-text">
                <Markdown>{runResult.text}</Markdown>
              </div>
            </div>
          )}

          {/* Run complete status bar — shown after completion when child blocks exist */}
          {!isRunning && runState === "completed" && hasChildBlocks && (
            <div className="border-t border-gray-100 px-5 py-2 flex items-center gap-2.5 text-[12px] text-gray-500">
              <div className="h-3.5 w-3.5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                <svg className="h-2 w-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="font-medium text-gray-600">Run complete</span>
              <span className="text-gray-300">·</span>
              <div className="flex items-center gap-1.5">
                {(() => {
                  const n = Math.min(childBlocks.length, 6);
                  const bottomRow = Math.ceil(n / 2);
                  const topRow = n - bottomRow;
                  return (
                    <div className="flex flex-col gap-[2px] items-center">
                      {topRow > 0 && (
                        <div className="flex gap-[2px]">
                          {Array.from({ length: topRow }).map((_, i) => (
                            <div key={`t${i}`} className="w-[5px] h-[5px] rounded-[1px] bg-gray-400" />
                          ))}
                        </div>
                      )}
                      <div className="flex gap-[2px]">
                        {Array.from({ length: bottomRow }).map((_, i) => (
                          <div key={`b${i}`} className="w-[5px] h-[5px] rounded-[1px] bg-gray-400" />
                        ))}
                      </div>
                    </div>
                  );
                })()}
                <span>{childBlocks.length} output{childBlocks.length !== 1 ? "s" : ""}</span>
              </div>
              {runResult?.durationMs ? (
                <>
                  <span className="text-gray-300">·</span>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-gray-400" />
                    <span>{formatElapsed(runResult.durationMs)}</span>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {refinementStatus && (
            <div className="border-t border-amber-100 bg-amber-50 px-5 py-2 text-[12px] text-amber-700">
              {refinementStatus}
            </div>
          )}

          {isError && runResult?.error && (
            <div className="px-5 py-4" data-run-error={runResult.error.message}>
              <div className="flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-cell-error shrink-0 mt-0.5" />
                <div className="min-w-0">
                  {runResult.error.code && (
                    <span className="text-[10px] font-mono font-semibold text-cell-error/70
                                   uppercase tracking-wider mr-2">
                      {runResult.error.code}
                    </span>
                  )}
                  <span className="text-[13px] text-gray-700 leading-relaxed">
                    {runResult.error.message}
                  </span>
                  {runResult.error.details && (
                    <pre className="mt-2 text-[11px] font-mono text-gray-500 leading-relaxed
                                    whitespace-pre-wrap break-words">
                      {runResult.error.details}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Refine footer — only for text-only responses (no child blocks) */}
          {showFollowUp && !isRunning && !isError && !hasChildBlocks && (
            <div className="border-t border-gray-100 px-5 py-2 flex items-center justify-between relative">
              <button
                onClick={() => setActiveOutputAction(activeOutputAction === "refine" ? null : "refine")}
                className={`inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors cursor-pointer
                           ${activeOutputAction === "refine"
                             ? "text-blue-600"
                             : "text-gray-500 hover:text-gray-700"}`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Refine
                {activeOutputAction === "refine"
                  ? <ChevronUp className="h-3 w-3" />
                  : <ChevronDown className="h-3 w-3" />}
              </button>

              <div className="flex items-center text-[11px] text-gray-400">
                <span>{sources.length} source{sources.length !== 1 ? "s" : ""}</span>
                {conversationHistory.length > 0 && (
                  <>
                    <span className="mx-1.5">·</span>
                    <span className="tabular-nums">Turn {turnCount}/{maxTurns}</span>
                  </>
                )}
                <div className="mx-3 h-4 w-px bg-gray-200" />
                <button
                  onClick={() => {
                    const text = runResult?.text || "";
                    if (text) navigator.clipboard.writeText(text);
                  }}
                  className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer p-0.5"
                  title="More options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>

              {activeOutputAction === "refine" && !atTurnLimit && (
                <div className="absolute left-4 top-full mt-1 z-[200] w-[420px]">
                  <div className="absolute -top-[6px] left-5
                                  w-3 h-3 rotate-45 bg-white border-l border-t border-gray-200 z-10" />
                  <div className="relative bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                    <div className="px-4 pt-3.5 pb-3">
                      <h4 className="text-[13px] font-semibold text-gray-900 mb-2.5">Refine this output</h4>
                      <div className="flex items-center gap-2.5 border border-gray-200 rounded-lg px-3 py-2
                                      focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400">
                        <Sparkles className="h-3.5 w-3.5 text-gray-300 shrink-0" />
                        <input
                          autoFocus
                          type="text"
                          value={followUpPrompt}
                          onChange={(e) => setFollowUpPrompt(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && followUpPrompt.trim()) {
                              e.preventDefault();
                              handleFollowUp(followUpPrompt);
                              setActiveOutputAction(null);
                            }
                            if (e.key === "Escape") setActiveOutputAction(null);
                          }}
                          placeholder="Describe a change or choose an action..."
                          className="flex-1 text-[13px] text-gray-800 placeholder:text-gray-400 outline-none bg-transparent"
                        />
                      </div>
                    </div>
                    <div className="border-t border-gray-100">
                      {([
                        { icon: AlignLeft, label: "Make shorter", action: "Make shorter" },
                        { icon: MessageSquare, label: "Add citations", action: "Add citations" },
                        { icon: CheckSquare, label: "Extract action items", action: "Extract action items" },
                        { icon: Table2, label: "Turn into table", action: "Turn into table" },
                        { icon: Bookmark, label: "Save as command", action: "__save_command__" },
                      ] as const).map((item) => (
                        <button
                          key={item.label}
                          onClick={() => {
                            if (item.action === "__save_command__") {
                              setShowMakeReusable(true);
                              setActiveOutputAction(null);
                            } else {
                              handleFollowUp(item.action);
                              setActiveOutputAction(null);
                            }
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-gray-700
                                     hover:bg-gray-50 transition-colors cursor-pointer"
                        >
                          <item.icon className="h-4 w-4 text-gray-400 shrink-0" />
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-gray-100 px-4 py-2.5 flex items-center justify-between bg-gray-50/50">
                      <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                        <Info className="h-3 w-3" />
                        This refinement reads the output and original sources
                      </div>
                      <button
                        onClick={() => {
                          if (followUpPrompt.trim()) {
                            handleFollowUp(followUpPrompt);
                            setActiveOutputAction(null);
                          }
                        }}
                        disabled={!followUpPrompt.trim()}
                        className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-blue-500
                                   hover:bg-blue-600 transition-colors cursor-pointer
                                   disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-medium"
                      >
                        Run
                        <Play className="h-3 w-3 fill-white" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeOutputAction === "refine" && atTurnLimit && (
                <div className="absolute left-4 top-full mt-1 z-[200] w-[420px]">
                  <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 flex items-center justify-between">
                    <span className="text-[12px] text-gray-500">Conversation limit reached</span>
                    <button onClick={clearConversation} className="text-[12px] text-blue-500 hover:text-blue-600 cursor-pointer">
                      Clear history
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <MakeReusableDrawer
        isOpen={showMakeReusable}
        onClose={() => setShowMakeReusable(false)}
        prompt={prompt}
        block={block}
        attachedSources={sources}
        usedContext={hasContextBlocks}
      />
    </div>
  );
}
