"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Play,
  Pencil,
  Plus,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Clock,
  MoreHorizontal,
  Trash2,
  Loader2,
  Columns2,
  RotateCcw,
  History,
  LayoutList,
  Type,
  Wrench,
  RefreshCw,
  Code2,
  Copy,
  GripVertical,
  ChevronUp,
  ChevronDown,
  ArrowRight,
  Calendar,
  Minus,
} from "lucide-react";
import type { Command, CommandInput, CommandVersion } from "@/lib/models/types";
import { isSourceInput, getSourceConfig } from "@/lib/models/types";

/* ═══════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════ */

interface TestCase {
  id: string;
  command_id: string;
  workspace_id: string;
  name: string;
  input_values: Record<string, unknown>;
  source_refs: unknown[];
  expected_notes: string | null;
  last_run_id: string | null;
  last_run_output: unknown;
  last_run_status?: string | null;
  created_at: string;
  updated_at: string;
}

type PasteSourceRef = { type: "paste"; content: string };
type Tab = "overview" | "examples" | "versions";

interface CommandDetailModalProps {
  command: Command;
  open: boolean;
  onClose: () => void;
  onInsert?: (command: Command) => void;
  onEdit?: (command: Command) => void;
  onRefresh?: () => void;
}

/* ═══════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════ */

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hrs = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getOutputType(schema: Record<string, unknown>): string {
  const props = schema?.properties as Record<string, unknown> | undefined;
  if (!props) return "Text";
  const keys = Object.keys(props);
  const hasArray = keys.some(
    (k) => (props[k] as Record<string, unknown>)?.type === "array"
  );
  if (hasArray && keys.length > 1) return "Table + JSON";
  if (hasArray) return "Table";
  return "JSON";
}

function statusBadge(status: string | null | undefined) {
  switch (status) {
    case "passed":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
          <CheckCircle2 className="h-3 w-3" /> Schema OK
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
          <AlertTriangle className="h-3 w-3" /> Needs review
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
          <Clock className="h-3 w-3" /> Not run
        </span>
      );
  }
}

