"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { Block } from "@/lib/models/types";

function tocBaseLabel(type: string, content?: Record<string, unknown>): string {
  switch (type) {
    case "text": return "Text";
    case "ai_cell": return "AI Cell";
    case "command_ref": return (content?.command_name as string) || "Command";
    case "table": return "Table";
    case "json": return "JSON";
    case "todo": return "To-do";
    case "output": return "Output";
    case "error": return "Error";
    case "file": return (content?.filename as string) || "File";
    case "callout": return "Callout";
    case "input": {
      const t = (content?.input_type as string) || "text";
      const labels: Record<string, string> = { select: "Dropdown", checkbox: "Checkbox", slider: "Slider", number: "Number", date: "Date" };
      return labels[t] || "Text Input";
    }
    case "input_group": return "Controls";
    case "bulleted_list": return "List";
    case "numbered_list": return "Numbered List";
    default: return type;
  }
}

function tocTypeLabel(block: Block): string {
  const base = tocBaseLabel(block.type, block.content);
  const custom = block.content?.label as string | undefined;
  return custom ? `${base} · ${custom}` : base;
}

interface PageMinimapProps {
  blocks: Block[];
  onScrollToBlock?: (blockId: string) => void;
}

function blockWeight(block: Block): number {
  switch (block.type) {
    case "heading": return 2;
    case "text": {
      const doc = (block.content?.doc as string) || "";
      const textLen = doc.replace(/<[^>]*>/g, "").length;
      return Math.max(1, Math.min(4, Math.ceil(textLen / 80)));
    }
    case "ai_cell": return 3;
    case "command_ref": return 3;
    case "table": return 4;
    case "json": return 3;
    case "todo": {
      const items = (block.content?.items as unknown[]) || [];
      return Math.max(2, Math.min(5, items.length));
    }
    case "output": return 2;
    case "separator": return 0.5;
    default: return 1.5;
  }
}

export function PageMinimap({ blocks, onScrollToBlock }: PageMinimapProps) {
  const [showToc, setShowToc] = useState(false);
  const tocRef = useRef<HTMLDivElement>(null);

  const weights = useMemo(() => blocks.map(blockWeight), [blocks]);

  const tocSections = useMemo(() => {
    const sections: Array<{
      headingId: string | null;
      heading: string | null;
      children: Array<{ id: string; label: string }>;
    }> = [];

    let current: (typeof sections)[number] | null = null;

    for (const block of blocks) {
      if (block.type === "heading") {
        const text = (block.content?.doc as string)?.replace(/<[^>]*>/g, "").trim()
          || (block.content?.text as string)?.trim() || "Untitled";
        current = { headingId: block.id, heading: text, children: [] };
        sections.push(current);
      } else if (block.type !== "separator") {
        const label = tocTypeLabel(block);
        if (!current) {
          current = { headingId: null, heading: null, children: [] };
          sections.push(current);
        }
        current.children.push({ id: block.id, label });
      }
    }

    return sections;
  }, [blocks]);

  // Click outside to close TOC
  useEffect(() => {
    if (!showToc) return;
    function handleClick(e: MouseEvent) {
      if (tocRef.current && !tocRef.current.contains(e.target as Node)) {
        setShowToc(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showToc]);

  const handleBlockClick = useCallback(
    (blockId: string) => {
      onScrollToBlock?.(blockId);
      setShowToc(false);
    },
    [onScrollToBlock]
  );

  if (blocks.length === 0) return null;

  return (
    <div className="relative">
      {/* Minimap lines */}
      <div
        className="flex flex-col items-end gap-[4px] cursor-pointer
                   transition-all duration-150"
        onClick={() => setShowToc(!showToc)}
        title="Table of Contents"
      >
        {blocks.map((block, i) => {
          if (block.type === "separator") return null;
          const w = Math.max(8, Math.min(28, weights[i] * 6));
          return (
            <div
              key={block.id}
              className="h-[3px] bg-gray-300 rounded-full transition-all duration-150
                         hover:bg-gray-400"
              style={{ width: w }}
            />
          );
        })}
      </div>

      {/* TOC dropdown */}
      {showToc && (
        <div
          ref={tocRef}
          className="absolute right-0 top-0 z-[80] w-52 bg-white border border-gray-200
                     shadow-lg animate-in fade-in zoom-in-95 duration-150 origin-top-right
                     border-t-2 border-t-gray-800"
        >
          <div className="max-h-[60vh] overflow-y-auto py-1">
            {tocSections.map((section, si) => (
              <div key={section.headingId || `top-${si}`}>
                {/* Heading */}
                {section.heading && (
                  <button
                    onClick={() => handleBlockClick(section.headingId!)}
                    className="flex items-center w-full px-4 py-1.5 text-left
                               hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <span className="text-[14px] font-semibold text-gray-900 truncate">
                      {section.heading}
                    </span>
                  </button>
                )}

                {/* Child blocks — type labels */}
                {section.children.map((child) => (
                  <button
                    key={child.id}
                    onClick={() => handleBlockClick(child.id)}
                    className="flex items-center w-full pl-6 pr-4 py-1 text-left
                               text-[12px] text-gray-400 hover:text-gray-600
                               hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    {child.label}
                  </button>
                ))}

                {/* Divider between sections */}
                {si < tocSections.length - 1 && (
                  <div className="mx-4 my-1.5 border-t border-gray-100" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
