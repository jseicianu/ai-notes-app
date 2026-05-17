"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import {
  GripVertical,
  MoreHorizontal,
  Copy,
  Trash2,
  Pencil,
  Type,
  Sparkles,
  Table2,
  Braces,
  CheckSquare,
  FileText,
  Terminal,
  Info,
  List,
  AlertCircle,
  SlidersHorizontal,
  ChevronRight,
  Globe,
  Code2,
  ImageIcon,
  X,
  RotateCcw,
} from "lucide-react";
import type { DraggableAttributes } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BlockTypePicker } from "./block-type-picker";

function CellNotesHexagon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M256 64 L415 156 L415 340 L256 448 L97 356 L97 156 Z"
        fill="none"
        stroke="#005BFF"
        strokeWidth="40"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
    </svg>
  );
}

export function BlockTypeIcon({ blockType }: { blockType: string }) {
  switch (blockType) {
    case "ai_cell":
      return <CellNotesHexagon size={16} />;
    case "output":
      return <Sparkles className="h-4 w-4 text-blue-500" />;
    case "text":
    case "heading":
      return (
        <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-blue-50 border border-blue-200">
          <Type className="h-3 w-3 text-blue-600" />
        </span>
      );
    case "table":
      return <Table2 className="h-4 w-4 text-blue-500" />;
    case "json":
      return <Braces className="h-4 w-4 text-blue-500" />;
    case "todo":
      return <CheckSquare className="h-4 w-4 text-blue-500" />;
    case "file":
      return <FileText className="h-4 w-4 text-blue-500" />;
    case "command_ref":
      return <Terminal className="h-4 w-4 text-blue-500" />;
    case "callout":
      return <Info className="h-4 w-4 text-blue-500" />;
    case "bulleted_list":
    case "numbered_list":
      return <List className="h-4 w-4 text-blue-500" />;
    case "source_card":
      return <Globe className="h-4 w-4 text-blue-500" />;
    case "error":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case "code":
      return <Code2 className="h-4 w-4 text-blue-500" />;
    case "image":
      return <ImageIcon className="h-4 w-4 text-blue-500" />;
    case "input":
    case "input_group":
      return <SlidersHorizontal className="h-4 w-4 text-blue-500" />;
    default:
      return <Type className="h-4 w-4 text-blue-500" />;
  }
}

const INLINE_TYPES = new Set(["input", "file"]);
const CONTENT_TYPES = new Set(["text", "heading", "callout"]);

export function getBlockDisplayLabel(block: { type: string; content?: Record<string, unknown> }, typeLabel: string): string {
  const custom = block.content?.label as string | undefined;
  return custom ? `${typeLabel} · ${custom}` : typeLabel;
}

interface BlockWrapperProps {
  blockId: string;
  blockIndex: number;
  blockType: string;
  typeLabel: string;
  blockLabel?: string;
  blockVersion?: number;
  blockUpdatedAt?: string;
  onLabelChange?: (label: string) => void;
  children: React.ReactNode;
  onChangeType: (newType: string) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onBlockUpdate?: (content: Record<string, unknown>) => void;
  extraHeaderContent?: React.ReactNode;
}

