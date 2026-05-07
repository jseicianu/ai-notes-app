"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Copy, Check, ChevronDown, ChevronRight, History } from "lucide-react";
import { DuotoneIcon } from "@/components/ui/duotone-icon";
import type { Block, BlockVersion } from "@/lib/models/types";

interface OutputBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
}

interface VersionListItem {
  version: number;
  type: string;
  created_at: string;
}

export function OutputBlock({ block }: OutputBlockProps) {
  const format = (block.content?.format as string) || "text";
  const data = block.content?.data;
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<VersionListItem[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<BlockVersion | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const isEmpty = !textContent || textContent.trim() === "";
  const hasVersionHistory = block.version > 1;

  useEffect(() => {
    if (!showVersions) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowVersions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showVersions]);

  const fetchVersions = useCallback(async () => {
    if (versions.length > 0) {
      setShowVersions(!showVersions);
      return;
    }
    setLoadingVersions(true);
    try {
      const res = await fetch(`/api/blocks/${block.id}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions || []);
      }
    } finally {
      setLoadingVersions(false);
      setShowVersions(true);
    }
  }, [block.id, versions.length, showVersions]);

  const loadVersion = useCallback(async (version: number) => {
    try {
      const res = await fetch(`/api/blocks/${block.id}/versions/${version}`);
      if (res.ok) {
        const data = await res.json();
        setViewingVersion(data as BlockVersion);
      }
    } catch { /* ignore */ }
  }, [block.id]);

  const clearViewingVersion = useCallback(() => {
    setViewingVersion(null);
    setShowVersions(false);
  }, []);

  const handleCopy = useCallback(() => {
    const content = viewingVersion
      ? typeof viewingVersion.content?.data === "string"
        ? viewingVersion.content.data
        : JSON.stringify(viewingVersion.content?.data, null, 2)
      : textContent;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [textContent, viewingVersion]);

  if (isEmpty && !viewingVersion) {
    return (
      <div className="px-4 py-3 text-[13px] text-gray-400 italic">
        No output
      </div>
    );
  }

  const displayContent = viewingVersion
    ? typeof viewingVersion.content?.data === "string"
      ? viewingVersion.content.data
      : JSON.stringify(viewingVersion.content?.data, null, 2)
    : textContent;

  return (
    <div className="relative group/output">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
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

          {/* Version badge */}
          {hasVersionHistory && (
            <div className="relative" ref={popoverRef}>
              <button
                onClick={fetchVersions}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-medium
                           text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-100
                           border border-gray-200 transition-colors cursor-pointer"
              >
                <History className="h-2.5 w-2.5" />
                v{block.version}
              </button>

              {/* Version history popover */}
              {showVersions && (
                <div className="absolute left-0 top-full mt-1 w-52 bg-white border border-gray-200
                                shadow-lg z-50 animate-in fade-in slide-in-from-top-1 duration-100">
                  <div className="px-3 py-2 border-b border-gray-100">
                    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                      Version history
                    </span>
                  </div>

                  {loadingVersions ? (
                    <div className="px-3 py-3 text-[11px] text-gray-400">Loading...</div>
                  ) : versions.length === 0 ? (
                    <div className="px-3 py-3 text-[11px] text-gray-400">No previous versions</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto">
                      {/* Current version */}
                      <button
                        onClick={clearViewingVersion}
                        className={`flex w-full items-center justify-between px-3 py-2 text-[12px]
                                    cursor-pointer transition-colors
                                    ${!viewingVersion ? "bg-gray-50 text-gray-900" : "text-gray-600 hover:bg-gray-50"}`}
                      >
                        <span className="font-mono font-medium">v{block.version}</span>
                        <span className="text-[10px] text-gray-400">current</span>
                      </button>

                      {/* Previous versions */}
                      {versions.map((v) => (
                        <button
                          key={v.version}
                          onClick={() => loadVersion(v.version)}
                          className={`flex w-full items-center justify-between px-3 py-2 text-[12px]
                                      cursor-pointer transition-colors
                                      ${viewingVersion?.version === v.version
                                        ? "bg-gray-50 text-gray-900"
                                        : "text-gray-600 hover:bg-gray-50"}`}
                        >
                          <span className="font-mono font-medium">v{v.version}</span>
                          <span className="text-[10px] text-gray-400">
                            {new Date(v.created_at).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Viewing old version indicator */}
          {viewingVersion && (
            <button
              onClick={clearViewingVersion}
              className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200
                         px-1.5 py-0.5 hover:bg-amber-100 transition-colors cursor-pointer"
            >
              viewing v{viewingVersion.version} — click to return
            </button>
          )}
        </div>

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
        <div className={`px-4 py-3 text-[13px] text-gray-700 font-mono leading-relaxed
                        whitespace-pre-wrap break-words select-text overflow-x-auto
                        ${viewingVersion ? "bg-amber-50/30" : ""}`}>
          {displayContent}
        </div>
      )}
    </div>
  );
}
