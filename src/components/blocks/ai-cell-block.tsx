"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from "react";
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
  LayoutGrid,
  Braces,
  CheckSquare,
  List,
  ListOrdered,
} from "lucide-react";
import Markdown from "react-markdown";
import { ModelSelector } from "./model-selector";
import { MakeReusableDrawer } from "./make-reusable-drawer";
import type { Block } from "@/lib/models/types";
import type { SourceReference } from "@/services/source-service";

interface AiCellBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
  onRun?: (prompt: string) => void;
  pageBlocks?: Block[];
  onRunComplete?: () => Promise<void>;
  onRunningChange?: (running: boolean) => void;
  onViewRun?: () => void;
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
  icon: "file" | "url" | "block" | "paste" | "rag";
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
};

/* ── Attach menu ─────────────────────────────────────────── */

interface AttachMenuProps {
  onUploadFile: (file: File) => void;
  onAddUrl: (url: string) => void;
  onAddPaste: (text: string) => void;
  onSelectBlock: (blockId: string, label: string) => void;
  pageBlocks: Block[];
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
  upload: { title: "Upload file", subtitle: "Drag & drop or browse for a file to use as AI context." },
  url: { title: "Attach from URL", subtitle: "Add a web page and include its content in this AI cell." },
  blocks: { title: "Insert notebook blocks", subtitle: "Select blocks from this page to use as context." },
  paste: { title: "Paste content", subtitle: "Paste text, notes, or data to include as AI context." },
};

const BLOCK_ICONS: Record<string, typeof FileText> = {
  ai_cell: Sparkles, text: Type, heading: Type, table: LayoutGrid,
  json: Braces, todo: CheckSquare, output: Sparkles, callout: AlertCircle,
  file: FileText, command_ref: Slash, bulleted_list: List,
  numbered_list: ListOrdered, error: AlertCircle,
};

const BLOCK_DESCRIPTIONS: Record<string, string> = {
  ai_cell: "AI cell and its output", text: "Rich text content", heading: "Section heading",
  table: "Table block", json: "JSON data", todo: "Checklist items", output: "AI output",
  callout: "Callout note", file: "File or document", command_ref: "Command and result",
  bulleted_list: "Bullet list", numbered_list: "Numbered list", error: "Error output",
};

const BLOCK_TYPE_LABELS: Record<string, string> = {
  text: "Text Note", heading: "Heading", table: "Table", json: "JSON",
  todo: "Checklist", output: "Output", ai_cell: "AI Cell",
  callout: "Callout", file: "File Block", command_ref: "Command",
  bulleted_list: "Bulleted List", numbered_list: "Numbered List",
};

