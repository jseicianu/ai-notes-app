"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { CornerDownRight, X } from "lucide-react";
import { BlockTypeIcon } from "./block-wrapper";
import type { Block } from "@/lib/models/types";

const EXCLUDED_TYPES = new Set([
  "command_ref",
  "output",
  "error",
  "separator",
  "input_group",
  "input",
]);

function getBaseTypeLabel(type: string): string {
  switch (type) {
    case "text": return "Text";
    case "heading": return "Heading";
    case "ai_cell": return "AI Cell";
    case "todo": return "To-do";
    case "table": return "Table";
    case "json": return "JSON";
    case "file": return "File";
    case "callout": return "Callout";
    case "bulleted_list": return "List";
    case "numbered_list": return "Num List";
    case "source_card": return "Source";
    default: return type;
  }
}

function getTypeLabel(block: Block): string {
  const base = getBaseTypeLabel(block.type);
  const custom = block.content?.label as string | undefined;
  return custom ? `${base} · ${custom}` : base;
}

function getContentPreview(block: Block, maxLen = 50): string {
  const c = block.content;
  if (!c) return "";

  switch (block.type) {
    case "text":
    case "heading":
    case "callout": {
      const doc = c.doc as string | undefined;
      const plain = doc ? doc.replace(/<[^>]*>/g, "").trim() : (c.text as string) || "";
      return plain.slice(0, maxLen) || "";
    }
    case "ai_cell":
      return ((c.prompt as string) || "").slice(0, maxLen);
    case "table": {
      const cols = c.columns as string[] | undefined;
      const rows = c.rows as unknown[] | undefined;
      return cols ? `${cols.join(", ")} · ${rows?.length ?? 0} rows` : "Table";
    }
    case "json":
      return JSON.stringify(c.data).slice(0, maxLen);
    case "todo": {
      const items = c.items as Array<{ text: string }> | undefined;
      return items ? items.map((i) => i.text).join(", ").slice(0, maxLen) : "";
    }
    case "file":
      return (c.filename as string) || "File";
    case "bulleted_list":
    case "numbered_list": {
      const items = c.items as Array<{ text: string }> | undefined;
      return items ? items.map((i) => i.text).join(", ").slice(0, maxLen) : "";
    }
    case "source_card":
      return (c.title as string) || (c.url as string) || "Source";
    default:
      return "";
  }
}

/* ─── Rich preview card content ─── */

