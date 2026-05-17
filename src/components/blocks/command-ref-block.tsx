"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Play,
  Loader2,
  AlertCircle,
  ChevronDown,
  X,
  Plus,
  Clock,
} from "lucide-react";
import Markdown from "react-markdown";
import { createClient } from "@/lib/supabase/client";
import type { Block, Command, CommandInput } from "@/lib/models/types";
import { isSourceInput, getSourceConfig } from "@/lib/models/types";
import { validateInputs, type InputValidationError } from "@/lib/validate-inputs";
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
  onSchedule?: (config: {
    inputValues: Record<string, unknown>;
    sourceRefs: SourceReference[];
  }) => void;
  pageBlocks?: Block[];
}

type RunState = null | "running" | "completed" | "failed";

function InputField({
  input,
  value,
  onChange,
  error,
}: {
  input: CommandInput;
  value: unknown;
  onChange: (val: unknown) => void;
  error?: string;
}) {
  const label = input.description || input.name.replace(/_/g, " ");
  const v = input.validation;
  const borderColor = error ? "border-red-300" : "border-gray-200";

  if (input.type === "boolean") {
    return (
      <div className={`flex items-center h-9 rounded-md border bg-white ${borderColor}`}>
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
      <div className="relative" title={error || undefined}>
        <div className={`flex items-center h-9 rounded-md border bg-white ${borderColor}`}>
          <span className={`px-3 text-[12px] shrink-0 border-r border-gray-200 h-full flex items-center whitespace-nowrap ${error ? "text-red-400" : "text-gray-500"}`}>
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
      </div>
    );
  }

  if (input.type === "number") {
    const rangeHint = v?.min !== undefined || v?.max !== undefined
      ? `${v.min ?? "–∞"}–${v.max ?? "∞"}`
      : input.min !== undefined || input.max !== undefined
        ? `${input.min ?? "–∞"}–${input.max ?? "∞"}`
        : null;

    return (
      <div className="relative" title={error || undefined}>
        <div className={`flex items-center h-9 rounded-md border bg-white ${borderColor}`}>
          <span className={`px-3 text-[12px] shrink-0 border-r border-gray-200 h-full flex items-center whitespace-nowrap ${error ? "text-red-400" : "text-gray-500"}`}>
            {label}
          </span>
          <input
            type="number"
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) =>
              onChange(e.target.value === "" ? "" : Number(e.target.value))
            }
            min={v?.min ?? input.min}
            max={v?.max ?? input.max}
            size={Math.max(3, String(value ?? "").length)}
            className="h-9 pl-2 pr-1 text-[13px] font-semibold text-gray-900
                       bg-transparent outline-none text-center"
          />
          {rangeHint && (
            <span className="text-[10px] text-gray-400 pr-2 shrink-0">{rangeHint}</span>
          )}
        </div>
      </div>
    );
  }

  const strVal = (value as string) || "";
  const maxLen = v?.maxLength;

  return (
    <div className="relative" title={error || undefined}>
      <div className={`flex items-center h-9 rounded-md border bg-white ${borderColor}`}>
        <span className={`px-3 text-[12px] shrink-0 border-r border-gray-200 h-full flex items-center whitespace-nowrap ${error ? "text-red-400" : "text-gray-500"}`}>
          {label}
        </span>
        <input
          type="text"
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          placeholder={input.default_value || ""}
          className="flex-1 h-9 px-3 text-[13px] font-semibold text-gray-900
                     bg-transparent outline-none placeholder:text-gray-300 placeholder:font-normal min-w-[80px]"
        />
        {maxLen !== undefined && (
          <span className={`text-[10px] pr-2 shrink-0 tabular-nums ${strVal.length > maxLen ? "text-red-500" : "text-gray-400"}`}>
            {strVal.length}/{maxLen}
          </span>
        )}
      </div>
    </div>
  );
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  file: "File", url: "Web Page", block: "Block", paste: "Pasted Text",
};

