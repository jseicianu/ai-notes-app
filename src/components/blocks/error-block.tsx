"use client";

import { useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { DuotoneIcon } from "@/components/ui/duotone-icon";
import type { Block } from "@/lib/models/types";

interface ErrorBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
}

export function ErrorBlock({ block }: ErrorBlockProps) {
  const message = (block.content?.message as string) || "An unknown error occurred";
  const code = block.content?.code as string | undefined;
  const details = block.content?.details;
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasDetails = details !== undefined && details !== null;
  const detailsText = typeof details === "string" ? details : JSON.stringify(details, null, 2);

  const handleCopy = () => {
    const full = [
      code ? `[${code}] ${message}` : message,
      hasDetails ? `\n${detailsText}` : "",
    ].join("");
    navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border-l-[3px] border-cell-error">
      {/* Error header */}
      <div className="flex items-start gap-2.5 px-4 py-3 bg-cell-error-light/50">
        <AlertCircle className="h-4 w-4 text-cell-error shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {code && (
                <span className="text-[10px] font-mono font-semibold text-cell-error/70
                               uppercase tracking-wider mr-2">
                  {code}
                </span>
              )}
              <span className="text-[13px] text-gray-800 leading-snug">
                {message}
              </span>
            </div>
            <button
              onClick={handleCopy}
              className="h-6 w-6 flex items-center justify-center rounded shrink-0
                         hover:bg-cell-error-light transition-colors cursor-pointer"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <DuotoneIcon icon={Copy} size={13} fillClass="text-cell-error/20" strokeClass="text-cell-error/60" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Details (expandable) */}
      {hasDetails && (
        <div className="border-t border-cell-error/10">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1 px-4 py-1.5 text-[11px] text-gray-500
                       hover:text-gray-700 transition-colors cursor-pointer w-full"
          >
            {showDetails
              ? <ChevronDown className="h-3 w-3" />
              : <ChevronRight className="h-3 w-3" />}
            <span>Details</span>
          </button>
          {showDetails && (
            <div className="px-4 pb-3 text-[12px] font-mono text-gray-600 leading-relaxed
                            whitespace-pre-wrap break-words select-text overflow-x-auto
                            max-h-48 overflow-y-auto">
              {detailsText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