function BlockPreviewContent({ block }: { block: Block }) {
  const c = block.content;
  if (!c) return null;

  switch (block.type) {
    case "text":
    case "heading":
    case "callout": {
      const doc = c.doc as string | undefined;
      const plain = doc ? doc.replace(/<[^>]*>/g, "").trim() : (c.text as string) || "";
      return (
        <p className="text-[12px] text-gray-700 leading-relaxed line-clamp-6 whitespace-pre-wrap">
          {plain || "Empty block"}
        </p>
      );
    }
    case "ai_cell":
      return (
        <pre className="text-[11px] text-gray-600 leading-relaxed line-clamp-4 whitespace-pre-wrap font-mono bg-gray-50 rounded px-2 py-1.5">
          {(c.prompt as string) || "Empty prompt"}
        </pre>
      );
    case "table": {
      const cols = (c.columns as string[]) || [];
      const rows = (c.rows as Record<string, string>[]) || [];
      const displayRows = rows.slice(0, 4);
      return (
        <div className="overflow-hidden rounded border border-gray-100">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gray-50">
                {cols.map((col) => (
                  <th key={col} className="px-2 py-1 text-left font-medium text-gray-500 border-b border-gray-100">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, ri) => (
                <tr key={ri} className="border-b border-gray-50 last:border-0">
                  {cols.map((col) => (
                    <td key={col} className="px-2 py-1 text-gray-600 truncate max-w-[120px]">
                      {row[col] || ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 4 && (
            <div className="px-2 py-1 text-[10px] text-gray-400 bg-gray-50 border-t border-gray-100">
              +{rows.length - 4} more rows
            </div>
          )}
        </div>
      );
    }
    case "json": {
      const str = JSON.stringify(c.data, null, 2);
      const lines = str.split("\n").slice(0, 8);
      return (
        <pre className="text-[11px] text-gray-600 leading-relaxed font-mono bg-gray-50 rounded px-2 py-1.5 overflow-hidden">
          {lines.join("\n")}
          {str.split("\n").length > 8 && "\n..."}
        </pre>
      );
    }
    case "todo": {
      const items = (c.items as Array<{ text: string; done: boolean }>) || [];
      return (
        <div className="space-y-1">
          {items.slice(0, 5).map((item, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className={`h-3 w-3 rounded border shrink-0 flex items-center justify-center
                             ${item.done ? "bg-blue-500 border-blue-500" : "border-gray-300"}`}>
                {item.done && (
                  <svg className="h-2 w-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className={`text-[11px] ${item.done ? "text-gray-400 line-through" : "text-gray-600"}`}>
                {item.text || "Empty item"}
              </span>
            </div>
          ))}
          {items.length > 5 && (
            <span className="text-[10px] text-gray-400">+{items.length - 5} more</span>
          )}
        </div>
      );
    }
    case "file":
      return (
        <div className="flex items-center gap-2 text-[12px] text-gray-600">
          <BlockTypeIcon blockType="file" />
          <span>{(c.filename as string) || "Unknown file"}</span>
        </div>
      );
    case "bulleted_list":
    case "numbered_list": {
      const items = (c.items as Array<{ text: string }>) || [];
      const isNumbered = block.type === "numbered_list";
      return (
        <div className="space-y-0.5">
          {items.slice(0, 5).map((item, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-gray-600">
              <span className="text-gray-400 shrink-0">{isNumbered ? `${i + 1}.` : "•"}</span>
              <span>{item.text || "Empty"}</span>
            </div>
          ))}
          {items.length > 5 && (
            <span className="text-[10px] text-gray-400">+{items.length - 5} more</span>
          )}
        </div>
      );
    }
    case "source_card":
      return (
        <div className="space-y-1">
          <p className="text-[12px] font-medium text-gray-700">{(c.title as string) || "Source"}</p>
          {c.url ? <p className="text-[10px] text-blue-500 truncate">{c.url as string}</p> : null}
          {c.summary ? <p className="text-[11px] text-gray-500 line-clamp-3">{c.summary as string}</p> : null}
        </div>
      );
    default:
      return <p className="text-[11px] text-gray-400 italic">No preview available</p>;
  }
}

/* ─── Main component ─── */

interface BlockReferencePickerProps {
  value: string | null;
  onChange: (blockId: string) => void;
  onClear?: () => void;
  blocks: Block[];
  excludeBlockIds?: string[];
}

export function BlockReferencePicker({
  value,
  onChange,
  onClear,
  blocks,
  excludeBlockIds = [],
}: BlockReferencePickerProps) {
  const [open, setOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (open) return;
    hoverTimerRef.current = setTimeout(() => setShowPreview(true), 300);
  }, [open]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setShowPreview(false);
  }, []);

  const excludeSet = useMemo(
    () => new Set(excludeBlockIds),
    [excludeBlockIds]
  );

  const pickableBlocks = useMemo(
    () => blocks.filter((b) => !EXCLUDED_TYPES.has(b.type) && !excludeSet.has(b.id)),
    [blocks, excludeSet]
  );

  const selectedBlock = useMemo(
    () => (value ? blocks.find((b) => b.id === value) : null),
    [value, blocks]
  );

  const blockNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    let num = 1;
    for (const b of blocks) {
      if (b.type !== "output" && b.type !== "error") {
        map.set(b.id, num);
        num++;
      }
    }
    return map;
  }, [blocks]);

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Trigger — compact chip: just icon + type label */}
      <button
        onClick={() => { setShowPreview(false); setOpen(!open); }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`inline-flex items-center gap-1.5 h-9 rounded-md border transition-all cursor-pointer
                   ${selectedBlock
                     ? "pl-2 pr-2.5 border-blue-200 bg-blue-50/50 hover:border-blue-300"
                     : "px-3 border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50"
                   }
                   ${open ? "ring-1 ring-blue-400/30 border-blue-400" : ""}`}
      >
        {selectedBlock ? (
          <>
            <BlockTypeIcon blockType={selectedBlock.type} />
            <span className="text-[12px] font-medium text-blue-700">
              {getTypeLabel(selectedBlock)}
            </span>
            {onClear && (
              <span
                onClick={(e) => { e.stopPropagation(); onClear(); }}
                className="h-4 w-4 flex items-center justify-center rounded-full
                           text-blue-400 hover:text-blue-600 hover:bg-blue-100
                           transition-colors ml-0.5"
              >
                <X className="h-2.5 w-2.5" />
              </span>
            )}
          </>
        ) : (
          <>
            <CornerDownRight className="h-3 w-3 text-gray-400" />
            <span className="text-[12px] text-gray-400">Select source...</span>
          </>
        )}
      </button>

      {/* Hover preview card — appears with delay, smooth transition */}
      {showPreview && selectedBlock && !open && (
        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="absolute left-0 top-full mt-2 w-80 bg-white border border-gray-200
                     rounded-lg shadow-xl z-50 overflow-hidden
                     animate-in fade-in zoom-in-95 duration-200"
        >
          {/* Preview header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50/50">
            <BlockTypeIcon blockType={selectedBlock.type} />
            <span className="text-[12px] font-medium text-gray-700">
              {getTypeLabel(selectedBlock)}
            </span>
            <span className="text-[10px] text-gray-400 ml-auto">Preview</span>
          </div>
          {/* Preview content */}
          <div className="px-3 py-2.5 max-h-48 overflow-y-auto">
            <BlockPreviewContent block={selectedBlock} />
          </div>
        </div>
      )}

      {/* Dropdown picker */}
      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-80 bg-white border border-gray-200
                     rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto
                     animate-in fade-in slide-in-from-top-1 duration-100"
        >
          {pickableBlocks.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-gray-400 text-center">
              No blocks to reference
            </div>
          ) : (
            <div className="py-1">
              {pickableBlocks.map((b) => {
                const isSelected = b.id === value;
                const preview = getContentPreview(b, 60);
                const blockNum = blockNumberMap.get(b.id);
                return (
                  <button
                    key={b.id}
                    onClick={() => { onChange(b.id); setOpen(false); }}
                    className={`flex items-start gap-2 w-full px-2.5 py-2 text-left
                               transition-colors cursor-pointer
                               ${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}`}
                  >
                    <span className="text-[10px] text-gray-300 w-3 text-right shrink-0 font-mono mt-0.5">
                      {blockNum ?? "·"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <BlockTypeIcon blockType={b.type} />
                        <span className={`text-[12px] font-medium
                                        ${isSelected ? "text-blue-600" : "text-gray-700"}`}>
                          {getTypeLabel(b)}
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
          )}
        </div>
      )}
    </div>
  );
}
