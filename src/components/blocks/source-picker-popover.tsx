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
} from "lucide-react";
import type { Block } from "@/lib/models/types";
import type { SourceReference } from "@/services/source-service";

/* ── Types ─────────────────────────────────────────────── */

export interface SourceItem {
  ref: SourceReference;
  label: string;
  sourceType: "file" | "url" | "block" | "paste";
  meta?: string;
}

type FilterTab = "all" | "files" | "notes" | "web";

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "files", label: "Files" },
  { id: "notes", label: "Notes" },
  { id: "web", label: "Web" },
];

const SOURCE_TYPE_ICONS = {
  file: FileText,
  url: Globe,
  block: Type,
  paste: ClipboardPaste,
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  file: "File",
  url: "Web Page",
  block: "Block",
  paste: "Pasted Text",
};

/* ── Block helpers ─────────────────────────────────────── */

const BLOCK_TYPE_LABELS: Record<string, string> = {
  text: "Text Note",
  heading: "Heading",
  table: "Table",
  json: "JSON",
  todo: "Checklist",
  output: "Output",
  ai_cell: "AI Cell",
  callout: "Callout",
  command_ref: "Command",
  bulleted_list: "Bulleted List",
  numbered_list: "Numbered List",
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

function UrlView({ onAddUrl }: { onAddUrl: (url: string) => void }) {
  const [urlValue, setUrlValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="url"
        placeholder="https://example.com/article"
        value={urlValue}
        onChange={(e) => setUrlValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && urlValue.trim()) {
            onAddUrl(urlValue.trim());
            setUrlValue("");
          }
        }}
        className="w-full h-9 px-3 text-[13px] border border-gray-300 rounded-lg
                   outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500
                   placeholder:text-gray-400"
      />
      <button
        onClick={() => {
          if (urlValue.trim()) {
            onAddUrl(urlValue.trim());
            setUrlValue("");
          }
        }}
        disabled={!urlValue.trim()}
        className="h-8 px-3 text-[12px] font-medium text-white bg-blue-500
                   rounded-md hover:bg-blue-600 transition-colors cursor-pointer
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Add URL
      </button>
    </div>
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
  selectedBlockIds,
  onToggleBlock,
}: {
  pageBlocks: Block[];
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
        (b) =>
          !["separator", "input", "input_group"].includes(b.type) &&
          !(b.type === "output" && b.parent_block_id)
      ),
    [pageBlocks]
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
      <div className="max-h-36 overflow-y-auto -mx-1">
        {filtered.length > 0 ? (
          filtered.map((b) => {
            const label = BLOCK_TYPE_LABELS[b.type] || b.type;
            const preview = getBlockPreview(b);
            const selected = selectedBlockIds.has(b.id);
            return (
              <button
                key={b.id}
                onClick={() => onToggleBlock(b)}
                className={`flex w-full items-center gap-2.5 px-2.5 py-2
                           rounded-md cursor-pointer transition-colors
                           ${selected ? "bg-blue-50" : "hover:bg-gray-50"}`}
              >
                <div
                  className={`h-4 w-4 rounded border flex items-center justify-center shrink-0
                             ${
                               selected
                                 ? "bg-blue-500 border-blue-500"
                                 : "border-gray-300"
                             }`}
                >
                  {selected && <Check className="h-2.5 w-2.5 text-white" />}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <span className="text-[12px] font-medium text-gray-700">
                    {label}
                  </span>
                  {preview && (
                    <span className="text-[11px] text-gray-400 ml-1.5 truncate">
                      — {preview}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        ) : (
          <p className="text-[12px] text-gray-400 text-center py-4">
            {search ? "No matching blocks" : "No blocks on this page"}
          </p>
        )}
      </div>
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
  triggerBlockId: string;
  acceptedTypes?: ("block" | "file" | "url" | "paste" | "rag")[];
  excludeOutputBlocks?: boolean;
}

type AddMode = null | "upload" | "url" | "blocks" | "paste";

const ACTION_TYPE_MAP: Record<string, string> = {
  upload: "file",
  blocks: "block",
  url: "url",
  paste: "paste",
};

const TAB_TYPE_MAP: Record<FilterTab, string[]> = {
  all: [],
  files: ["file"],
  notes: ["block", "paste"],
  web: ["url"],
};

export function SourcePickerPopover({
  sources,
  onSourcesChange,
  pageBlocks,
  onClose,
  workspaceId,
  triggerBlockId,
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
  const [addMode, setAddMode] = useState<AddMode>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (!addMode) searchRef.current?.focus();
  }, [addMode]);

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
    if (filterTab === "notes")
      filtered = sources.filter(
        (s) => s.sourceType === "block" || s.sourceType === "paste"
      );
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
      setAddMode(null);
    },
    [supabase, workspaceId, triggerBlockId, sources, onSourcesChange]
  );

  const handleAddUrl = useCallback(
    (raw: string) => {
      let url = raw.trim();
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;

      onSourcesChange([
        ...sources,
        {
          ref: { type: "url", url: parsed.href },
          label: parsed.hostname,
          sourceType: "url",
        },
      ]);
      setAddMode(null);
    },
    [sources, onSourcesChange]
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
      setAddMode(null);
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
            sourceType: "block",
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
            onClick={() => { setFilterTab(tab.id); setAddMode(null); }}
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
        {sources.length > 0 && (
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

        {sources.length === 0 && !addMode && (
          <div className="px-4 py-5 text-center">
            <p className="text-[12px] text-gray-400">
              No sources selected. Add files, URLs, or blocks below.
            </p>
          </div>
        )}
      </div>

      {/* Add source section */}
      <div className="border-t border-gray-100 px-4 pt-4 pb-4">
        {addMode === null ? (
          <>
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-3">
              Add Source
            </span>
            <div className="grid grid-cols-4 gap-2.5">
              {[
                { id: "upload" as const, icon: Upload, label: "Upload file", sub: "From device" },
                { id: "blocks" as const, icon: Type, label: "Choose blocks", sub: "From notebook" },
                { id: "url" as const, icon: Globe, label: "Add web page", sub: "Paste URL" },
                { id: "paste" as const, icon: ClipboardPaste, label: "Paste text", sub: "From clipboard" },
              ].filter((a) => !acceptedTypes || acceptedTypes.includes(ACTION_TYPE_MAP[a.id] as "block" | "file" | "url" | "paste"))
              .map((action) => (
                <button
                  key={action.id}
                  onClick={() => setAddMode(action.id)}
                  className="flex flex-col items-center gap-2 py-4 px-2 rounded-xl
                             border border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/30
                             transition-all cursor-pointer group"
                >
                  <div className="h-10 w-10 rounded-xl bg-gray-50 border border-gray-100
                                  group-hover:bg-blue-50 group-hover:border-blue-100
                                  flex items-center justify-center transition-colors">
                    <action.icon className="h-[18px] w-[18px] text-gray-400 group-hover:text-blue-500 transition-colors" />
                  </div>
                  <div className="text-center">
                    <span className="text-[11px] font-medium text-gray-700 block leading-snug">
                      {action.label}
                    </span>
                    <span className="text-[10px] text-gray-400 block leading-snug mt-0.5">
                      {action.sub}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                {addMode === "upload" && "Upload File"}
                {addMode === "url" && "Add Web Page"}
                {addMode === "blocks" && "Choose Blocks"}
                {addMode === "paste" && "Paste Text"}
              </span>
              <button
                onClick={() => setAddMode(null)}
                className="text-[12px] text-gray-400 hover:text-gray-600 cursor-pointer
                           transition-colors"
              >
                Back
              </button>
            </div>
            {addMode === "upload" && (
              <UploadView onUploadFile={handleUploadFile} />
            )}
            {addMode === "url" && <UrlView onAddUrl={handleAddUrl} />}
            {addMode === "paste" && (
              <PasteView onAddPaste={handleAddPaste} />
            )}
            {addMode === "blocks" && (
              <BlocksView
                pageBlocks={filteredPageBlocks}
                selectedBlockIds={selectedBlockIds}
                onToggleBlock={handleToggleBlock}
              />
            )}
          </div>
        )}
      </div>

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
