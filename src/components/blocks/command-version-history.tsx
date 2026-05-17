"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Plus,
  Minus,
  Pencil,
} from "lucide-react";
import type { CommandVersion } from "@/lib/models/types";

interface CommandVersionDiff {
  promptChanged: boolean;
  inputsChanged: boolean;
  schemaChanged: boolean;
  toolsChanged: boolean;
  promptDiff?: { added: string[]; removed: string[] };
  inputsDiff?: { added: string[]; removed: string[]; modified: string[] };
  schemaDiff?: { added: string[]; removed: string[]; modified: string[] };
  toolsDiff?: { added: string[]; removed: string[] };
}

interface VersionWithDiff extends CommandVersion {
  diff?: CommandVersionDiff;
}

interface CommandVersionHistoryProps {
  commandId: string;
  commandSlug: string;
  currentVersion: number;
  open: boolean;
  onClose: () => void;
  onRestored?: () => void;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function countChanges(diff: CommandVersionDiff): number {
  let count = 0;
  if (diff.promptChanged) count += 1;
  if (diff.inputsChanged) count += (diff.inputsDiff?.added.length ?? 0) + (diff.inputsDiff?.removed.length ?? 0) + (diff.inputsDiff?.modified.length ?? 0);
  if (diff.toolsChanged) count += (diff.toolsDiff?.added.length ?? 0) + (diff.toolsDiff?.removed.length ?? 0);
  if (diff.schemaChanged) count += 1;
  return count || 1;
}

function countSchemaPropertyChanges(from: CommandVersion, to: CommandVersion): number {
  const fromProps = (from.output_schema?.properties ?? {}) as Record<string, unknown>;
  const toProps = (to.output_schema?.properties ?? {}) as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(fromProps), ...Object.keys(toProps)]);
  let count = 0;
  for (const key of allKeys) {
    const inFrom = key in fromProps;
    const inTo = key in toProps;
    if (!inFrom || !inTo || JSON.stringify(fromProps[key]) !== JSON.stringify(toProps[key])) count++;
  }
  return count || 1;
}

function diffLines(before: string, after: string) {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const beforeCounts = lineCounts(beforeLines);
  const afterCounts = lineCounts(afterLines);

  return {
    added: diffCountedLines(afterLines, beforeCounts),
    removed: diffCountedLines(beforeLines, afterCounts),
  };
}