async function readSseEvents(
  response: Response,
  onEvent: (event: string, data: unknown) => void | Promise<void>
) {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];

  const flush = async () => {
    if (!dataLines.length) return;
    const dataText = dataLines.join("\n");
    dataLines = [];
    let parsed: unknown = dataText;
    try {
      parsed = JSON.parse(dataText);
    } catch {
      // Some SSE payloads may be plain text.
    }
    await onEvent(eventName, parsed);
    eventName = "message";
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line === "") {
        await flush();
      } else if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  }

  if (buffer) {
    const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  await flush();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ═══════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════ */

export function CommandDetailModal({
  command,
  open,
  onClose,
  onInsert,
  onEdit,
  onRefresh,
}: CommandDetailModalProps) {
  const [tab, setTab] = useState<Tab>("overview");

  if (!open) return null;

  const outputType = getOutputType(command.output_schema);
  const inputCount = command.inputs.length;
  const hasSchema = Object.keys(command.output_schema ?? {}).length > 0;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-[960px] max-w-[95vw] max-h-[85vh] flex flex-col overflow-hidden">
        {/* ── Header ── */}
        <div className="px-6 pt-5 pb-0 shrink-0">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <h2 className="text-[20px] font-semibold text-gray-900 truncate">
                {command.name}
              </h2>
              <div className="flex items-center gap-2 mt-1 text-[13px] text-gray-500">
                <span className="font-mono">/{command.slug}</span>
                <span className="text-gray-300">·</span>
                <span>Reusable command</span>
                <span className="text-gray-300">·</span>
                <span>{inputCount} input{inputCount !== 1 ? "s" : ""}</span>
                {hasSchema && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="text-blue-600">Schema validated</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onInsert && (
                <button
                  onClick={() => { onClose(); requestAnimationFrame(() => onInsert(command)); }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg
                             bg-blue-500 text-white text-[13px] font-medium
                             hover:bg-blue-600 transition-colors cursor-pointer"
                >
                  Insert on page
                </button>
              )}
              <button
                onClick={() => {
                  onClose();
                  onEdit?.(command);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg
                           border border-gray-200 text-gray-700 text-[13px] font-medium
                           hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
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

          {/* ── Tabs ── */}
          <div className="flex items-center gap-6 mt-4 border-b border-gray-200 -mx-6 px-6">
            {(
              [
                ["overview", "Overview"],
                ["examples", "Examples & Tests"],
                ["versions", "Versions"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`relative pb-3 text-[14px] font-medium transition-colors cursor-pointer
                  ${tab === key ? "text-blue-600" : "text-gray-500 hover:text-gray-700"}`}
              >
                {label}
                {tab === key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-500 rounded-t" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab content ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {tab === "overview" && (
            <OverviewTab command={command} outputType={outputType} />
          )}
          {tab === "examples" && (
            <ExamplesTab command={command} />
          )}
          {tab === "versions" && (
            <VersionsTab command={command} onRefresh={onRefresh} onClose={onClose} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ═══════════════════════════════════════════════════════
   Overview Tab
   ═══════════════════════════════════════════════════════ */

function highlightVariables(template: string) {
  const parts = template.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) =>
    part.startsWith("{{") ? (
      <span key={i} className="text-blue-600 font-semibold">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function typePill(type: string) {
  return (
    <span className="inline-flex text-[12px] font-medium text-gray-800 px-2.5 py-1 rounded-md border border-gray-300 bg-white">
      {type}
    </span>
  );
}

function OverviewTab({ command, outputType }: { command: Command; outputType: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopyPrompt = useCallback(() => {
    navigator.clipboard.writeText(command.prompt_template);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [command.prompt_template]);

  return (
    <div className="p-6 space-y-5">
      {/* ── Summary cards ── */}
      <div className="grid grid-cols-4 gap-3">
        <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 bg-white">
          <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <LayoutList className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <div className="text-[18px] font-bold text-gray-900">{command.inputs.length}</div>
            <div className="text-[12px] text-gray-500">Inputs</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 bg-white">
          <div className="h-10 w-10 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
            <Type className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <div className="text-[18px] font-bold text-gray-900">{outputType}</div>
            <div className="text-[12px] text-gray-500">Output</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 bg-white">
          <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
            <Wrench className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <div className="text-[18px] font-bold text-gray-900">{command.allowed_tools.length}</div>
            <div className="text-[12px] text-gray-500">Tools enabled</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 bg-white">
          <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
            <RefreshCw className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <div className="text-[18px] font-bold text-gray-900">Reusable</div>
            <div className="text-[12px] text-gray-500">Command</div>
          </div>
        </div>
      </div>

      {/* ── Description + Prompt Template (side by side) ── */}
      <div className="grid grid-cols-[1fr_1.4fr] gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-gray-400" />
            <h3 className="text-[14px] font-semibold text-gray-900">Description</h3>
          </div>
          <p className="text-[13px] text-gray-500 leading-relaxed">
            {command.description || "No description."}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-gray-400" />
              <h3 className="text-[14px] font-semibold text-gray-900">Prompt Template</h3>
            </div>
            <button
              onClick={handleCopyPrompt}
              className="h-7 w-7 flex items-center justify-center rounded-md
                         text-gray-400 hover:text-gray-600 hover:bg-gray-100
                         transition-colors cursor-pointer"
              title="Copy prompt"
            >
              {copied ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <div className="bg-gray-50 rounded-lg px-4 py-3 font-mono text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap max-h-[160px] overflow-y-auto border border-gray-100">
            {highlightVariables(command.prompt_template)}
          </div>
        </div>
      </div>

      {/* ── Inputs ── */}
      {command.inputs.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="h-4 w-4 text-gray-400" />
            <h3 className="text-[14px] font-semibold text-gray-900">
              Inputs <span className="text-gray-400 font-normal">({command.inputs.length})</span>
            </h3>
          </div>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50/80 text-gray-500 text-[11px] uppercase tracking-wider">
                  <th className="w-8" />
                  <th className="px-4 py-2.5 text-left font-medium">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Type</th>
                  <th className="px-4 py-2.5 text-left font-medium">Required</th>
                  <th className="px-4 py-2.5 text-left font-medium">Description</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {command.inputs.map((inp) => (
                  <tr key={inp.name} className="hover:bg-gray-50/50 transition-colors">
                    <td className="pl-3 py-3">
                      <GripVertical className="h-3.5 w-3.5 text-gray-300" />
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {inp.name}
                    </td>
                    <td className="px-4 py-3">
                      {typePill(inp.type)}
                    </td>
                    <td className="px-4 py-3">
                      {inp.required ? (
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          <span className="text-[12px] text-gray-600">Required</span>
                        </div>
                      ) : (
                        <span className="text-[12px] text-gray-400">Optional</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {inp.description || "—"}
                    </td>
                    <td className="pr-3 py-3">
                      <MoreHorizontal className="h-3.5 w-3.5 text-gray-300" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Output Type + Tools (side by side) ── */}
      <div className="grid grid-cols-[auto_1fr] gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5 min-w-[160px]">
          <div className="flex items-center gap-2 mb-3">
            <Type className="h-4 w-4 text-gray-400" />
            <h3 className="text-[14px] font-semibold text-gray-900">Output Type</h3>
          </div>
          <span className="inline-flex text-[12px] font-semibold text-purple-700 bg-purple-100 px-3 py-1 rounded-md">
            {outputType}
          </span>
        </div>

        {command.allowed_tools.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <Wrench className="h-4 w-4 text-gray-400" />
              <h3 className="text-[14px] font-semibold text-gray-900">
                Tools <span className="text-gray-400 font-normal">({command.allowed_tools.length})</span>
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {command.allowed_tools.map((tool) => (
                <span
                  key={tool}
                  className="text-[12px] font-medium text-gray-600 bg-gray-50 border border-gray-200
                             px-2.5 py-1 rounded-md"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Examples & Tests Tab
   ═══════════════════════════════════════════════════════ */

function ExamplesTab({ command }: { command: Command }) {
  const [examples, setExamples] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [compareLeft, setCompareLeft] = useState<string | null>(null);
  const [compareRight, setCompareRight] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const fetchExamples = useCallback(async () => {
    const res = await fetch(`/api/commands/${command.id}/test-cases`);
    if (res.ok) {
      const data = await res.json();
      setExamples(data);
    }
    setLoading(false);
  }, [command.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchExamples();
  }, [fetchExamples]);

  const handleCreate = useCallback(
    async (
      name: string,
      inputValues: Record<string, unknown>,
      sourceRefs: PasteSourceRef[] = []
    ) => {
      const res = await fetch(`/api/commands/${command.id}/test-cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: command.workspace_id,
          name,
          inputValues,
          sourceRefs,
        }),
      });
      if (res.ok) {
        await fetchExamples();
        setShowForm(false);
      }
    },
    [command.id, command.workspace_id, fetchExamples]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setExamples((prev) => prev.filter((e) => e.id !== id));
      await fetch(`/api/commands/${command.id}/test-cases/${id}`, {
        method: "DELETE",
      });
    },
    [command.id]
  );

  const handleRunOne = useCallback(
    async (id: string) => {
      setRunningIds((prev) => new Set(prev).add(id));
      try {
        const res = await fetch(
          `/api/commands/${command.id}/test-cases/${id}/run`,
          { method: "POST" }
        );
        if (!res.ok) throw new Error("Run failed");
        await readSseEvents(res, async (event) => {
          if (event === "complete" || event === "error") {
            await fetchExamples();
          }
        });
      } finally {
        setRunningIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [command.id, fetchExamples]
  );

  const handleRunAll = useCallback(async () => {
    setRunningAll(true);
    const allIds = new Set(examples.map((e) => e.id));
    setRunningIds(allIds);
    try {
      const res = await fetch(
        `/api/commands/${command.id}/test-cases/run-all`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error("Run All failed");
      await readSseEvents(res, (event, data) => {
        if (event === "test-complete" && isRecord(data) && typeof data.testCaseId === "string") {
          const testCaseId = data.testCaseId;
          setRunningIds((prev) => {
            const next = new Set(prev);
            next.delete(testCaseId);
            return next;
          });
        }
      });
      await fetchExamples();
    } finally {
      setRunningAll(false);
      setRunningIds(new Set());
    }
  }, [command.id, examples, fetchExamples]);

  const schemaOk = examples.filter((e) => e.last_run_status === "passed").length;
  const needsReview = examples.filter((e) => e.last_run_status === "failed").length;
  const lastRun = examples
    .filter((e) => e.updated_at)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];

  const effectiveCompareLeft = compareLeft ?? examples[0]?.id ?? null;
  const effectiveCompareRight =
    compareRight ?? (examples.length > 1 ? examples[1]?.id ?? null : null);
  const leftExample = examples.find((e) => e.id === effectiveCompareLeft);
  const rightExample = examples.find((e) => e.id === effectiveCompareRight);

  return (
    <div className="flex flex-col h-full">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 px-6 pt-5 pb-4 shrink-0">
        <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 bg-white">
          <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <FileText className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <div className="text-[18px] font-bold text-gray-900">{examples.length}</div>
            <div className="text-[12px] text-gray-500">examples</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 bg-white">
          <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <div className="text-[18px] font-bold text-gray-900">{schemaOk}</div>
            <div className="text-[12px] text-gray-500">schema OK</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 bg-white">
          <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <div className="text-[18px] font-bold text-gray-900">{needsReview}</div>
            <div className="text-[12px] text-gray-500">needs review</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 bg-white">
          <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
            <Clock className="h-5 w-5 text-gray-400" />
          </div>
          <div>
            <div className="text-[15px] font-bold text-gray-900">{lastRun ? timeAgo(lastRun.updated_at) : "—"}</div>
            <div className="text-[12px] text-gray-500">Last run</div>
          </div>
        </div>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-2 px-6 pb-4 shrink-0">
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                     bg-blue-500 text-white text-[13px] font-medium
                     hover:bg-blue-600 transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" /> Add Example
        </button>
        {examples.length > 0 && (
          <button
            onClick={handleRunAll}
            disabled={runningAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                       border border-gray-200 text-gray-700 text-[13px] font-medium
                       hover:bg-gray-50 transition-colors cursor-pointer
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {runningAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Run All
          </button>
        )}
      </div>

      {/* Main content: example list + compare */}
      <div className="flex-1 flex min-h-0 overflow-hidden border-t border-gray-200">
        {/* Left: example list */}
        <div className="w-[420px] shrink-0 border-r border-gray-200 overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center text-[13px] text-gray-400">
              Loading examples...
            </div>
          ) : showForm ? (
            <AddExampleForm
              command={command}
              onCancel={() => setShowForm(false)}
              onSave={handleCreate}
            />
          ) : examples.length === 0 ? (
            <div className="py-12 text-center px-6">
              <FileText className="h-8 w-8 text-gray-300 mx-auto mb-3" />
              <p className="text-[14px] font-medium text-gray-600 mb-1">
                No examples yet
              </p>
              <p className="text-[13px] text-gray-400 mb-4">
                Add example inputs to test this command across different scenarios.
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                           bg-blue-500 text-white text-[13px] font-medium
                           hover:bg-blue-600 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" /> Add Example
              </button>
            </div>
          ) : (
            <div className="py-3 px-4 flex flex-col gap-2">
              {examples.map((ex, i) => (
                <ExampleCard
                  key={ex.id}
                  example={ex}
                  index={i + 1}
                  running={runningIds.has(ex.id)}
                  menuOpen={menuOpenId === ex.id}
                  onToggleMenu={() => setMenuOpenId(menuOpenId === ex.id ? null : ex.id)}
                  onRun={() => handleRunOne(ex.id)}
                  onCompare={() => {
                    if (!compareLeft) setCompareLeft(ex.id);
                    else if (!compareRight || compareRight === ex.id) setCompareRight(ex.id);
                    else setCompareLeft(ex.id);
                  }}
                  onDelete={() => handleDelete(ex.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: compare panel */}
        <div className="flex-1 overflow-y-auto">
          {examples.length < 1 ? (
            <div className="py-12 text-center text-[13px] text-gray-400">
              Add examples to compare outputs side-by-side.
            </div>
          ) : (
            <div className="p-5">
              <h3 className="text-[16px] font-bold text-gray-900 mb-4">
                Compare outputs
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <CompareColumn
                  examples={examples}
                  selectedId={effectiveCompareLeft}
                  onSelect={setCompareLeft}
                  example={leftExample}
                  schema={command.output_schema}
                />
                <CompareColumn
                  examples={examples}
                  selectedId={effectiveCompareRight}
                  onSelect={setCompareRight}
                  example={rightExample}
                  schema={command.output_schema}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Example Card ── */

function ExampleCard({
  example,
  index,
  running,
  menuOpen,
  onToggleMenu,
  onRun,
  onCompare,
  onDelete,
}: {
  example: TestCase;
  index: number;
  running: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onRun: () => void;
  onCompare: () => void;
  onDelete: () => void;
}) {
  const inputPills = Object.entries(example.input_values).slice(0, 3);

  return (
    <div
      className={`rounded-xl border p-4 transition-colors relative
        ${example.last_run_status === "failed"
          ? "border-amber-200 bg-amber-50/30"
          : "border-gray-300 bg-white hover:border-gray-400"
        }`}
    >
      {/* Top: index + name + badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[14px] font-bold text-gray-400 tabular-nums shrink-0">
            {String(index).padStart(2, "0")}
          </span>
          <span className="text-[15px] font-semibold text-gray-900 truncate">
            {example.name}
          </span>
        </div>
        <div className="shrink-0">{statusBadge(example.last_run_status)}</div>
      </div>

      {/* Input pills */}
      {inputPills.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3 ml-8">
          {inputPills.map(([key, val]) => (
            <span
              key={key}
              className="inline-flex text-[12px] font-medium text-gray-800 bg-white border border-gray-300
                         px-2.5 py-1 rounded-md truncate max-w-[160px]"
            >
              {key}: {typeof val === "string" ? val.slice(0, 20) : JSON.stringify(val).slice(0, 20)}
            </span>
          ))}
          {Object.keys(example.input_values).length > 3 && (
            <span className="text-[12px] text-gray-400 self-center">
              +{Object.keys(example.input_values).length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Time + actions */}
      <div className="flex items-center justify-between mt-3 ml-8">
        <span className="text-[12px] text-gray-400">
          {example.last_run_id ? timeAgo(example.updated_at) : "Never run"}
        </span>

        <div className="flex items-center gap-2">
          <button
            onClick={onRun}
            disabled={running}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-blue-600
                       hover:text-blue-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            Run
          </button>
          {example.last_run_output != null && (
            <button
              onClick={onCompare}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-500
                         hover:text-gray-700 transition-colors cursor-pointer"
            >
              <Columns2 className="h-3 w-3" /> Compare
            </button>
          )}
          <div className="relative">
            <button
              onClick={onToggleMenu}
              className="h-6 w-6 flex items-center justify-center rounded
                         text-gray-400 hover:text-gray-600 hover:bg-gray-100
                         transition-colors cursor-pointer"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-32">
                <button
                  onClick={() => { onDelete(); onToggleMenu(); }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-red-600
                             hover:bg-red-50 transition-colors cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Add Example Form ── */

function AddExampleForm({
  command,
  onCancel,
  onSave,
}: {
  command: Command;
  onCancel: () => void;
  onSave: (
    name: string,
    inputValues: Record<string, unknown>,
    sourceRefs?: PasteSourceRef[]
  ) => void;
}) {
  const inputs = command.inputs;
  const sourceConfig = getSourceConfig(command);
  const hasSourceInputs = inputs.some(isSourceInput) || sourceConfig !== null;
  const regularInputs = inputs.filter((inp) => !isSourceInput(inp));
  const sourceInputs = inputs.filter(isSourceInput);
  const sourceContentFields =
    sourceInputs.length > 0
      ? sourceInputs.map((input) => ({
          key: input.name,
          label:
            sourceInputs.length === 1
              ? "Test content"
              : input.description || input.name.replace(/_/g, " "),
          input,
        }))
      : hasSourceInputs || regularInputs.length === 0
        ? [{ key: "__test_content", label: "Test content", input: null }]
        : [];

  const [name, setName] = useState("");
  const [sourceContents, setSourceContents] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const inp of inputs) {
      if (isSourceInput(inp)) continue;
      if (inp.default_value !== undefined) init[inp.name] = inp.default_value;
      else if (inp.type === "boolean") init[inp.name] = false;
      else if (inp.type === "number" || inp.type === "slider") init[inp.name] = inp.min ?? 0;
      else init[inp.name] = "";
    }
    return init;
  });

  const sourceTexts = sourceContentFields
    .map((field) => sourceContents[field.key]?.trim() ?? "")
    .filter(Boolean);
  const missingRequiredSourceInput = sourceInputs.some(
    (input) => input.required && !(sourceContents[input.name]?.trim())
  );
  const sourceContentRequired =
    regularInputs.length === 0 ||
    sourceConfig?.required === true ||
    sourceInputs.some((input) => input.required);
  const canSave =
    name.trim().length > 0 &&
    !missingRequiredSourceInput &&
    (!sourceContentRequired || sourceTexts.length > 0);

  const handleSave = () => {
    if (!canSave) return;
    const allValues = { ...values };
    const sourceRefs: PasteSourceRef[] = [];

    for (const field of sourceContentFields) {
      const content = sourceContents[field.key]?.trim();
      if (!content) continue;

      if (field.input) {
        allValues[field.input.name] = content;
      }
      if (sourceConfig || !field.input) {
        sourceRefs.push({ type: "paste", content });
      }
    }

    onSave(name.trim(), allValues, sourceRefs);
  };

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-[16px] font-semibold text-gray-900">New example</h3>
        <button
          onClick={onCancel}
          className="text-[12px] text-gray-500 hover:text-gray-700 cursor-pointer"
        >
          Cancel
        </button>
      </div>

      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-[12px] font-semibold text-gray-700 mb-1.5">
            Example name
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Short article, Messy PDF, Competitor page..."
            className="w-full h-9 px-3 text-[13px] text-gray-800 border border-gray-200 rounded-lg
                       outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400
                       placeholder:text-gray-400"
          />
        </div>

        {/* Source content */}
        {sourceContentFields.length > 0 && (
          <div className="space-y-3">
            {sourceContentFields.map((field) => (
              <div key={field.key}>
                <label className="block text-[12px] font-semibold text-gray-700 mb-1.5">
                  {field.label}
                  {(field.input?.required || (field.input === null && sourceContentRequired)) && (
                    <span className="text-red-400 ml-0.5">*</span>
                  )}
                  <span className="font-normal text-gray-400 ml-1.5">
                    Paste the text, article, or data this command will process
                  </span>
                </label>
                <textarea
                  value={sourceContents[field.key] ?? ""}
                  onChange={(e) =>
                    setSourceContents((prev) => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))
                  }
                  rows={5}
                  className="w-full px-3 py-2.5 text-[13px] text-gray-800 border border-gray-200 rounded-lg
                             outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400
                             placeholder:text-gray-400 resize-y leading-relaxed"
                  placeholder="Paste the content you want to test this command with..."
                />
              </div>
            ))}
          </div>
        )}

        {/* Regular inputs */}
        {regularInputs.length > 0 && (
          <div>
            <div className="text-[12px] font-semibold text-gray-700 mb-1">
              Command inputs
            </div>
            <p className="text-[11px] text-gray-400 mb-3">
              Set the values this command will use when running this example.
            </p>
            <div className="space-y-3">
              {regularInputs.map((inp) => (
                <div key={inp.name}>
                  <label className="block mb-1.5">
                    <span className="text-[12px] font-semibold text-gray-700">
                      {inp.description || inp.name.replace(/_/g, " ")}
                    </span>
                    {inp.required && <span className="text-red-400 ml-0.5">*</span>}
                    <span className="text-[11px] text-gray-400 ml-2 font-normal">
                      {inp.name} · {inp.type}{inp.options?.length ? ` · ${inp.options.length} options` : ""}
                    </span>
                  </label>
                  {inp.type === "boolean" ? (
                    <button
                      onClick={() => setValues((v) => ({ ...v, [inp.name]: !v[inp.name] }))}
                      className={`relative h-[22px] w-[40px] rounded-full transition-colors cursor-pointer
                        ${values[inp.name] ? "bg-blue-500" : "bg-gray-300"}`}
                    >
                      <span
                        className={`absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-sm
                          transition-transform ${values[inp.name] ? "translate-x-[18px]" : "translate-x-0"}`}
                      />
                    </button>
                  ) : inp.options && inp.options.length > 0 ? (
                    <select
                      value={String(values[inp.name] ?? "")}
                      onChange={(e) => setValues((v) => ({ ...v, [inp.name]: e.target.value }))}
                      className="w-full h-9 px-3 text-[13px] text-gray-800 border border-gray-200 rounded-lg
                                 outline-none focus:border-blue-400 bg-white cursor-pointer"
                    >
                      <option value="">Select...</option>
                      {inp.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : inp.type === "number" || inp.type === "slider" ? (
                    <input
                      type="number"
                      value={String(values[inp.name] ?? "")}
                      min={inp.min}
                      max={inp.max}
                      onChange={(e) => setValues((v) => ({ ...v, [inp.name]: Number(e.target.value) }))}
                      className="w-full h-9 px-3 text-[13px] text-gray-800 border border-gray-200 rounded-lg
                                 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                    />
                  ) : (
                    <input
                      type="text"
                      value={String(values[inp.name] ?? "")}
                      onChange={(e) => setValues((v) => ({ ...v, [inp.name]: e.target.value }))}
                      className="w-full h-9 px-3 text-[13px] text-gray-800 border border-gray-200 rounded-lg
                                 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400
                                 placeholder:text-gray-400"
                      placeholder={`Enter ${inp.name.replace(/_/g, " ")}...`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-[13px] text-gray-600 hover:text-gray-800
                     transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg
                     bg-blue-500 text-white text-[13px] font-medium
                     hover:bg-blue-600 transition-colors cursor-pointer
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save Example
        </button>
      </div>
    </div>
  );
}

/* ── Compare Column ── */

function CompareColumn({
  examples,
  selectedId,
  onSelect,
  example,
  schema,
}: {
  examples: TestCase[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  example: TestCase | undefined;
  schema?: Record<string, unknown>;
}) {
  return (
    <div className="flex flex-col">
      <select
        value={selectedId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full h-9 px-3 text-[13px] text-gray-800 border border-gray-200 rounded-lg
                   bg-white outline-none cursor-pointer mb-3"
      >
        <option value="" disabled>Select example...</option>
        {examples.map((ex) => (
          <option key={ex.id} value={ex.id}>{ex.name}</option>
        ))}
      </select>

      {example ? (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            {statusBadge(example.last_run_status)}
            {example.last_run_id && (
              <span className="text-[11px] text-gray-400">
                {timeAgo(example.updated_at)}
              </span>
            )}
          </div>
          <div className="p-3">
            {example.last_run_output ? (
              <OutputPreview output={example.last_run_output} schema={schema} />
            ) : (
              <p className="text-[13px] text-gray-400 py-4 text-center">
                Not run yet. Click Run to see output.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="border border-dashed border-gray-200 rounded-lg py-8 text-center">
          <p className="text-[13px] text-gray-400">Select an example to compare</p>
        </div>
      )}
    </div>
  );
}

/* ── Output Preview ── */

function OutputPreview({
  output,
  schema,
}: {
  output: unknown;
  schema?: Record<string, unknown>;
}) {
  if (output === null || output === undefined || typeof output !== "object") {
    return (
      <p className="text-[13px] text-gray-600 whitespace-pre-wrap">
        {String(output)}
      </p>
    );
  }

  if (Array.isArray(output)) {
    return renderArrayPreview("Output", output, schema);
  }

  const obj = output as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text : undefined;
  const schemaProps = getSchemaProperties(schema);
  return (
    <div className="space-y-3">
      {text && (
        <div>
          <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
            Summary
          </h4>
          <p className="text-[13px] text-gray-700 leading-relaxed line-clamp-6">
            {text}
          </p>
        </div>
      )}

      {Object.entries(obj)
        .filter(([k]) => k !== "text")
        .map(([key, val]) => {
          const fieldSchema = schemaProps[key] as Record<string, unknown> | undefined;
          if (Array.isArray(val)) return renderArrayPreview(key, val, fieldSchema);

          return (
            <div key={key}>
              <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                {key.replace(/_/g, " ")}
              </h4>
              <p className="text-[13px] text-gray-700">
                {typeof val === "string" || typeof val === "number" || typeof val === "boolean"
                  ? String(val)
                  : JSON.stringify(val, null, 2)}
              </p>
            </div>
          );
        })}
    </div>
  );
}

function renderArrayPreview(
  label: string,
  value: unknown[],
  schema?: Record<string, unknown>
) {
  if (value.length === 0) {
    return (
      <div key={label}>
        <OutputSectionTitle label={label} />
        <p className="text-[13px] text-gray-400">No items</p>
      </div>
    );
  }

  if (isStringArray(value)) {
    return <TodoListPreview key={label} label={label} items={value} />;
  }

  if (isObjectArray(value)) {
    const rows = value as Record<string, unknown>[];
    if (shouldRenderTodoRows(label, rows, schema)) {
      return <TodoObjectPreview key={label} label={label} rows={rows} />;
    }
    return <TablePreview key={label} label={label} rows={rows} />;
  }

  return (
    <div key={label}>
      <OutputSectionTitle label={label} />
      <pre className="text-[12px] text-gray-700 whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function OutputSectionTitle({ label }: { label: string }) {
  return (
    <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
      {label.replace(/_/g, " ")}
    </h4>
  );
}

function TodoListPreview({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <OutputSectionTitle label={label} />
      <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
        {items.slice(0, 8).map((item, index) => (
          <div key={`${item}-${index}`} className="flex items-start gap-2 px-2 py-1.5">
            <span className="mt-[3px] h-3.5 w-3.5 rounded border border-gray-300 shrink-0" />
            <span className="text-[12px] text-gray-700 leading-snug">{item}</span>
          </div>
        ))}
        {items.length > 8 && <MoreRows count={items.length - 8} label="items" />}
      </div>
    </div>
  );
}

function TodoObjectPreview({
  label,
  rows,
}: {
  label: string;
  rows: Record<string, unknown>[];
}) {
  return (
    <div>
      <OutputSectionTitle label={label} />
      <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
        {rows.slice(0, 8).map((row, index) => {
          const done = getTodoDone(row);
          return (
            <div key={index} className="flex items-start gap-2 px-2 py-1.5">
              <span
                className={`mt-[3px] h-3.5 w-3.5 rounded border shrink-0 flex items-center justify-center
                  ${done ? "border-blue-400 bg-blue-50" : "border-gray-300"}`}
              >
                {done && <span className="h-1.5 w-1.5 rounded-sm bg-blue-500" />}
              </span>
              <div className="min-w-0">
                <div className="text-[12px] text-gray-700 leading-snug">
                  {getTodoText(row)}
                </div>
                {renderTodoMeta(row)}
              </div>
            </div>
          );
        })}
        {rows.length > 8 && <MoreRows count={rows.length - 8} label="items" />}
      </div>
    </div>
  );
}

function TablePreview({ label, rows }: { label: string; rows: Record<string, unknown>[] }) {
  const columns = uniqueColumns(rows).slice(0, 6);
  return (
    <div>
      <OutputSectionTitle label={label} />
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
              {columns.map((col) => (
                <th key={col} className="px-2 py-1.5 text-left font-medium">
                  {col.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.slice(0, 8).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((col) => (
                  <td key={col} className="px-2 py-1.5 text-gray-700 truncate max-w-[120px]">
                    {formatPreviewCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 8 && <MoreRows count={rows.length - 8} label="rows" />}
      </div>
    </div>
  );
}

function MoreRows({ count, label }: { count: number; label: string }) {
  return (
    <div className="px-2 py-1.5 text-[11px] text-gray-400 bg-gray-50 border-t border-gray-100">
      +{count} more {label}
    </div>
  );
}

function isStringArray(value: unknown[]): value is string[] {
  return value.every((item) => typeof item === "string");
}

function isObjectArray(value: unknown[]) {
  return value.every((item) => isRecord(item));
}

function shouldRenderTodoRows(
  label: string,
  rows: Record<string, unknown>[],
  schema?: Record<string, unknown>
) {
  if (isTodoLikeLabel(label)) return true;
  if (schema && isTodoLikeSchema(schema)) return true;
  const keys = new Set(rows.flatMap((row) => Object.keys(row).map((key) => key.toLowerCase())));
  const hasText = ["text", "title", "task", "todo", "item", "description", "action"].some((key) =>
    keys.has(key)
  );
  const hasDone = ["done", "completed", "checked", "complete", "is_done"].some((key) =>
    keys.has(key)
  );
  return hasText && hasDone;
}

function isTodoLikeLabel(label: string) {
  return /todo|task|action.?item|checklist/i.test(label);
}

function isTodoLikeSchema(schema: Record<string, unknown>) {
  const title = typeof schema.title === "string" ? schema.title : "";
  const description = typeof schema.description === "string" ? schema.description : "";
  return isTodoLikeLabel(`${title} ${description}`);
}

function getTodoDone(row: Record<string, unknown>) {
  for (const key of ["done", "completed", "checked", "complete", "is_done"]) {
    if (typeof row[key] === "boolean") return row[key] as boolean;
  }
  return false;
}

function getTodoText(row: Record<string, unknown>) {
  for (const key of ["text", "title", "task", "todo", "item", "description", "action"]) {
    if (row[key] !== undefined) return formatPreviewCell(row[key]);
  }
  return formatPreviewCell(row);
}

function renderTodoMeta(row: Record<string, unknown>) {
  const hidden = new Set([
    "text",
    "title",
    "task",
    "todo",
    "item",
    "description",
    "action",
    "done",
    "completed",
    "checked",
    "complete",
    "is_done",
  ]);
  const meta = Object.entries(row).filter(([key]) => !hidden.has(key.toLowerCase()));
  if (meta.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-1">
      {meta.slice(0, 3).map(([key, value]) => (
        <span key={key} className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
          {key.replace(/_/g, " ")}: {formatPreviewCell(value)}
        </span>
      ))}
    </div>
  );
}

function uniqueColumns(rows: Record<string, unknown>[]) {
  return Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
}

function formatPreviewCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function getSchemaProperties(schema?: Record<string, unknown>) {
  const props = schema?.properties;
  return isRecord(props) ? props : {};
}

/* ═══════════════════════════════════════════════════════
   Versions Tab (wraps existing CommandVersionHistory internals)
   ═══════════════════════════════════════════════════════ */

function VersionsTab({
  command,
  onRefresh,
  onClose,
}: {
  command: Command;
  onRefresh?: () => void;
  onClose?: () => void;
}) {
  const [versions, setVersions] = useState<CommandVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/commands/${command.id}/versions`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      })
      .then((data: CommandVersion[]) => {
        setVersions(data);
        if (data.length > 1) setSelectedVersion(data[1].version);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [command.id]);

  const current = versions[0] ?? null;
  const selected = useMemo(
    () => versions.find((v) => v.version === selectedVersion),
    [versions, selectedVersion]
  );

  const handleRestore = useCallback(async () => {
    if (!selectedVersion) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const res = await fetch(
        `/api/commands/${command.id}/versions/${selectedVersion}/restore`,
        { method: "POST" }
      );
      if (res.ok) {
        await onRefresh?.();
        onClose?.();
      } else {
        const err = await res.json().catch(() => ({ error: "Restore failed" }));
        setRestoreError(err.error || "Restore failed");
      }
    } catch {
      setRestoreError("Network error");
    } finally {
      setRestoring(false);
    }
  }, [command.id, selectedVersion, onRefresh, onClose]);

  if (loading) {
    return (
      <div className="py-12 text-center text-[13px] text-gray-400">
        Loading versions...
      </div>
    );
  }

  if (versions.length <= 1) {
    return (
      <div className="py-12 text-center">
        <History className="h-8 w-8 text-gray-300 mx-auto mb-3" />
        <p className="text-[14px] font-medium text-gray-600 mb-1">
          Only one version
        </p>
        <p className="text-[13px] text-gray-400">
          Edit the command to create a new version.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Timeline */}
      <div className="w-[260px] border-r border-gray-200 overflow-y-auto shrink-0 py-3">
        {versions.map((v, i) => {
          const isLatest = i === 0;
          const isSelected = v.version === selectedVersion;
          return (
            <button
              key={v.id}
              onClick={() => !isLatest && setSelectedVersion(v.version)}
              className={`w-full text-left px-5 py-3 relative transition-colors
                ${isSelected ? "bg-blue-50" : isLatest ? "opacity-70 cursor-default" : "hover:bg-gray-50 cursor-pointer"}`}
            >
              <div className="absolute left-5 top-0 bottom-0 flex flex-col items-center">
                <div
                  className={`w-[10px] h-[10px] rounded-full border-2 shrink-0 mt-[18px]
                    ${isSelected ? "border-blue-500 bg-blue-500" : isLatest ? "border-blue-500 bg-white" : "border-gray-300 bg-white"}`}
                />
                {i < versions.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-1" />}
              </div>
              <div className="ml-6">
                <div className="flex items-center gap-2">
                  <span className={`text-[14px] font-semibold ${isSelected ? "text-blue-700" : "text-gray-900"}`}>
                    v{v.version}
                  </span>
                  {isLatest && (
                    <span className="text-[10px] font-medium text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                      Current
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-gray-500 mt-0.5">
                  {new Date(v.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Diff view */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {selected && current && selected.version !== current.version ? (
          <>
            <div className="p-6 pb-6 flex-1">
              {/* Comparing header */}
              <div className="flex items-center gap-3 mb-5">
                <h3 className="text-[16px] font-semibold text-gray-900">
                  Comparing v{current.version} to v{selected.version}
                </h3>
                <div className="flex items-center gap-2 text-[12px] text-gray-500">
                  <Calendar className="h-3.5 w-3.5" />
                  {new Date(selected.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  <span className="text-gray-300">·</span>
                  {new Date(selected.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </div>
              </div>

              {restoreError && (
                <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-700">
                  {restoreError}
                </div>
              )}

              <div className="space-y-4">
                {/* Prompt diff */}
                {current.prompt_template !== selected.prompt_template && (
                  <VersionDiffSection
                    title="Prompt diff"
                    changeCount={countLineDiff(current.prompt_template, selected.prompt_template)}
                  >
                    <PromptLineDiff current={current.prompt_template} selected={selected.prompt_template} />
                  </VersionDiffSection>
                )}

                {/* Schema diff */}
                {JSON.stringify(current.output_schema) !== JSON.stringify(selected.output_schema) && (
                  <VersionDiffSection
                    title="Schema diff"
                    changeCount={countSchemaDiff(current.output_schema, selected.output_schema)}
                  >
                    <SchemaDiff current={current.output_schema} selected={selected.output_schema} />
                  </VersionDiffSection>
                )}

                {/* Inputs changed */}
                {JSON.stringify(current.inputs) !== JSON.stringify(selected.inputs) && (
                  <VersionDiffSection
                    title="Inputs changed"
                    changeCount={countInputDiff(current.inputs, selected.inputs)}
                  >
                    <InputsDiff current={current.inputs ?? []} selected={selected.inputs ?? []} />
                  </VersionDiffSection>
                )}

                {/* No changes */}
                {current.prompt_template === selected.prompt_template &&
                 JSON.stringify(current.output_schema) === JSON.stringify(selected.output_schema) &&
                 JSON.stringify(current.inputs) === JSON.stringify(selected.inputs) && (
                  <div className="py-8 text-center text-[13px] text-gray-400">
                    No changes detected between these versions.
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between shrink-0 bg-gray-50/50">
              <div className="flex items-center gap-1.5 text-[12px] text-gray-400">
                <RotateCcw className="h-3 w-3" />
                Restoring creates a new version and does not delete history.
              </div>
              <button
                onClick={handleRestore}
                disabled={restoring}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg
                           bg-blue-500 text-white text-[13px] font-medium
                           hover:bg-blue-600 transition-colors cursor-pointer
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore v{selectedVersion}
              </button>
            </div>
          </>
        ) : (
          <div className="py-12 text-center text-[13px] text-gray-400">
            Select a version to compare against current.
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Version Diff Helpers ── */

function VersionDiffSection({
  title,
  changeCount,
  children,
}: {
  title: string;
  changeCount: number;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer"
      >
        <span className="text-[14px] font-semibold text-gray-900">{title}</span>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-gray-400">
            {changeCount} change{changeCount !== 1 ? "s" : ""}
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-gray-100 px-4 pt-4 pb-5">
          {children}
        </div>
      )}
    </div>
  );
}

function countLineDiff(a: string, b: string): number {
  const aLines = a.split(/\r?\n/);
  const bLines = b.split(/\r?\n/);
  const aSet = new Set(aLines);
  const bSet = new Set(bLines);
  let count = 0;
  for (const line of aLines) if (!bSet.has(line)) count++;
  for (const line of bLines) if (!aSet.has(line)) count++;
  return count || 1;
}

function PromptLineDiff({ current, selected }: { current: string; selected: string }) {
  const currentLines = current.split(/\r?\n/);
  const selectedLines = selected.split(/\r?\n/);
  const selectedSet = new Set(selectedLines);
  const currentSet = new Set(currentLines);

  const allLines: Array<{ text: string; type: "same" | "removed" | "added" }> = [];

  for (const line of currentLines) {
    if (!selectedSet.has(line)) {
      allLines.push({ text: line, type: "removed" });
    }
  }
  for (const line of selectedLines) {
    if (!currentSet.has(line)) {
      allLines.push({ text: line, type: "added" });
    } else {
      allLines.push({ text: line, type: "same" });
    }
  }

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-100 overflow-hidden font-mono text-[13px]">
      {allLines.map((line, i) => (
        <div
          key={i}
          className={`flex items-start px-3 py-1 leading-relaxed
            ${line.type === "removed" ? "bg-red-50" : line.type === "added" ? "bg-green-50" : ""}`}
        >
          <span className="w-7 text-[11px] text-gray-400 shrink-0 text-right mr-3 select-none pt-0.5">
            {i + 1}
          </span>
          <span className="w-4 shrink-0 select-none pt-0.5">
            {line.type === "removed" && <Minus className="h-3 w-3 text-red-400" />}
            {line.type === "added" && <Plus className="h-3 w-3 text-green-500" />}
          </span>
          <span
            className={`flex-1 whitespace-pre-wrap
              ${line.type === "removed" ? "text-red-700 line-through" : ""}
              ${line.type === "added" ? "text-green-700" : ""}
              ${line.type === "same" ? "text-gray-700" : ""}`}
          >
            {line.text || " "}
          </span>
        </div>
      ))}
    </div>
  );
}

function countSchemaDiff(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const aProps = ((a?.properties ?? {}) as Record<string, unknown>);
  const bProps = ((b?.properties ?? {}) as Record<string, unknown>);
  const allKeys = new Set([...Object.keys(aProps), ...Object.keys(bProps)]);
  let count = 0;
  for (const key of allKeys) {
    if (!(key in aProps) || !(key in bProps) || JSON.stringify(aProps[key]) !== JSON.stringify(bProps[key])) count++;
  }
  return count || 1;
}

function SchemaDiff({ current, selected }: { current: Record<string, unknown>; selected: Record<string, unknown> }) {
  const currentProps = (current?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const selectedProps = (selected?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const currentRequired = new Set(((current?.required ?? []) as string[]));
  const selectedRequired = new Set(((selected?.required ?? []) as string[]));
  const allKeys = [...new Set([...Object.keys(currentProps), ...Object.keys(selectedProps)])];

  if (allKeys.length === 0) {
    return (
      <div className="grid grid-cols-2 divide-x divide-gray-200 rounded-lg border border-gray-100 overflow-hidden">
        <pre className="p-3 text-[12px] text-gray-600 whitespace-pre-wrap bg-red-50/30 font-mono">
          {JSON.stringify(current, null, 2)}
        </pre>
        <pre className="p-3 text-[12px] text-gray-600 whitespace-pre-wrap bg-green-50/30 font-mono">
          {JSON.stringify(selected, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {allKeys.map((key) => {
        const inCurrent = key in currentProps;
        const inSelected = key in selectedProps;
        const currentType = inCurrent ? String(currentProps[key].type ?? "unknown") : null;
        const selectedType = inSelected ? String(selectedProps[key].type ?? "unknown") : null;
        const wasRequired = currentRequired.has(key);
        const isRequired = selectedRequired.has(key);

        if (!inCurrent && inSelected) {
          return (
            <div key={key} className="flex items-center gap-2">
              <Plus className="h-3.5 w-3.5 text-green-500 shrink-0" />
              <span className="text-[13px] font-medium text-gray-900">{key}</span>
              <span className="text-[11px] text-gray-400">({selectedType})</span>
              <span className="text-[10px] font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded">Added</span>
              {isRequired && (
                <span className="text-[10px] font-medium text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">Required</span>
              )}
            </div>
          );
        }

        if (inCurrent && !inSelected) {
          return (
            <div key={key} className="flex items-center gap-2">
              <Minus className="h-3.5 w-3.5 text-red-400 shrink-0" />
              <span className="text-[13px] font-medium text-gray-900 line-through">{key}</span>
              <span className="text-[11px] text-gray-400">({currentType})</span>
              <span className="text-[10px] font-medium text-red-700 bg-red-100 px-1.5 py-0.5 rounded">Removed</span>
            </div>
          );
        }

        const changed = JSON.stringify(currentProps[key]) !== JSON.stringify(selectedProps[key]) || wasRequired !== isRequired;
        if (!changed) return null;

        return (
          <div key={key} className="flex items-center gap-2">
            <ArrowRight className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <span className="text-[13px] font-medium text-gray-900">{key}</span>
            {currentType !== selectedType && (
              <>
                <span className="text-[11px] text-gray-400">({currentType})</span>
                <ArrowRight className="h-3 w-3 text-gray-300" />
                <span className="text-[11px] text-gray-400">({selectedType})</span>
              </>
            )}
            {wasRequired !== isRequired && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded
                ${isRequired ? "text-blue-700 bg-blue-100" : "text-gray-600 bg-gray-100"}`}>
                {isRequired ? "Required" : "Optional"}
              </span>
            )}
            <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">Modified</span>
          </div>
        );
      })}
    </div>
  );
}

function countInputDiff(a: CommandInput[], b: CommandInput[]): number {
  const aNames = new Set(a.map((i) => i.name));
  const bNames = new Set(b.map((i) => i.name));
  let count = 0;
  for (const name of aNames) if (!bNames.has(name)) count++;
  for (const name of bNames) if (!aNames.has(name)) count++;
  for (const name of aNames) {
    if (bNames.has(name)) {
      const ai = a.find((i) => i.name === name);
      const bi = b.find((i) => i.name === name);
      if (JSON.stringify(ai) !== JSON.stringify(bi)) count++;
    }
  }
  return count || 1;
}

function InputsDiff({ current, selected }: { current: CommandInput[]; selected: CommandInput[] }) {
  const currentMap = new Map(current.map((i) => [i.name, i]));
  const selectedMap = new Map(selected.map((i) => [i.name, i]));
  const allNames = [...new Set([...currentMap.keys(), ...selectedMap.keys()])];

  return (
    <div className="flex flex-wrap gap-2">
      {allNames.map((name) => {
        const inCurrent = currentMap.has(name);
        const inSelected = selectedMap.has(name);
        const inp = selectedMap.get(name) ?? currentMap.get(name);
        const type = inp?.type ?? "string";

        if (inCurrent && !inSelected) {
          return (
            <div key={name} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50">
              <Minus className="h-3 w-3 text-red-400" />
              <span className="text-[12px] font-medium text-gray-800">{name}</span>
              <span className="text-[11px] text-gray-400">({type})</span>
              <span className="text-[10px] font-medium text-red-700 bg-red-100 px-1.5 py-0.5 rounded">Removed</span>
            </div>
          );
        }

        if (!inCurrent && inSelected) {
          return (
            <div key={name} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green-200 bg-green-50">
              <Plus className="h-3 w-3 text-green-500" />
              <span className="text-[12px] font-medium text-gray-800">{name}</span>
              <span className="text-[11px] text-gray-400">({type})</span>
              <span className="text-[10px] font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded">Added</span>
            </div>
          );
        }

        const changed = JSON.stringify(currentMap.get(name)) !== JSON.stringify(selectedMap.get(name));
        return (
          <div key={name} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border
            ${changed ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"}`}>
            <span className="text-[12px] font-medium text-gray-800">{name}</span>
            <span className="text-[11px] text-gray-400">({type})</span>
            {changed ? (
              <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">Modified</span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-gray-500">
                <CheckCircle2 className="h-3 w-3 text-gray-400" /> Unchanged
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
