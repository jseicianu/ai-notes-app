"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Play,
  Loader2,
  AlertCircle,
  ChevronDown,
  X,
  Plus,
} from "lucide-react";
import Markdown from "react-markdown";
import { createClient } from "@/lib/supabase/client";
import type { Block, Command, CommandInput } from "@/lib/models/types";
import { isSourceInput, getSourceConfig } from "@/lib/models/types";
import { BlockReferencePicker } from "./block-reference-picker";
import { BlockTypeIcon } from "./block-wrapper";
import { SourcePickerPopover } from "./source-picker-popover";
import type { SourceItem } from "./source-picker-popover";
import type { SourceReference } from "@/services/source-service";

interface CommandRefBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
  onRunComplete?: () => Promise<void>;
  onRunningChange?: (running: boolean) => void;
  pageBlocks?: Block[];
}

type RunState = null | "running" | "completed" | "failed";

function InputField({
  input,
  value,
  onChange,
}: {
  input: CommandInput;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const label = input.description || input.name.replace(/_/g, " ");

  if (input.type === "boolean") {
    return (
      <div className="flex items-center h-9 rounded-md border border-gray-200 bg-white">
        <span className="px-3 text-[12px] text-gray-500 shrink-0 border-r border-gray-200 h-full flex items-center whitespace-nowrap">
          {label}
        </span>
        <div className="px-2.5 flex items-center">
          <button
            onClick={() => onChange(!Boolean(value))}
            className={`relative h-[20px] w-[36px] rounded-full transition-colors duration-200 cursor-pointer shrink-0
              ${Boolean(value) ? "bg-blue-500" : "bg-gray-300"}`}
          >
            <span
              className={`absolute top-[2px] left-[2px] h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-200
                ${Boolean(value) ? "translate-x-[16px]" : "translate-x-0"}`}
            />
          </button>
        </div>
      </div>
    );
  }

  if (input.options && input.options.length > 0) {
    return (
      <div className="flex items-center h-9 rounded-md border border-gray-200 bg-white">
        <span className="px-3 text-[12px] text-gray-500 shrink-0 border-r border-gray-200 h-full flex items-center whitespace-nowrap">
          {label}
        </span>
        <div className="relative flex items-center">
          <select
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            className="appearance-none h-9 pl-3 pr-7 text-[13px] font-semibold text-gray-900
                       bg-transparent outline-none cursor-pointer"
          >
            <option value="" disabled>Select...</option>
            {input.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
        </div>
      </div>
    );
  }

  if (input.type === "number") {
    return (
      <div className="flex items-center h-9 rounded-md border border-gray-200 bg-white">
        <span className="px-3 text-[12px] text-gray-500 shrink-0 border-r border-gray-200 h-full flex items-center whitespace-nowrap">
          {label}
        </span>
        <input
          type="number"
          value={(value as number) ?? ""}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          min={input.min}
          max={input.max}
          size={Math.max(3, String((value as number) ?? 0).length)}
          className="h-9 pl-2 pr-1 text-[13px] font-semibold text-gray-900
                     bg-transparent outline-none text-center"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center h-9 rounded-md border border-gray-200 bg-white">
      <span className="px-3 text-[12px] text-gray-500 shrink-0 border-r border-gray-200 h-full flex items-center whitespace-nowrap">
        {label}
      </span>
      <input
        type="text"
        value={(value as string) || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={input.default_value || ""}
        className="flex-1 h-9 px-3 text-[13px] font-semibold text-gray-900
                   bg-transparent outline-none placeholder:text-gray-300 placeholder:font-normal min-w-[80px]"
      />
    </div>
  );
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  file: "File", url: "Web Page", block: "Block", paste: "Pasted Text",
};

function SourceChip({
  source,
  onRemove,
  pageBlocks,
}: {
  source: SourceItem;
  onRemove: () => void;
  pageBlocks: Block[];
}) {
  const [showPreview, setShowPreview] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const block = source.ref.type === "block"
    ? pageBlocks.find((b) => b.id === (source.ref as { type: "block"; blockId: string }).blockId)
    : null;

  const blockType = block?.type || source.sourceType;
  const label = block
    ? SOURCE_TYPE_LABELS[block.type] || block.type
    : source.label;

  const handleMouseEnter = useCallback(() => {
    hoverTimer.current = setTimeout(() => setShowPreview(true), 300);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setShowPreview(false);
  }, []);

  useEffect(() => {
    return () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); };
  }, []);

  const previewText = block ? getContentPreview(block) : source.label;

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline-flex items-center gap-1.5 h-9 pl-2 pr-2.5 rounded-md border
                   border-blue-200 bg-white shadow-sm hover:border-blue-300 transition-all cursor-default"
      >
        <BlockTypeIcon blockType={blockType} />
        <span className="text-[12px] font-medium text-blue-700 truncate max-w-[160px]">
          {label}
        </span>
        <span
          onClick={onRemove}
          className="h-4 w-4 flex items-center justify-center rounded-full
                     text-blue-400 hover:text-blue-600 hover:bg-blue-100
                     transition-colors cursor-pointer ml-0.5"
        >
          <X className="h-2.5 w-2.5" />
        </span>
      </div>

      {showPreview && previewText && (
        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="absolute left-0 top-full mt-2 w-72 bg-white border border-gray-200
                     rounded-lg shadow-xl z-50 overflow-hidden
                     animate-in fade-in zoom-in-95 duration-200"
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50/50">
            <BlockTypeIcon blockType={blockType} />
            <span className="text-[12px] font-medium text-gray-700">{label}</span>
            <span className="text-[10px] text-gray-400 ml-auto">Preview</span>
          </div>
          <div className="px-3 py-2.5 max-h-40 overflow-y-auto">
            <p className="text-[12px] text-gray-600 leading-relaxed whitespace-pre-wrap line-clamp-8">
              {previewText}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function getContentPreview(block: Block, maxLen = 300): string {
  const c = block.content;
  if (!c) return "";
  switch (block.type) {
    case "text":
    case "heading":
    case "callout": {
      const doc = c.doc as string | undefined;
      return doc ? doc.replace(/<[^>]*>/g, "").trim().slice(0, maxLen) : ((c.text as string) || "").slice(0, maxLen);
    }
    case "table": {
      const cols = c.columns as string[] | undefined;
      const rows = c.rows as unknown[] | undefined;
      return cols ? `${cols.join(", ")} · ${rows?.length ?? 0} rows` : "Table";
    }
    case "todo": {
      const items = c.items as Array<{ text: string }> | undefined;
      return items ? items.map((i) => i.text).join("\n").slice(0, maxLen) : "";
    }
    case "json":
      return JSON.stringify(c.data, null, 2).slice(0, maxLen);
    case "ai_cell":
      return ((c.prompt as string) || "").slice(0, maxLen);
    default:
      return "";
  }
}

export function CommandRefBlock({ block, onUpdate, onRunComplete, onRunningChange, pageBlocks = [] }: CommandRefBlockProps) {
  const commandId = block.content?.command_id as string | undefined;
  const commandName = block.content?.command_name as string | undefined;
  const commandSlug = block.content?.command_slug as string | undefined;

  const supabase = useMemo(() => createClient(), []);
  const [command, setCommand] = useState<Command | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, unknown>>(
    (block.content?.inputs as Record<string, unknown>) || {}
  );
  const [runState, setRunState] = useState<RunState>(null);
  const [outputText, setOutputText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<SourceItem[]>([]);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const sourcePickerRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const sourceConfig = command ? getSourceConfig(command) : null;
  const sourcesMissing = sourceConfig?.required && selectedSources.length === 0;

  useEffect(() => {
    if (!showSourcePicker) return;
    function handleClick(e: MouseEvent) {
      if (sourcePickerRef.current && !sourcePickerRef.current.contains(e.target as Node)) {
        setShowSourcePicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSourcePicker]);

  useEffect(() => {
    if (!commandId) return;
    async function load() {
      const { data } = await supabase
        .from("commands")
        .select("*")
        .eq("id", commandId)
        .single();
      if (data) {
        const cmd = data as Command;
        setCommand(cmd);
        setInputValues((prev) => {
          const merged = { ...prev };
          for (const input of cmd.inputs) {
            if (merged[input.name] === undefined && input.default_value !== undefined) {
              merged[input.name] = input.default_value;
            }
          }
          return merged;
        });
      }
    }
    load();
  }, [commandId, supabase]);

  const updateInput = useCallback(
    (name: string, value: unknown) => {
      setInputValues((prev) => {
        const next = { ...prev, [name]: value };
        setTimeout(() => onUpdate({ ...block.content, inputs: next }), 0);
        return next;
      });
    },
    [block.content, onUpdate]
  );

  const handleRun = useCallback(async () => {
    if (!command) return;

    setRunState("running");
    setOutputText(null);
    setError(null);
    onRunningChange?.(true);

    try {
      const stringInputs: Record<string, string> = {};
      for (const [k, v] of Object.entries(inputValues)) {
        stringInputs[k] = String(v ?? "");
      }

      const sourceRefs: SourceReference[] = selectedSources.map((s) => s.ref);

      const res = await fetch("/api/ai/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandId: command.id,
          inputs: stringInputs,
          sources: sourceRefs,
          workspaceId: block.workspace_id,
          pageId: block.page_id,
          triggerBlockId: block.id,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload);
            if (event.type === "text-delta" && event.delta) {
              fullText += event.delta;
              setOutputText(fullText);
              setRunState("completed");
            }
          } catch {
            // skip non-JSON lines
          }
        }
      }

      onRunningChange?.(false);

      if (!fullText.trim()) {
        setRunState("failed");
        setError("No response received from the model");
      } else if (onRunComplete) {
        setTimeout(() => { onRunComplete(); }, 500);
      }
    } catch (err) {
      onRunningChange?.(false);
      setRunState("failed");
      setError(err instanceof Error ? err.message : "Command execution failed");
    }
  }, [command, inputValues, selectedSources, block, onRunComplete, onRunningChange]);

  useEffect(() => {
    if (!outerRef.current || !innerRef.current) return;
    const inner = innerRef.current;
    const outer = outerRef.current;
    const height = inner.scrollHeight;
    outer.style.height = `${height}px`;
  }, [outputText, runState, error]);

  if (!commandId) {
    return (
      <div className="px-4 py-6 text-center text-[12px] text-gray-400 italic">
        No command linked to this block.
      </div>
    );
  }

  const isRunning = runState === "running";
  const hasOutput = runState === "completed" || runState === "failed";
  const showOutput = isRunning || hasOutput;

  const sourceInputs = command?.inputs.filter(isSourceInput) ?? [];
  const paramInputs = command?.inputs.filter((i) => !isSourceInput(i)) ?? [];
  const hasSourceConfig = !!sourceConfig?.required;
  const hasInputs = hasSourceConfig || sourceInputs.length > 0 || paramInputs.length > 0;

  return (
    <div>
      {/* Command info — name, slug, description */}
      <div className="px-5 py-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5">
              <h3 className="text-[16px] font-bold text-gray-900">
                {commandName || command?.name || "Loading..."}
              </h3>
              {(commandSlug || command?.slug) && (
                <span className="text-[13px] font-mono text-gray-400">
                  /{commandSlug || command?.slug}
                </span>
              )}
            </div>
            {command?.description && (
              <p className="text-[13px] text-gray-500 mt-1.5 leading-relaxed">
                {command.description}
              </p>
            )}
          </div>
          <button
            onClick={handleRun}
            disabled={!command || isRunning || !!sourcesMissing}
            className="h-9 px-4 flex items-center gap-1.5 rounded-md shrink-0 ml-4
                       bg-blue-500 hover:bg-blue-600
                       transition-all cursor-pointer
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 text-white fill-white" />
            )}
            <span className="text-[13px] text-white font-semibold">
              {isRunning ? "Running..." : "Run"}
            </span>
          </button>
        </div>
      </div>

      {/* Divider between description and inputs */}
      {hasInputs && <div className="mx-5 border-t border-gray-100" />}

      {/* Inputs — horizontal strip with inline source chips */}
      {hasInputs && (
        <div className="px-5 py-4" ref={sourcePickerRef}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[13px] font-semibold text-gray-500 shrink-0">Inputs</span>

            {/* Source chips — stacked, fan out on hover */}
            {hasSourceConfig && selectedSources.length > 0 && (
              <div className="source-stack relative flex items-center">
                <style>{`
                  .source-stack > .source-card + .source-card { margin-left: -28px; transition: margin 200ms ease-out; }
                  .source-stack:hover > .source-card + .source-card { margin-left: 4px; }
                `}</style>
                {selectedSources.map((source, i) => (
                  <div
                    key={`source-${i}`}
                    className="source-card"
                    style={{ zIndex: i + 1 }}
                  >
                    <SourceChip
                      source={source}
                      onRemove={() => setSelectedSources((prev) => prev.filter((_, j) => j !== i))}
                      pageBlocks={pageBlocks}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Add source button — when sourceConfig exists */}
            {hasSourceConfig && (
              <div className="relative">
                <button
                  onClick={() => setShowSourcePicker(!showSourcePicker)}
                  className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md border transition-all cursor-pointer
                             ${selectedSources.length > 0
                               ? "border-dashed border-blue-300 text-blue-500 hover:border-blue-400 hover:bg-blue-50/50"
                               : "border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:bg-gray-50"
                             }`}
                >
                  <Plus className="h-3 w-3" />
                  <span className="text-[12px] font-medium">Source</span>
                </button>
                {showSourcePicker && (
                  <div className="absolute left-0 top-full mt-1.5 z-[200]">
                    <SourcePickerPopover
                      sources={selectedSources}
                      onSourcesChange={setSelectedSources}
                      pageBlocks={pageBlocks}
                      onClose={() => setShowSourcePicker(false)}
                      workspaceId={block.workspace_id}
                      triggerBlockId={block.id}
                      acceptedTypes={sourceConfig!.accepted_types}
                      excludeOutputBlocks={sourceConfig!.exclude_previous_outputs}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Legacy source references — only when no sourceConfig */}
            {!hasSourceConfig && sourceInputs.map((input) => (
              <BlockReferencePicker
                key={input.name}
                value={(inputValues[input.name] as string) || null}
                onChange={(blockId) => updateInput(input.name, blockId)}
                onClear={() => updateInput(input.name, "")}
                blocks={pageBlocks}
                excludeBlockIds={[block.id]}
              />
            ))}

            {/* Parameter inputs — self-contained bordered boxes */}
            {paramInputs.map((input) => (
              <InputField
                key={input.name}
                input={input}
                value={inputValues[input.name]}
                onChange={(val) => updateInput(input.name, val)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Output */}
      <div
        ref={outerRef}
        className="overflow-hidden transition-[height] duration-300 ease-out"
        style={{ height: showOutput ? undefined : 0 }}
      >
        <div ref={innerRef}>
          {showOutput && (
            <div className="border-t border-gray-200 bg-white">
              {isRunning && !outputText && (
                <div className="px-4 py-6 flex items-center justify-center">
                  <div className="flex items-center gap-2 text-[13px] text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                    Running command...
                  </div>
                </div>
              )}

              {hasOutput && (
                <div className="px-5 py-4">
                  {error ? (
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                      <span className="text-[13px] text-gray-700">{error}</span>
                    </div>
                  ) : (
                    <div className="ai-output text-[13px] text-gray-700 leading-relaxed select-text">
                      <Markdown>{outputText || ""}</Markdown>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