export function CommandRefBlock({ block, onUpdate, onRunComplete, onRunningChange, onSchedule, pageBlocks = [] }: CommandRefBlockProps) {
  const commandId = block.content?.command_id as string | undefined;
  const commandName = block.content?.command_name as string | undefined;
  const commandSlug = block.content?.command_slug as string | undefined;

  const supabase = useMemo(() => createClient(), []);
  const [command, setCommand] = useState<Command | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, unknown>>(
    (block.content?.inputs as Record<string, unknown>) || {}
  );
  const [runState, setRunState] = useState<RunState>(null);
  const [showRunMenu, setShowRunMenu] = useState(false);
  const [outputText, setOutputText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<SourceItem[]>(
    (block.content?.sources as SourceItem[]) || []
  );
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

  const updateSources = useCallback(
    (sources: SourceItem[]) => {
      setSelectedSources(sources);
      setTimeout(() => onUpdate({ ...block.content, sources }), 0);
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
      const existingOutputBlocks = pageBlocks
        .filter((b) => b.parent_block_id === block.id)
        .map((b) => ({ id: b.id, type: b.type }));

      const res = await fetch("/api/ai/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandId: command.id,
          inputs: stringInputs,
          sources: sourceRefs,
          existingOutputBlocks,
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
  }, [command, inputValues, selectedSources, pageBlocks, block, onRunComplete, onRunningChange]);

  useEffect(() => {
    if (!outerRef.current || !innerRef.current) return;
    const inner = innerRef.current;
    const outer = outerRef.current;
    const height = inner.scrollHeight;
    outer.style.height = `${height}px`;
  }, [outputText, runState, error]);

  const isRunning = runState === "running";
  const hasOutput = runState === "completed" || runState === "failed";
  const showOutput = isRunning || hasOutput;

  const sourceInputs = command?.inputs.filter(isSourceInput) ?? [];
  const paramInputs = command?.inputs.filter((i) => !isSourceInput(i)) ?? [];
  const hasSourceConfig = !!sourceConfig?.required;
  const hasInputs = hasSourceConfig || sourceInputs.length > 0 || paramInputs.length > 0;

  const inputErrors = useMemo<InputValidationError[]>(() => {
    if (!command) return [];
    return validateInputs(command.inputs, inputValues);
  }, [command, inputValues]);

  const errorsByName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const err of inputErrors) map[err.inputName] = err.message;
    return map;
  }, [inputErrors]);

  const hasValidationErrors = inputErrors.length > 0;

  if (!commandId) {
    return (
      <div className="px-4 py-6 text-center text-[12px] text-gray-400 italic">
        No command linked to this block.
      </div>
    );
  }

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
          <div className="flex items-center shrink-0 ml-4 relative">
            <button
              onClick={handleRun}
              disabled={!command || isRunning || !!sourcesMissing || hasValidationErrors}
              className="h-9 px-4 flex items-center gap-1.5 rounded-l-md
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
            <button
              onClick={() => setShowRunMenu(!showRunMenu)}
              className="h-9 w-7 flex items-center justify-center rounded-r-md
                         bg-blue-500 hover:bg-blue-600 border-l border-white/20
                         transition-colors cursor-pointer"
            >
              <ChevronDown className="h-3 w-3 text-white" />
            </button>
            {showRunMenu && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200
                              rounded-md shadow-lg py-1 z-50">
                <button
                  onClick={() => {
                    if (!onSchedule || sourcesMissing || hasValidationErrors) return;
                    setShowRunMenu(false);
                    onSchedule?.({
                      inputValues,
                      sourceRefs: selectedSources.map((source) => source.ref),
                    });
                  }}
                  disabled={!onSchedule || !!sourcesMissing || hasValidationErrors}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors
                    ${onSchedule && !sourcesMissing && !hasValidationErrors
                      ? "text-gray-700 hover:bg-gray-50 cursor-pointer"
                      : "text-gray-300 cursor-not-allowed"}`}
                >
                  <Clock className="h-4 w-4" />
                  Schedule Run
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Divider between description and inputs */}
      {hasInputs && <div className="mx-5 border-t border-gray-100" />}

      {/* Inputs — horizontal strip with inline source chips */}
      {hasInputs && (
        <div className="relative px-5 py-4" ref={sourcePickerRef}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[13px] font-semibold text-gray-500 shrink-0">Inputs</span>

            {/* Source chips — inline pills */}
            {hasSourceConfig && selectedSources.map((source, i) => {
              const refBlock = source.ref.type === "block"
                ? pageBlocks.find((b) => b.id === (source.ref as { type: "block"; blockId: string }).blockId)
                : null;
              const label = refBlock
                ? (SOURCE_TYPE_LABELS[refBlock.type] || refBlock.type)
                : source.label;
              const blockType = refBlock?.type || source.sourceType;

              return (
                <div
                  key={`source-${i}`}
                  className="inline-flex items-center gap-1.5 h-9 pl-2 pr-1.5 rounded-lg bg-blue-50 border border-blue-200"
                >
                  <BlockTypeIcon blockType={blockType} />
                  <span className="text-[13px] font-medium text-blue-600 truncate max-w-[160px]">
                    {label}
                  </span>
                  <span
                    onClick={() => updateSources(selectedSources.filter((_, j) => j !== i))}
                    className="h-5 w-5 flex items-center justify-center rounded-full
                               text-gray-400 hover:text-gray-600 hover:bg-blue-100
                               cursor-pointer ml-0.5"
                  >
                    <X className="h-3 w-3" />
                  </span>
                </div>
              );
            })}

            {/* Add source button — when sourceConfig exists */}
            {hasSourceConfig && (
              <div>
                <button
                  onClick={() => setShowSourcePicker(!showSourcePicker)}
                  title={sourcesMissing ? "Source is required" : undefined}
                  className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md border transition-all cursor-pointer
                             ${selectedSources.length > 0
                               ? "border-dashed border-blue-300 text-blue-500 hover:border-blue-400 hover:bg-blue-50/50"
                               : sourcesMissing
                                 ? "border-dashed border-red-300 text-red-400 hover:border-red-400 hover:bg-red-50/50"
                                 : "border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:bg-gray-50"
                             }`}
                >
                  <Plus className="h-3 w-3" />
                  <span className="text-[12px] font-medium">Source</span>
                </button>
              </div>
            )}

            {/* Legacy source references — only when no sourceConfig */}
            {!hasSourceConfig && sourceInputs.map((input) => (
              <div key={input.name} title={errorsByName[input.name] || undefined}
                className={errorsByName[input.name] ? "[&_button]:!border-red-300 [&_button]:!text-red-400 [&_span]:!text-red-400 [&_svg]:!text-red-400" : ""}>
                <BlockReferencePicker
                  value={(inputValues[input.name] as string) || null}
                  onChange={(blockId) => updateInput(input.name, blockId)}
                  onClear={() => updateInput(input.name, "")}
                  blocks={pageBlocks}
                  excludeBlockIds={[block.id]}
                />
              </div>
            ))}

            {/* Parameter inputs — self-contained bordered boxes */}
            {paramInputs.map((input) => (
              <InputField
                key={input.name}
                input={input}
                value={inputValues[input.name]}
                onChange={(val) => updateInput(input.name, val)}
                error={errorsByName[input.name]}
              />
            ))}
          </div>


          {hasSourceConfig && showSourcePicker && (
            <div className="absolute left-5 top-full mt-1.5 z-[200]">
              <SourcePickerPopover
                sources={selectedSources}
                onSourcesChange={updateSources}
                pageBlocks={pageBlocks}
                onClose={() => setShowSourcePicker(false)}
                workspaceId={block.workspace_id}
                pageId={block.page_id}
                triggerBlockId={block.id}
                onSourceCardsReady={onRunComplete}
                onViewSourceCards={onRunComplete}
                acceptedTypes={sourceConfig!.accepted_types}
                excludeOutputBlocks={sourceConfig!.exclude_previous_outputs}
              />
            </div>
          )}
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