export function BlockWrapper({
  blockId,
  blockIndex,
  blockType,
  typeLabel,
  blockLabel,
  blockVersion = 1,
  onLabelChange,
  children,
  onChangeType,
  onDelete,
  onDuplicate,
  onEdit,
  onBlockUpdate,
  extraHeaderContent,
}: BlockWrapperProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [viewingVersionData, setViewingVersionData] = useState<{ version: number; content: Record<string, unknown> } | null>(null);

  const handleRestore = useCallback(async (version: number) => {
    try {
      await fetch(`/api/blocks/${blockId}/versions/save`, { method: "POST" });
      const res = await fetch(`/api/blocks/${blockId}/versions/${version}`);
      if (!res.ok) return;
      const versionData = await res.json();
      if (versionData.content && onBlockUpdate) {
        onBlockUpdate(versionData.content as Record<string, unknown>);
      }
      setViewingVersionData(null);
    } catch { /* ignore */ }
  }, [blockId, onBlockUpdate]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: blockId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isSeparator = blockType === "separator";
  const isInline = INLINE_TYPES.has(blockType);
  const isContent = CONTENT_TYPES.has(blockType);

  if (isSeparator) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`transition-opacity duration-200 ${isDragging ? "opacity-50" : ""}`}
      >
        {children}
      </div>
    );
  }

  // Content blocks (text, heading, callout) — borderless, focus-only chrome
  if (isContent) {
    const forceOpen = showPicker || showMenu;

    return (
      <ContentBlockWrapper
        setNodeRef={setNodeRef}
        style={style}
        isDragging={isDragging}
        forceOpen={forceOpen}
        blockIndex={blockIndex}
        blockType={blockType}
        typeLabel={typeLabel}
        blockLabel={blockLabel}
        onLabelChange={onLabelChange}
        showPicker={showPicker}
        setShowPicker={setShowPicker}
        showMenu={showMenu}
        setShowMenu={setShowMenu}
        onChangeType={onChangeType}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onEdit={onEdit}
        attributes={attributes}
        listeners={listeners}
      >
        {children}
      </ContentBlockWrapper>
    );
  }

  // Inline blocks — compact single row with border
  if (isInline) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`group/block flex items-center min-h-[42px] px-3.5
                    border border-gray-200 rounded-lg bg-white
                    transition-opacity duration-200 ${isDragging ? "opacity-50 z-50" : ""}`}
      >
        <span className="text-[13px] text-gray-400 tabular-nums w-5 text-right shrink-0 mr-2">{blockIndex}</span>
        <ChevronRight className="h-3 w-3 text-gray-300 shrink-0 mr-2" />
        <div className="shrink-0 mr-1.5 flex items-center">
          <BlockTypeIcon blockType={blockType} />
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="text-[13px] font-semibold text-gray-800 hover:text-gray-900 cursor-pointer"
          >
            {typeLabel}
          </button>
          {showPicker && (
            <BlockTypePicker
              onSelect={(type) => { onChangeType(type); setShowPicker(false); }}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>
        {onLabelChange && (
          <InlineBlockLabel value={blockLabel || ""} onChange={onLabelChange} />
        )}
        <div className="flex-1 min-w-0 py-1.5 ml-3">{children}</div>
        <div className="shrink-0 flex items-center gap-0.5
                        transition-opacity">
          <ActionMenu showMenu={showMenu} setShowMenu={setShowMenu}
                      onDuplicate={onDuplicate} onDelete={onDelete} onEdit={onEdit} />
          <div
            className="h-6 w-6 flex items-center justify-center rounded
                       text-gray-400 hover:text-gray-600 hover:bg-gray-100
                       cursor-grab active:cursor-grabbing"
            {...attributes} {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </div>
        </div>
      </div>
    );
  }

  // Cell blocks — bordered card with header + resizable content
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/block transition-opacity duration-200 ${
        isDragging ? "opacity-50 z-50" : ""
      }`}
    >
      <div className="border border-gray-200 rounded-lg bg-white">
        {/* Header row */}
        <div className="flex items-center h-10 px-3.5 border-b border-gray-200">
          <span className="text-[13px] text-gray-400 tabular-nums w-5 text-right shrink-0 mr-2">{blockIndex}</span>
          <div className="shrink-0 mr-1.5 flex items-center">
            <BlockTypeIcon blockType={blockType} />
          </div>
          <div className="relative shrink-0">
            <button
              onClick={() => setShowPicker(!showPicker)}
              className="text-[13px] font-semibold text-gray-800 hover:text-gray-900 cursor-pointer"
            >
              {typeLabel}
            </button>
            {showPicker && (
              <BlockTypePicker
                onSelect={(type) => { onChangeType(type); setShowPicker(false); }}
                onClose={() => setShowPicker(false)}
              />
            )}
          </div>
          {onLabelChange && (
            <InlineBlockLabel value={blockLabel || ""} onChange={onLabelChange} />
          )}
          {extraHeaderContent && (
            <div className="ml-3 flex items-center">{extraHeaderContent}</div>
          )}
          <div className="flex-1" />
          {blockVersion > 1 && (
            <BlockVersionTabs
              blockId={blockId}
              blockVersion={blockVersion}
              viewingVersion={viewingVersionData?.version ?? null}
              onViewVersion={(version, content) => setViewingVersionData({ version, content })}
              onViewCurrent={() => setViewingVersionData(null)}
              onRestore={handleRestore}
            />
          )}
          <div className="shrink-0 flex items-center gap-0.5
                          transition-opacity">
            <ActionMenu showMenu={showMenu} setShowMenu={setShowMenu}
                        onDuplicate={onDuplicate} onDelete={onDelete} onEdit={onEdit} />
            <div
              className="h-6 w-6 flex items-center justify-center rounded
                         text-gray-400 hover:text-gray-600 hover:bg-gray-100
                         cursor-grab active:cursor-grabbing"
              {...attributes} {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Content area with resize handle */}
        {viewingVersionData ? (
          <div className="relative">
            <div className="px-4 py-4 bg-amber-50/30">
              <div className="flex items-center gap-2.5 mb-2">
                <span className="text-[12px] font-mono font-semibold text-gray-500">
                  v{viewingVersionData.version}
                </span>
                <span className="text-[12px] text-gray-600 font-medium">
                  {summarizeContent(blockType, viewingVersionData.content)}
                </span>
              </div>
              <p className="text-[12px] text-gray-400">
                Viewing a previous version. Click Restore in the version history to make this the current version.
              </p>
            </div>
            <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 bg-gray-50/50">
              <button
                onClick={() => setViewingVersionData(null)}
                className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-700
                           font-medium transition-colors cursor-pointer"
              >
                <X className="h-3 w-3" />
                Back to current
              </button>
              <button
                onClick={() => handleRestore(viewingVersionData.version)}
                className="flex items-center gap-1.5 text-[11px] text-blue-600 hover:text-blue-700
                           font-medium transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                Restore this version
              </button>
            </div>
          </div>
        ) : (
          <ResizableContent>
            {children}
          </ResizableContent>
        )}
      </div>
    </div>
  );
}

// ── Content block wrapper (focus-reveal header) ──

function ContentBlockWrapper({
  setNodeRef,
  style,
  isDragging,
  forceOpen,
  blockIndex,
  blockType,
  typeLabel,
  blockLabel,
  onLabelChange,
  showPicker,
  setShowPicker,
  showMenu,
  setShowMenu,
  onChangeType,
  onDuplicate,
  onDelete,
  onEdit,
  attributes,
  listeners,
  children,
}: {
  setNodeRef: (node: HTMLElement | null) => void;
  style: React.CSSProperties;
  isDragging: boolean;
  forceOpen: boolean;
  blockIndex: number;
  blockType: string;
  typeLabel: string;
  blockLabel?: string;
  onLabelChange?: (label: string) => void;
  showPicker: boolean;
  setShowPicker: (v: boolean) => void;
  showMenu: boolean;
  setShowMenu: (v: boolean) => void;
  onChangeType: (newType: string) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  attributes: DraggableAttributes;
  listeners: Record<string, unknown> | undefined;
  children: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const revealed = focused || forceOpen;

  const handleFocusCapture = () => {
    if (blurTimeout.current) {
      clearTimeout(blurTimeout.current);
      blurTimeout.current = null;
    }
    setFocused(true);
  };

  const handleBlurCapture = () => {
    blurTimeout.current = setTimeout(() => {
      if (wrapperRef.current && !wrapperRef.current.contains(document.activeElement)) {
        setFocused(false);
      }
    }, 0);
  };

  return (
    <div
      ref={(node) => { setNodeRef(node); (wrapperRef as React.MutableRefObject<HTMLDivElement | null>).current = node; }}
      style={style}
      className={`group/block relative transition-all duration-200
                  ${isDragging ? "opacity-50 z-50" : ""}`}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      <div className={`rounded-lg border transition-colors duration-200
                      ${revealed ? "border-gray-200" : "border-transparent"}`}>
        <div className={`flex items-center transition-all duration-200
                        px-3.5 border-b
                        ${revealed
                          ? "h-9 opacity-100 pointer-events-auto border-gray-200"
                          : "h-0 opacity-0 pointer-events-none border-transparent"
                        }`}>
          <span className="text-[13px] text-gray-400 tabular-nums w-5 text-right shrink-0 mr-2">
            {blockIndex}
          </span>
          <div className="shrink-0 mr-1.5 flex items-center">
            <BlockTypeIcon blockType={blockType} />
          </div>
          <div className="relative shrink-0">
            <button
              onClick={() => setShowPicker(!showPicker)}
              className="text-[13px] font-semibold text-gray-800 hover:text-gray-900 cursor-pointer"
            >
              {typeLabel}
            </button>
            {showPicker && (
              <BlockTypePicker
                onSelect={(type) => { onChangeType(type); setShowPicker(false); }}
                onClose={() => setShowPicker(false)}
              />
            )}
          </div>
          {onLabelChange && (
            <InlineBlockLabel value={blockLabel || ""} onChange={onLabelChange} />
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-0.5">
            <ActionMenu showMenu={showMenu} setShowMenu={setShowMenu}
                        onDuplicate={onDuplicate} onDelete={onDelete} onEdit={onEdit} />
            <div
              className="h-6 w-6 flex items-center justify-center rounded
                         text-gray-400 hover:text-gray-600 hover:bg-gray-100
                         cursor-grab active:cursor-grabbing"
              {...attributes} {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </div>
          </div>
        </div>

        <div>
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Resize handle ──

const MIN_HEIGHT = 48;

function ResizableContent({ children }: { children: React.ReactNode }) {
  const [height, setHeight] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const outerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = e.clientY - resizeRef.current.startY;
      setHeight(Math.max(MIN_HEIGHT, resizeRef.current.startHeight + delta));
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!height || !outerRef.current) return;
    const runningChild = outerRef.current.querySelector("[data-running]");
    if (runningChild) setHeight(null);
  }, [height]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const currentHeight = outerRef.current?.offsetHeight ?? 200;
    resizeRef.current = { startY: e.clientY, startHeight: height ?? currentHeight };
    setIsResizing(true);
  };

  return (
    <div className={`relative ${isResizing ? "select-none" : ""}`}>
      <div
        ref={outerRef}
        className={`rounded-b-lg
                   ${height ? "flex flex-col [&>*]:flex-1 [&>*]:min-h-0 [&>*]:flex [&>*]:flex-col overflow-auto" : ""}`}
        style={height ? { height } : undefined}
      >
        {children}
      </div>

      {/* Resize handle — pill at bottom center */}
      <div
        onMouseDown={handleResizeStart}
        onDoubleClick={() => setHeight(null)}
        className={`flex items-center justify-center cursor-row-resize
                   h-[10px] -mt-[5px] relative z-10
                   ${isResizing ? "opacity-100" : "opacity-0 group-hover/block:opacity-100"}
                   transition-opacity duration-150`}
      >
        <div
          className={`rounded-full transition-all duration-100
                     ${isResizing
                       ? "w-16 h-[3px] bg-blue-500"
                       : "w-10 h-[3px] bg-gray-300 hover:bg-blue-500 hover:w-16"}`}
        />
      </div>
    </div>
  );
}

// ── Inline block label (editable name) ──

function InlineBlockLabel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value) onChange(trimmed);
  };

  if (editing) {
    return (
      <>
        <span className="text-gray-300 mx-1.5 select-none">|</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(value); setEditing(false); }
          }}
          className="text-[13px] text-gray-500 bg-transparent outline-none
                     border-b border-dashed border-gray-300 focus:border-blue-400
                     min-w-[40px] max-w-[200px] py-0"
          placeholder="Name..."
          style={{ width: `${Math.max(3, draft.length + 1)}ch` }}
        />
      </>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center text-[13px] text-gray-400 hover:text-gray-600
                 transition-colors cursor-text ml-1.5 shrink-0"
    >
      {value ? (
        <>
          <span className="text-gray-300 mr-1.5 select-none">|</span>
          <span>{value}</span>
        </>
      ) : (
        <>
          <span className="text-gray-300 mr-1.5 select-none">|</span>
          <span className="italic text-gray-300">Name</span>
        </>
      )}
    </button>
  );
}

// ── Action menu ──

function ActionMenu({
  showMenu,
  setShowMenu,
  onDuplicate,
  onDelete,
  onEdit,
}: {
  showMenu: boolean;
  setShowMenu: (v: boolean) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
        className="h-6 w-6 flex items-center justify-center rounded
                   text-gray-400 hover:text-gray-600 hover:bg-gray-100
                   transition-colors cursor-pointer"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {showMenu && (
        <div
          className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200
                     rounded-lg shadow-lg z-50 py-1 animate-in fade-in slide-in-from-top-1 duration-100"
          onMouseLeave={() => setShowMenu(false)}
        >
          {onEdit && (
            <button
              onClick={() => { onEdit(); setShowMenu(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px]
                         text-gray-600 hover:bg-gray-50 hover:text-gray-900
                         cursor-pointer transition-colors"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          )}
          {onDuplicate && (
            <button
              onClick={() => { onDuplicate(); setShowMenu(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px]
                         text-gray-600 hover:bg-gray-50 hover:text-gray-900
                         cursor-pointer transition-colors"
            >
              <Copy className="h-3 w-3" />
              Duplicate
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => { onDelete(); setShowMenu(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px]
                         text-red-500 hover:bg-red-50 hover:text-red-600
                         cursor-pointer transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Block Version Tabs + History Popover ──

interface VersionListItem {
  version: number;
  type: string;
  created_at: string;
  summary?: string;
}

function summarizeContent(type: string, content: Record<string, unknown>): string {
  switch (type) {
    case "table": {
      const cols = Array.isArray(content.columns) ? content.columns.length : 0;
      const rows = Array.isArray(content.rows) ? content.rows.length : 0;
      return `Table · ${cols} columns · ${rows} rows`;
    }
    case "output": {
      const data = typeof content.data === "string" ? content.data : "";
      const chars = data.length;
      return `Text · ${chars} chars`;
    }
    case "json": {
      const data = content.data;
      const keys = data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).length : 0;
      return `JSON · ${keys} keys`;
    }
    case "todo": {
      const items = Array.isArray(content.items) ? content.items : [];
      const done = items.filter((i: Record<string, unknown>) => i.done).length;
      return `Todo · ${items.length} items · ${done} done`;
    }
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function BlockVersionTabs({
  blockId,
  blockVersion,
  viewingVersion,
  onViewVersion,
  onViewCurrent,
  onRestore,
}: {
  blockId: string;
  blockVersion: number;
  viewingVersion: number | null;
  onViewVersion: (version: number, content: Record<string, unknown>) => void;
  onViewCurrent: () => void;
  onRestore: (version: number) => void;
}) {
  const [showPopover, setShowPopover] = useState(false);
  const [versions, setVersions] = useState<VersionListItem[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const allVersionNumbers = Array.from({ length: blockVersion - 1 }, (_, i) => i + 1);
  const MAX_INLINE_TABS = 2;
  const inlineTabs = allVersionNumbers.length > MAX_INLINE_TABS
    ? allVersionNumbers.slice(-MAX_INLINE_TABS)
    : allVersionNumbers;
  const hasHiddenVersions = allVersionNumbers.length > MAX_INLINE_TABS;

  useLayoutEffect(() => {
    if (!showPopover || !triggerRef.current) {
      setPopoverStyle(null);
      return;
    }
    const update = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const width = 360;
      const height = 300;
      const gap = 6;
      const margin = 8;
      const top = Math.min(rect.bottom + gap, window.innerHeight - margin - height);
      const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - margin - width));
      setPopoverStyle({ position: "fixed" as const, top, left, width, zIndex: 1000 });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [showPopover]);

  useEffect(() => {
    if (!showPopover) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setShowPopover(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showPopover]);

  const fetchVersions = useCallback(async () => {
    if (versions.length > 0 || loadingVersions) return;
    setLoadingVersions(true);
    try {
      const res = await fetch(`/api/blocks/${blockId}/versions`);
      if (res.ok) {
        const result = await res.json();
        setVersions(result.versions || []);
      }
    } finally {
      setLoadingVersions(false);
    }
  }, [blockId, versions.length, loadingVersions]);

  const loadVersion = useCallback(async (version: number) => {
    try {
      const res = await fetch(`/api/blocks/${blockId}/versions/${version}`);
      if (res.ok) {
        const data = await res.json();
        onViewVersion(version, (data as { content: Record<string, unknown> }).content);
      }
    } catch { /* ignore */ }
  }, [blockId, onViewVersion]);

  return (
    <>
      <div className="flex items-center mr-2">
        {/* Version tab group — shared border container */}
        <div className="flex items-center h-7 border border-gray-200 rounded-lg overflow-hidden">
          {hasHiddenVersions && (
            <button
              ref={triggerRef}
              onClick={() => { if (!showPopover) fetchVersions(); setShowPopover(!showPopover); }}
              className="h-full px-2 text-[11px] text-gray-400 hover:text-gray-600
                         hover:bg-gray-50 border-r border-gray-200 transition-colors cursor-pointer"
            >
              ···
            </button>
          )}
          {inlineTabs.map((v) => (
            <button
              key={v}
              onClick={() => loadVersion(v)}
              className={`h-full px-2.5 text-[11px] font-mono font-medium border-r border-gray-200
                         transition-all cursor-pointer
                         ${viewingVersion === v
                           ? "bg-gray-100 text-gray-800"
                           : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"}`}
            >
              v{v}
            </button>
          ))}
          <button
            ref={hasHiddenVersions ? undefined : triggerRef}
            onClick={onViewCurrent}
            className={`h-full px-3 text-[11px] font-medium transition-all cursor-pointer
                       ${viewingVersion === null
                         ? "bg-blue-500 text-white"
                         : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"}`}
          >
            Current
          </button>
        </div>

      </div>

      {/* Version history popover */}
      {showPopover && popoverStyle && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          style={popoverStyle}
          className="bg-white border border-gray-200 rounded-xl shadow-lg
                     animate-in fade-in duration-75"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-[14px] font-semibold text-gray-900">Version history</span>
            <button
              onClick={() => setShowPopover(false)}
              className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-gray-100
                         transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5 text-gray-400" />
            </button>
          </div>

          {loadingVersions ? (
            <div className="px-4 py-6 text-[13px] text-gray-400 text-center">Loading...</div>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
              {/* Current version */}
              <button
                onClick={() => { onViewCurrent(); setShowPopover(false); }}
                className={`flex w-full items-start gap-3 px-4 py-3 transition-colors cursor-pointer
                           ${viewingVersion === null ? "bg-blue-50/50" : "hover:bg-gray-50"}`}
              >
                <span className="text-[15px] font-mono font-bold text-blue-600 mt-0.5 shrink-0">v{blockVersion}</span>
                <div className="flex-1 min-w-0 text-left">
                  <span className="text-[12px] text-gray-500">Latest version</span>
                </div>
                <span className="text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-200
                                 px-2 py-0.5 rounded-md shrink-0">Current</span>
              </button>

              {/* Previous versions — newest first */}
              {[...versions].reverse().map((v) => (
                <div
                  key={v.version}
                  className={`flex w-full items-start gap-3 px-4 py-3 transition-colors
                             ${viewingVersion === v.version ? "bg-gray-50" : "hover:bg-gray-50"}`}
                >
                  <button
                    onClick={() => { loadVersion(v.version); setShowPopover(false); }}
                    className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer text-left"
                  >
                    <span className="text-[15px] font-mono font-bold text-gray-400 mt-0.5 shrink-0">v{v.version}</span>
                    <div className="flex flex-col min-w-0 gap-0.5">
                      <span className="text-[12px] text-gray-700 font-medium truncate">
                        {v.summary || v.type}
                      </span>
                      <span className="text-[11px] text-gray-400">{formatRelativeTime(v.created_at)}</span>
                    </div>
                  </button>
                  <button
                    onClick={() => { onRestore(v.version); setShowPopover(false); }}
                    className="flex items-center gap-1.5 h-6 px-2.5 text-[11px] text-blue-600
                               font-medium border border-blue-200 rounded-md bg-white
                               hover:bg-blue-50 transition-colors cursor-pointer shrink-0 mt-0.5"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