function AttachMenu({
  onUploadFile, onAddUrl, onAddPaste, onSelectBlock,
  pageBlocks, onClose,
}: AttachMenuProps) {
  const [tab, setTab] = useState<AttachTab>("upload");
  const [urlValue, setUrlValue] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  const [blockSearch, setBlockSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const blockSearchRef = useRef<HTMLInputElement>(null);

  const visibleNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    let count = 0;
    for (const b of pageBlocks) {
      if (b.type === "output" && b.parent_block_id) continue;
      count++;
      map.set(b.id, count);
    }
    return map;
  }, [pageBlocks]);

  const selectableBlocks = pageBlocks.filter(
    (b) => !["separator", "input", "input_group", "ai_cell", "file"].includes(b.type)
      && !(b.type === "output" && b.parent_block_id)
  );

  const filteredBlocks = blockSearch
    ? selectableBlocks.filter((b) => {
        const label = (BLOCK_TYPE_LABELS[b.type] || b.type).toLowerCase();
        return label.includes(blockSearch.toLowerCase());
      })
    : selectableBlocks;

  useEffect(() => {
    if (tab === "url") urlInputRef.current?.focus();
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
      <div className="h-[220px] px-4 pb-4 flex flex-col">
        <input
          ref={fileInputRef}
          type="file"
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
                PDF, CSV, TXT, Markdown, JSON
              </span>
            </div>
          </button>
        )}

        {tab === "url" && (
          <div className="flex flex-col flex-1">
            <div className="relative">
              <input
                ref={urlInputRef}
                type="url"
                placeholder="https://example.com/article"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && urlValue.trim()) {
                    onAddUrl(urlValue.trim());
                    onClose();
                  }
                }}
                className="w-full h-10 px-3 pr-8 text-[13px] border border-gray-300 rounded-lg
                           outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500
                           placeholder:text-gray-400"
              />
              {urlValue && (
                <button
                  onClick={() => setUrlValue("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5
                             flex items-center justify-center rounded text-gray-400
                             hover:text-gray-600 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => { if (urlValue.trim()) { onAddUrl(urlValue.trim()); onClose(); } }}
              disabled={!urlValue.trim()}
              className="mt-3 h-9 px-4 text-[13px] font-medium text-white bg-blue-500
                         rounded-lg hover:bg-blue-600 transition-colors cursor-pointer self-start
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add URL
            </button>
            <p className="text-[11px] text-gray-400 mt-auto flex items-center gap-1.5">
              <Globe className="h-3 w-3 shrink-0" />
              Attaches websites, docs, and public articles. Content is fetched securely.
            </p>
          </div>
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
                    onClick={() => { onSelectBlock(b.id, label); onClose(); }}
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

/* ── AI Cell Block ───────────────────────────────────────── */

export function AiCellBlock({ block, onUpdate, pageBlocks = [], onRunComplete, onRunningChange, onViewRun }: AiCellBlockProps) {
  const [prompt, setPrompt] = useState(
    (block.content?.prompt as string) || ""
  );
  const [runState, setRunState] = useState<RunState>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [showMakeReusable, setShowMakeReusable] = useState(false);
  const [showRunDropdown, setShowRunDropdown] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [sources, setSources] = useState<AttachedSource[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const attachRef = useRef<HTMLDivElement>(null);
  const attachMenuInner = useRef<HTMLDivElement>(null);
  const [attachFlipDown, setAttachFlipDown] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  const childOutput = pageBlocks.find(
    (b) => b.parent_block_id === block.id && b.type === "output"
  );
  const hasContextBlocks = pageBlocks.some(
    (b) =>
      b.sort_order < block.sort_order &&
      !["input", "input_group", "separator"].includes(b.type)
  );

  useEffect(() => {
    if (childOutput && !runResult && runState === null) {
      void Promise.resolve().then(() => {
        setRunState("completed");
        setRunResult({ text: "", contextUsed: [], durationMs: 0, tokens: 0 });
      });
    }
  }, [childOutput, runResult, runState]);

  useEffect(() => {
    if (!showRunDropdown) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowRunDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showRunDropdown]);

  useEffect(() => {
    if (!showAttachMenu) return;
    function handleClick(e: MouseEvent) {
      if (attachRef.current && !attachRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showAttachMenu]);

  useLayoutEffect(() => {
    if (!showAttachMenu || !attachRef.current) return;
    const btnRect = attachRef.current.getBoundingClientRect();
    const menuHeight = 380;
    const spaceAbove = btnRect.top;
    setAttachFlipDown(spaceAbove < menuHeight + 8);
  }, [showAttachMenu]);

  const modelId = (block.content?.model_name as string) || undefined;
  const variables = extractVariables(prompt);

  const removeSource = useCallback((index: number) => {
    setSources((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUploadFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop() || "";
    const storagePath = `${block.workspace_id}/${block.id}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("files")
      .upload(storagePath, file, { upsert: true });
    if (uploadError) return;

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
      setSources((prev) => [...prev, {
        ref: { type: "file", fileId: fileRecord.id },
        label: file.name,
        icon: "file",
      }]);
    }
  }, [supabase, block.workspace_id, block.id]);

  const handleAddUrl = useCallback((raw: string) => {
    let url = raw.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    let parsed: URL;
    try { parsed = new URL(url); } catch { return; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;

    setSources((prev) => [...prev, {
      ref: { type: "url", url: parsed.href },
      label: parsed.hostname,
      icon: "url",
    }]);
  }, []);

  const handleAddPaste = useCallback((text: string) => {
    const wordCount = text.split(/\s+/).length;
    setSources((prev) => [...prev, {
      ref: { type: "paste", content: text },
      label: `Pasted text (${wordCount} words)`,
      icon: "paste",
    }]);
  }, []);

  const handleSelectBlock = useCallback((blockId: string, label: string) => {
    setSources((prev) => [...prev, {
      ref: { type: "block", blockId },
      label,
      icon: "block",
    }]);
  }, []);

  const handleRun = useCallback(async () => {
    if (!prompt.trim()) return;

    setRunState("running");
    setRunResult(null);
    onRunningChange?.(true);

    try {
      const aboveBlocks = pageBlocks
        .filter((b) => b.sort_order < block.sort_order && b.type !== "input" && b.type !== "separator")
        .map(blockToContext);

      const existingOutputBlockIds = pageBlocks
        .filter((b) => b.parent_block_id === block.id && b.type === "output")
        .map((b) => b.id);

      const res = await fetch("/api/ai/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          contextBlocks: aboveBlocks,
          existingOutputBlockIds,
          sources: sources.map((s) => s.ref),
          modelProvider: (block.content?.model_provider as string) || "anthropic",
          modelName: modelId || "",
          pageId: block.page_id,
          triggerBlockId: block.id,
          workspaceId: block.workspace_id,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setRunState("failed");
        setRunResult({
          text: "",
          contextUsed: variables,
          durationMs: 0,
          tokens: 0,
          error: {
            message: err.error || err.message || `Request failed (${res.status})`,
            code: `HTTP_${res.status}`,
          },
        });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let fullText = "";
      const startTime = Date.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setRunState("completed");
        setRunResult({
          text: fullText,
          contextUsed: variables,
          durationMs: Date.now() - startTime,
          tokens: 0,
        });
      }

      const elapsed = Date.now() - startTime;
      onRunningChange?.(false);

      if (!fullText.trim()) {
        setRunState("failed");
        setRunResult({
          text: "",
          contextUsed: variables,
          durationMs: elapsed,
          tokens: 0,
          error: {
            message: "No response received from the model",
            code: "EMPTY_RESPONSE",
          },
        });
      } else if (onRunComplete) {
        setTimeout(() => { onRunComplete(); }, 500);
      }
    } catch (err) {
      onRunningChange?.(false);
      setRunState("failed");
      setRunResult({
        text: "",
        contextUsed: variables,
        durationMs: 0,
        tokens: 0,
        error: {
          message: (err as Error).message || "An unexpected error occurred",
        },
      });
    }
  }, [prompt, block, modelId, variables, sources, onRunComplete, onRunningChange, pageBlocks]);

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
      <div className="px-4 pt-3 pb-0">
        <textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            onUpdate({ ...block.content, prompt: e.target.value });
          }}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you want the AI to do..."
          rows={2}
          className="w-full resize-none bg-transparent text-[14px] text-gray-800
                     font-mono leading-relaxed placeholder:text-gray-400 outline-none"
        />
      </div>

      {/* Attached sources — bordered pills */}
      {sources.length > 0 && (
        <div className="px-4 pb-2.5 flex items-center gap-2 flex-wrap">
          {sources.map((source, index) => {
            const Icon = SOURCE_ICONS[source.icon];
            return (
              <span
                key={index}
                className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-md
                           bg-white border border-gray-300 text-[13px] text-gray-700
                           hover:border-gray-400 transition-colors"
              >
                <Icon className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                <span className="truncate max-w-[180px]">{source.label}</span>
                <button
                  onClick={() => removeSource(index)}
                  className="h-5 w-5 flex items-center justify-center rounded
                             text-gray-400 hover:text-gray-600
                             transition-colors cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
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

            {showAttachMenu && (
              <div
                ref={attachMenuInner}
                className={`absolute left-0 z-[200]
                  ${attachFlipDown ? "top-full mt-2" : "bottom-full mb-2"}`}
              >
                <AttachMenu
                  onUploadFile={handleUploadFile}
                  onAddUrl={handleAddUrl}
                  onAddPaste={handleAddPaste}
                  onSelectBlock={handleSelectBlock}
                  pageBlocks={pageBlocks}
                  onClose={() => setShowAttachMenu(false)}
                />
              </div>
            )}
          </div>

          <button
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md
                       border border-gray-400 bg-white text-[13px] font-semibold text-gray-700
                       hover:border-gray-500 hover:bg-gray-50
                       transition-colors cursor-pointer"
          >
            <span className="text-[14px] font-bold text-gray-600">@</span>
            Memory
          </button>

          <button
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md
                       border border-gray-400 bg-white text-[13px] font-semibold text-gray-700
                       hover:border-gray-500 hover:bg-gray-50
                       transition-colors cursor-pointer"
          >
            <Slash className="h-3.5 w-3.5" />
            Command
          </button>
        </div>

        {/* Right — model selector in bordered box + Run with dropdown */}
        <div className="flex items-center gap-2.5">
          <ModelSelector
            value={modelId}
            onChange={(id, provider) => {
              onUpdate({ ...block.content, model_name: id, model_provider: provider });
            }}
          />

          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center">
              <button
                data-run-button
                onClick={handleRun}
                disabled={!prompt.trim() || isRunning}
                className="h-8 pl-3 pr-2 flex items-center gap-1.5 rounded-l-md
                           bg-blue-500 hover:bg-blue-600
                           transition-all cursor-pointer
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
                ) : (
                  <Play className="h-3 w-3 text-white fill-white" />
                )}
                <span className="text-[13px] text-white font-semibold">
                  {isRunning ? "Running..." : "Run"}
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
            </div>

            {showRunDropdown && (
              <div
                className="absolute right-0 top-full mt-1 w-[220px] z-[200]
                           bg-white border border-gray-200 rounded-lg shadow-lg py-1.5"
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
                <button
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px]
                             text-gray-300 cursor-not-allowed transition-colors"
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
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inline output */}
      {showInlineOutput && (
        <div className="border-t border-gray-200 bg-white">
          {isRunning && !runResult?.text && (
            <div className="px-4 py-6 flex items-center justify-center">
              <div className="flex items-center gap-2 text-[13px] text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                Generating response...
              </div>
            </div>
          )}

          {runResult?.text && (
            <div className="px-5 py-4">
              <div className="ai-output text-[13px] text-gray-700 leading-relaxed select-text">
                <Markdown>{runResult.text}</Markdown>
              </div>
            </div>
          )}

          {isError && runResult?.error && (
            <div className="px-5 py-4">
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
