"use client";

import { useState, useCallback } from "react";
import { Copy, Check, ChevronDown, ChevronRight } from "lucide-react";
import { DuotoneIcon } from "@/components/ui/duotone-icon";
import type { Block } from "@/lib/models/types";

interface OutputBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
}

export function OutputBlock({ block }: OutputBlockProps) {
  const format = (block.content?.format as string) || "text";
  const data = block.content?.data;
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const isEmpty = !textContent || textContent.trim() === "";

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [textContent]);

  if (isEmpty) {
    return (
      <div className="px-4 py-3 text-[13px] text-gray-400 italic">
        No output
      </div>
    );
  }

  return (
    <div className="relative group/output">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600
                     transition-colors cursor-pointer"
        >
          {collapsed
            ? <ChevronRight className="h-3 w-3" />
            : <ChevronDown className="h-3 w-3" />}
          <span className="font-medium uppercase tracking-wider">
            {format === "text" ? "Output" : format}
          </span>
        </button>

        <button
          onClick={handleCopy}
          className="h-6 w-6 flex items-center justify-center rounded
                     hover:bg-gray-50 transition-colors cursor-pointer"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <DuotoneIcon icon={Copy} size={13} />
          )}
        </button>
      </div>

      {/* Content */}
      {!collapsed && (
        <div className="px-4 py-3 text-[13px] text-gray-700 font-mono leading-relaxed
                        whitespace-pre-wrap break-words select-text overflow-x-auto">
          {textContent}
        </div>
      )}
    </div>
  );
}