function lineCounts(lines: string[]) {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

function diffCountedLines(lines: string[], otherCounts: Map<string, number>) {
  const seen = new Map<string, number>();
  return lines.filter((line) => {
    const nextCount = (seen.get(line) ?? 0) + 1;
    seen.set(line, nextCount);
    return nextCount > (otherCounts.get(line) ?? 0);
  });
}

function computeDiff(older: CommandVersion, newer: CommandVersion): CommandVersionDiff {
  const promptDiff = diffLines(older.prompt_template, newer.prompt_template);
  const promptChanged = promptDiff.added.length > 0 || promptDiff.removed.length > 0;
  const olderInputNames = new Set((older.inputs ?? []).map((i) => i.name));
  const newerInputNames = new Set((newer.inputs ?? []).map((i) => i.name));
  const addedInputs = [...newerInputNames].filter((n) => !olderInputNames.has(n));
  const removedInputs = [...olderInputNames].filter((n) => !newerInputNames.has(n));
  const modifiedInputs = [...olderInputNames].filter((n) => {
    if (!newerInputNames.has(n)) return false;
    const a = (older.inputs ?? []).find((i) => i.name === n);
    const b = (newer.inputs ?? []).find((i) => i.name === n);
    return JSON.stringify(a) !== JSON.stringify(b);
  });

  const olderTools = older.allowed_tools ?? [];
  const newerTools = newer.allowed_tools ?? [];
  const addedTools = newerTools.filter((t) => !olderTools.includes(t));
  const removedTools = olderTools.filter((t) => !newerTools.includes(t));

  const schemaChanged = JSON.stringify(older.output_schema) !== JSON.stringify(newer.output_schema);

  return {
    promptChanged,
    inputsChanged: addedInputs.length > 0 || removedInputs.length > 0 || modifiedInputs.length > 0,
    schemaChanged,
    toolsChanged: addedTools.length > 0 || removedTools.length > 0,
    promptDiff,
    inputsDiff: { added: addedInputs, removed: removedInputs, modified: modifiedInputs },
    schemaDiff: schemaChanged ? { added: [], removed: [], modified: [] } : undefined,
    toolsDiff: { added: addedTools, removed: removedTools },
  };
}

export function CommandVersionHistory({
  commandId,
  commandSlug,
  currentVersion,
  open,
  onClose,
  onRestored,
}: CommandVersionHistoryProps) {
  const [versions, setVersions] = useState<VersionWithDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    prompt: true,
    schema: true,
    inputs: true,
    tools: true,
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setRestoreError(null);
      setSelectedVersion(null);
      setVersions([]);
    });
    fetch(`/api/commands/${commandId}/versions`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || "Failed to load versions");
        if (!Array.isArray(data)) throw new Error("Invalid version history response");
        return data as VersionWithDiff[];
      })
      .then((data: VersionWithDiff[]) => {
        if (cancelled) return;
        setVersions(data);
        if (data.length > 1) setSelectedVersion(data[1].version);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setRestoreError((err as Error).message || "Failed to load versions");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, commandId]);

  const current = versions[0] ?? null;
  const selected = useMemo(
    () => versions.find((v) => v.version === selectedVersion),
    [versions, selectedVersion]
  );

  const diff = useMemo<CommandVersionDiff | null>(() => {
    if (!selected || !current || selected.version === current.version) return null;
    return computeDiff(current, selected);
  }, [selected, current]);

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const handleRestore = useCallback(async () => {
    if (!selectedVersion) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const res = await fetch(
        `/api/commands/${commandId}/versions/${selectedVersion}/restore`,
        { method: "POST" }
      );
      if (res.ok) {
        onRestored?.();
        onClose();
      } else {
        const err = await res.json().catch(() => ({ error: "Restore failed" }));
        setRestoreError(err.error || `Restore failed (${res.status})`);
      }
    } catch {
      setRestoreError("Network error — could not restore version");
    } finally {
      setRestoring(false);
    }
  }, [commandId, selectedVersion, onClose, onRestored]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-[920px] max-w-[95vw] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="text-[18px] font-semibold text-gray-900">Command version history</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[13px] text-gray-500 font-mono">/{commandSlug}</span>
              <span className="text-[11px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                Current v{currentVersion}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selected && current && selected.version !== current.version && (
              <button
                onClick={handleRestore}
                disabled={restoring}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                           bg-blue-500 text-white text-[13px] font-medium
                           hover:bg-blue-600 transition-colors cursor-pointer
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore v{selectedVersion}
              </button>
            )}
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-lg
                         text-gray-400 hover:text-gray-600 hover:bg-gray-100
                         transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left: Version timeline */}
          <div className="w-[280px] border-r border-gray-200 overflow-y-auto shrink-0">
            {loading ? (
              <div className="py-12 text-center text-[13px] text-gray-400">Loading versions...</div>
            ) : (
              <div className="py-3">
                {versions.map((v, i) => {
                  const isLatest = i === 0;
                  const isSelected = v.version === selectedVersion;
                  const badge = isLatest ? "Current" : null;

                  return (
                    <button
                      key={v.id}
                      onClick={() => !isLatest && setSelectedVersion(v.version)}
                      className={`w-full text-left px-5 py-3 relative transition-colors
                        ${isSelected ? "bg-blue-50" : isLatest ? "opacity-70 cursor-default" : "hover:bg-gray-50 cursor-pointer"}`}
                    >
                      {/* Timeline dot + line */}
                      <div className="absolute left-5 top-0 bottom-0 flex flex-col items-center">
                        <div className={`w-[10px] h-[10px] rounded-full border-2 shrink-0 mt-[18px]
                          ${isSelected ? "border-blue-500 bg-blue-500" : isLatest ? "border-blue-500 bg-white" : "border-gray-300 bg-white"}`}
                        />
                        {i < versions.length - 1 && (
                          <div className="w-px flex-1 bg-gray-200 mt-1" />
                        )}
                      </div>

                      <div className="ml-6">
                        <div className="flex items-center gap-2">
                          <span className={`text-[14px] font-semibold ${isSelected ? "text-blue-700" : "text-gray-900"}`}>
                            v{v.version}
                          </span>
                          {badge && (
                            <span className="text-[10px] font-medium text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                              {badge}
                            </span>
                          )}
                          {isSelected && !isLatest && (
                            <span className="text-[10px] font-medium text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                              Selected
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] text-gray-500 mt-0.5">
                          {formatDate(v.created_at)} · {formatTime(v.created_at)}
                        </div>
                        {v.diff && (
                          <div className="text-[12px] text-gray-400 mt-1">
                            {[
                              v.diff.promptChanged && "Prompt",
                              v.diff.schemaChanged && "Schema",
                              v.diff.inputsChanged && "Inputs",
                              v.diff.toolsChanged && "Tools",
                            ]
                              .filter(Boolean)
                              .join(", ")}{" "}
                            changed
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Diff view */}
          <div className="flex-1 overflow-y-auto">
            {!selected || !current || selected.version === current.version ? (
              <div className="py-12 text-center text-[13px] text-gray-400">
                {versions.length <= 1
                  ? "Only one version exists. Make changes to see version history."
                  : "Select a version to compare against current."}
              </div>
            ) : (
              <div className="p-6">
                {/* Comparing header */}
                <div className="flex items-center gap-3 mb-6">
                  <h3 className="text-[15px] font-semibold text-gray-900">
                    Restore preview: v{current.version} → v{selected.version}
                  </h3>
                  <span className="text-[12px] text-gray-400">
                    {formatDate(selected.created_at)} · {countChanges(diff!)} change{countChanges(diff!) !== 1 ? "s" : ""}
                  </span>
                </div>

                {restoreError && (
                  <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-700">
                    {restoreError}
                  </div>
                )}

                {diff && (
                  <div className="flex flex-col gap-5">
                    {/* 1. Prompt diff */}
                    {diff.promptChanged && (
                      <DiffSection
                        number={1}
                        title="Prompt diff"
                        changeCount={(diff.promptDiff?.added.length ?? 0) + (diff.promptDiff?.removed.length ?? 0)}
                        expanded={expandedSections.prompt}
                        onToggle={() => toggleSection("prompt")}
                      >
                        <div className="bg-gray-50 rounded-lg overflow-hidden">
                          <div className="grid grid-cols-2 divide-x divide-gray-200">
                            <div className="p-3">
                              <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">
                                v{current.version} (current)
                              </div>
                              <div className="text-[13px] text-gray-700 leading-relaxed font-mono whitespace-pre-wrap">
                                {current.prompt_template}
                              </div>
                            </div>
                            <div className="p-3">
                              <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">
                                v{selected.version} (after restore)
                              </div>
                              <div className="text-[13px] text-gray-700 leading-relaxed font-mono whitespace-pre-wrap">
                                {selected.prompt_template}
                              </div>
                            </div>
                          </div>
                        </div>
                        {(diff.promptDiff?.removed.length ?? 0) > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {diff.promptDiff!.removed.map((line, i) => (
                              <span key={`r${i}`} className="inline-flex items-center gap-1 text-[12px] text-red-600 bg-red-50 px-2 py-0.5 rounded">
                                <Minus className="h-3 w-3" /> {line.slice(0, 60)}{line.length > 60 ? "..." : ""}
                              </span>
                            ))}
                          </div>
                        )}
                        {(diff.promptDiff?.added.length ?? 0) > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {diff.promptDiff!.added.map((line, i) => (
                              <span key={`a${i}`} className="inline-flex items-center gap-1 text-[12px] text-green-600 bg-green-50 px-2 py-0.5 rounded">
                                <Plus className="h-3 w-3" /> {line.slice(0, 60)}{line.length > 60 ? "..." : ""}
                              </span>
                            ))}
                          </div>
                        )}
                      </DiffSection>
                    )}

                    {/* 2. Schema diff */}
                    {diff.schemaChanged && (
                      <DiffSection
                        number={diff.promptChanged ? 2 : 1}
                        title="Schema diff"
                        changeCount={countSchemaPropertyChanges(current, selected)}
                        expanded={expandedSections.schema}
                        onToggle={() => toggleSection("schema")}
                      >
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                          <table className="w-full text-[13px]">
                            <thead>
                              <tr className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wider">
                                <th className="px-3 py-2 text-left font-medium">Field</th>
                                <th className="px-3 py-2 text-left font-medium">v{current.version}</th>
                                <th className="px-3 py-2 text-left font-medium">v{selected?.version}</th>
                                <th className="px-3 py-2 text-left font-medium">Change</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {renderSchemaRows(current, selected!)}
                            </tbody>
                          </table>
                        </div>
                      </DiffSection>
                    )}

                    {/* 3. Inputs changed */}
                    {diff.inputsChanged && (
                      <DiffSection
                        number={[diff.promptChanged, diff.schemaChanged].filter(Boolean).length + 1}
                        title="Inputs changed"
                        changeCount={(diff.inputsDiff?.added.length ?? 0) + (diff.inputsDiff?.removed.length ?? 0) + (diff.inputsDiff?.modified.length ?? 0)}
                        expanded={expandedSections.inputs}
                        onToggle={() => toggleSection("inputs")}
                      >
                        <div className="flex flex-wrap gap-3">
                          {diff.inputsDiff?.removed.map((name) => {
                            const input = current.inputs.find((inp) => inp.name === name);
                            return (
                              <InputCard key={`r-${name}`} status="Removed" name={name} type={input?.type ?? "string"} />
                            );
                          })}
                          {diff.inputsDiff?.modified.map((name) => {
                            const input = selected?.inputs.find((inp) => inp.name === name);
                            return (
                              <InputCard key={`m-${name}`} status="Edited" name={name} type={input?.type ?? "string"} />
                            );
                          })}
                          {diff.inputsDiff?.added.map((name) => {
                            const input = selected?.inputs.find((inp) => inp.name === name);
                            return (
                              <InputCard key={`a-${name}`} status="Added" name={name} type={input?.type ?? "string"} />
                            );
                          })}
                        </div>
                      </DiffSection>
                    )}

                    {/* 4. Tools changed */}
                    {diff.toolsChanged && (
                      <DiffSection
                        number={[diff.promptChanged, diff.schemaChanged, diff.inputsChanged].filter(Boolean).length + 1}
                        title="Tools changed"
                        changeCount={(diff.toolsDiff?.added.length ?? 0) + (diff.toolsDiff?.removed.length ?? 0)}
                        expanded={expandedSections.tools}
                        onToggle={() => toggleSection("tools")}
                      >
                        <div className="flex flex-wrap gap-2">
                          {diff.toolsDiff?.removed.map((tool) => (
                            <span key={`r-${tool}`} className="inline-flex items-center gap-1.5 text-[12px] text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg">
                              <Minus className="h-3 w-3" />
                              {tool}
                              <span className="text-[10px] font-medium text-red-500 bg-red-100 px-1.5 rounded">Removed</span>
                            </span>
                          ))}
                          {diff.toolsDiff?.added.map((tool) => (
                            <span key={`a-${tool}`} className="inline-flex items-center gap-1.5 text-[12px] text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg">
                              <Plus className="h-3 w-3" />
                              {tool}
                              <span className="text-[10px] font-medium text-green-500 bg-green-100 px-1.5 rounded">Added</span>
                            </span>
                          ))}
                        </div>
                      </DiffSection>
                    )}

                    {/* No changes */}
                    {!diff.promptChanged && !diff.schemaChanged && !diff.inputsChanged && !diff.toolsChanged && (
                      <div className="py-8 text-center text-[13px] text-gray-400">
                        No changes detected between these versions.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Subcomponents ──────────────────────────────── */

function DiffSection({
  number,
  title,
  changeCount,
  expanded,
  onToggle,
  children,
}: {
  number: number;
  title: string;
  changeCount: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center h-5 w-5 rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
            {number}
          </span>
          <span className="text-[14px] font-medium text-gray-900">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-gray-400">{changeCount} change{changeCount !== 1 ? "s" : ""}</span>
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100">
          <div className="mt-3">{children}</div>
        </div>
      )}
    </div>
  );
}

function InputCard({ status, name, type }: { status: "Added" | "Removed" | "Edited"; name: string; type: string }) {
  const colors = {
    Added: { bg: "bg-green-50", border: "border-green-200", badge: "bg-green-100 text-green-700", icon: Plus },
    Removed: { bg: "bg-red-50", border: "border-red-200", badge: "bg-red-100 text-red-700", icon: Minus },
    Edited: { bg: "bg-amber-50", border: "border-amber-200", badge: "bg-amber-100 text-amber-700", icon: Pencil },
  };
  const c = colors[status];
  const Icon = c.icon;

  return (
    <div className={`flex-1 min-w-[150px] max-w-[200px] rounded-lg border ${c.border} ${c.bg} p-3`}>
      <div className="flex items-center justify-between mb-1.5">
        <Icon className="h-3.5 w-3.5 text-gray-400" />
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${c.badge}`}>{status}</span>
      </div>
      <div className="text-[13px] font-medium text-gray-900">{name}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{type}</div>
    </div>
  );
}

function renderSchemaRows(from: CommandVersion, to: CommandVersion) {
  const fromProps = (from.output_schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const toProps = (to.output_schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const allKeys = [...new Set([...Object.keys(fromProps), ...Object.keys(toProps)])];

  if (allKeys.length === 0) {
    return (
      <tr>
        <td colSpan={4} className="px-3 py-3 text-gray-400 text-center">Schema changed (no property-level diff available)</td>
      </tr>
    );
  }

  return allKeys.map((key) => {
    const fromType = fromProps[key] ? String(fromProps[key].type ?? "—") : "—";
    const toType = toProps[key] ? String(toProps[key].type ?? "—") : "—";
    const isAdded = !fromProps[key] && toProps[key];
    const isRemoved = fromProps[key] && !toProps[key];
    const isChanged = fromProps[key] && toProps[key] && JSON.stringify(fromProps[key]) !== JSON.stringify(toProps[key]);

    return (
      <tr key={key} className={isAdded ? "bg-green-50/50" : isRemoved ? "bg-red-50/50" : isChanged ? "bg-amber-50/50" : ""}>
        <td className="px-3 py-2 font-medium text-gray-900">{key}</td>
        <td className={`px-3 py-2 ${isRemoved ? "text-red-600 line-through" : "text-gray-600"}`}>
          {fromType}
        </td>
        <td className={`px-3 py-2 ${isAdded ? "text-green-600" : "text-gray-600"}`}>
          {toType}
        </td>
        <td className="px-3 py-2">
          {isAdded && <span className="text-[10px] font-medium text-green-600 bg-green-100 px-1.5 py-0.5 rounded">Added</span>}
          {isRemoved && <span className="text-[10px] font-medium text-red-600 bg-red-100 px-1.5 py-0.5 rounded">Removed</span>}
          {isChanged && <span className="text-[10px] font-medium text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">Changed</span>}
        </td>
      </tr>
    );
  });
}
