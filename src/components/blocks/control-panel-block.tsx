"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Plus, X, ChevronDown, FileText, Globe, Type, ClipboardPaste } from "lucide-react";
import { SourcePickerPopover } from "./source-picker-popover";
import type { SourceItem } from "./source-picker-popover";
import type { Block } from "@/lib/models/types";

interface PanelInput {
  variable_name: string;
  input_type: "text" | "number" | "slider" | "checkbox" | "select" | "date" | "source";
  value: unknown;
  config: Record<string, unknown>;
}

interface ControlPanelBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
  embedded?: boolean;
  pageBlocks?: Block[];
}

const INPUT_TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "slider", label: "Slider" },
  { value: "checkbox", label: "Toggle" },
  { value: "select", label: "Dropdown" },
  { value: "date", label: "Date" },
  { value: "source", label: "Sources" },
] as const;

function getDefaultValue(type: string): unknown {
  switch (type) {
    case "checkbox": return false;
    case "number": return 50;
    case "slider": return 50;
    case "date": return new Date().toISOString().split("T")[0];
    case "source": return [];
    default: return "";
  }
}

function getDefaultConfig(type: string): Record<string, unknown> {
  switch (type) {
    case "slider": return { min: 0, max: 100, step: 1, description: "" };
    case "number": return { min: 0, max: 100, description: "" };
    case "select": return { options: ["Option 1", "Option 2", "Option 3"], description: "" };
    case "checkbox": return { label: "Enabled", description: "" };
    case "source": return { description: "Select sources for this command" };
    default: return { description: "" };
  }
}

export function ControlPanelBlock({ block, onUpdate, pageBlocks = [] }: ControlPanelBlockProps) {
  const inputs = useMemo(
    () => (block.content?.inputs as PanelInput[] | undefined) ?? [],
    [block.content?.inputs]
  );
  const [editingLabel, setEditingLabel] = useState<number | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const updateInputs = useCallback(
    (newInputs: PanelInput[]) => {
      onUpdate({ ...block.content, inputs: newInputs });
    },
    [block.content, onUpdate]
  );

  const updateInputValue = useCallback(
    (index: number, value: unknown) => {
      const newInputs = [...inputs];
      newInputs[index] = { ...newInputs[index], value };
      updateInputs(newInputs);
    },
    [inputs, updateInputs]
  );

  const updateInputLabel = useCallback(
    (index: number, name: string) => {
      const newInputs = [...inputs];
      newInputs[index] = {
        ...newInputs[index],
        variable_name: name.replace(/\s+/g, "_").toLowerCase(),
      };
      updateInputs(newInputs);
    },
    [inputs, updateInputs]
  );

  const addInput = useCallback(
    (type: string) => {
      const newInput: PanelInput = {
        variable_name: `var_${Date.now().toString(36).slice(-4)}`,
        input_type: type as PanelInput["input_type"],
        value: getDefaultValue(type),
        config: getDefaultConfig(type),
      };
      updateInputs([...inputs, newInput]);
    },
    [inputs, updateInputs]
  );

  const removeInput = useCallback(
    (index: number) => {
      updateInputs(inputs.filter((_, i) => i !== index));
    },
    [inputs, updateInputs]
  );

  if (inputs.length === 0) {
    return (
      <div className="px-4 py-6 flex flex-col items-center gap-2">
        <span className="text-[13px] text-gray-400">No controls yet</span>
        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium
                       text-blue-500 border border-blue-200 rounded-md
                       hover:bg-blue-50 transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Add control
          </button>
          {showAddMenu && (
            <AddMenu onAdd={(type) => { addInput(type); setShowAddMenu(false); }}
                     onClose={() => setShowAddMenu(false)} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="grid grid-cols-3 gap-x-6">
        {inputs.map((input, index) => (
          <div key={`${input.variable_name}-${index}`}
               className={`group/ctrl min-w-0 py-3 ${
                 index >= 3 ? "border-t border-gray-200" : ""
               }`}>
            {/* Label row */}
            <div className="flex items-center justify-between mb-1.5">
              {editingLabel === index ? (
                <input
                  type="text"
                  value={input.variable_name.replace(/_/g, " ")}
                  onChange={(e) => updateInputLabel(index, e.target.value)}
                  onBlur={() => setEditingLabel(null)}
                  onKeyDown={(e) => e.key === "Enter" && setEditingLabel(null)}
                  autoFocus
                  className="text-[12px] font-semibold text-gray-800 capitalize
                             bg-transparent border-b border-blue-400 outline-none min-w-0 flex-1"
                />
              ) : (
                <span
                  onClick={() => setEditingLabel(index)}
                  className="text-[12px] font-semibold text-gray-700 capitalize cursor-text
                             hover:text-gray-900 transition-colors truncate"
                >
                  {input.variable_name.replace(/_/g, " ")}
                </span>
              )}
              <button
                onClick={() => removeInput(index)}
                className="h-4 w-4 flex items-center justify-center rounded
                           text-gray-300 hover:text-red-500
                           opacity-0 group-hover/ctrl:opacity-100
                           transition-all cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            {/* Control */}
            <GridControl
              input={input}
              onValueChange={(value) => updateInputValue(index, value)}
              pageBlocks={pageBlocks}
              block={block}
            />

            {/* Description */}
            {(input.config.description as string) && (
              <p className="text-[11px] text-gray-400 mt-1 leading-snug">
                {input.config.description as string}
              </p>
            )}
          </div>
        ))}

        {/* Add button */}
        {inputs.length < 12 && (
          <div className="flex items-end relative">
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium
                         text-gray-400 border border-dashed border-gray-300 rounded-md
                         hover:text-blue-500 hover:border-blue-300
                         transition-colors cursor-pointer"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
            {showAddMenu && (
              <AddMenu onAdd={(type) => { addInput(type); setShowAddMenu(false); }}
                       onClose={() => setShowAddMenu(false)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AddMenu({ onAdd, onClose }: { onAdd: (type: string) => void; onClose: () => void }) {
  return (
    <div
      className="absolute left-0 top-full mt-1 w-36 border border-gray-200 bg-white
                 rounded-lg shadow-lg z-50 py-1 animate-in fade-in slide-in-from-top-1 duration-100"
      onMouseLeave={onClose}
    >
      {INPUT_TYPE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onAdd(opt.value)}
          className="flex w-full items-center px-3 py-1.5 text-[13px] text-gray-700
                     hover:bg-blue-50 hover:text-blue-600
                     cursor-pointer transition-colors"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const SOURCE_TYPE_ICONS_MAP = {
  file: FileText,
  url: Globe,
  block: Type,
  paste: ClipboardPaste,
};

function SourceControl({
  value,
  onValueChange,
  pageBlocks,
  block,
}: {
  value: unknown;
  onValueChange: (value: unknown) => void;
  pageBlocks: Block[];
  block: Block;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const sources = (Array.isArray(value) ? value : []) as SourceItem[];

  const uniqueTypes = Array.from(new Set(sources.map((s) => s.sourceType)));

  useEffect(() => {
    if (!showPicker) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showPicker]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setShowPicker(!showPicker)}
        className={`flex items-center w-full h-[34px] rounded-md border
                   transition-all cursor-pointer overflow-hidden
                   ${showPicker
                     ? "border-blue-400 ring-1 ring-blue-400/30"
                     : sources.length > 0
                       ? "border-blue-300 hover:border-blue-400"
                       : "border-gray-200 hover:border-gray-300"
                   }`}
      >
        {sources.length > 0 ? (
          <>
            <div className="flex items-center gap-1.5 px-2.5 h-full flex-1 min-w-0">
              <span className="text-[13px] font-medium text-blue-600 whitespace-nowrap">
                {sources.length} selected
              </span>
              <ChevronDown className="h-3 w-3 text-blue-400 shrink-0" />
            </div>
            <div className="flex items-center gap-1 px-2 h-full border-l border-blue-200">
              {uniqueTypes.map((type) => {
                const Icon = SOURCE_TYPE_ICONS_MAP[type];
                return (
                  <div
                    key={type}
                    className="h-5 w-5 rounded bg-blue-50 flex items-center justify-center"
                  >
                    <Icon className="h-3 w-3 text-blue-500" />
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 h-full w-full">
            <span className="text-[13px] text-gray-400">0 selected</span>
            <ChevronDown className="h-3 w-3 text-gray-300 shrink-0" />
          </div>
        )}
      </button>

      {showPicker && (
        <div ref={pickerRef} className="absolute left-0 top-full mt-1.5 z-[200]">
          <SourcePickerPopover
            sources={sources}
            onSourcesChange={(newSources) => onValueChange(newSources)}
            pageBlocks={pageBlocks}
            onClose={() => setShowPicker(false)}
            workspaceId={block.workspace_id}
            triggerBlockId={block.id}
          />
        </div>
      )}
    </div>
  );
}

function GridControl({
  input,
  onValueChange,
  pageBlocks,
  block,
}: {
  input: PanelInput;
  onValueChange: (value: unknown) => void;
  pageBlocks: Block[];
  block: Block;
}) {
  const { input_type, value, config } = input;

  if (input_type === "source") {
    return (
      <SourceControl
        value={value}
        onValueChange={onValueChange}
        pageBlocks={pageBlocks}
        block={block}
      />
    );
  }

  if (input_type === "select") {
    return (
      <select
        value={(value as string) || ""}
        onChange={(e) => onValueChange(e.target.value)}
        className="w-full px-2.5 py-1.5 text-[13px] border border-gray-200 rounded-md bg-white
                   outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                   transition-colors cursor-pointer"
      >
        {((config.options as string[]) || []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  if (input_type === "slider") {
    return (
      <div className="flex items-center gap-2">
        <input
          type="range"
          value={(value as number) ?? 0}
          onChange={(e) => onValueChange(parseFloat(e.target.value))}
          min={(config.min as number) ?? 0}
          max={(config.max as number) ?? 100}
          step={(config.step as number) ?? 1}
          className="flex-1 h-2 rounded-full appearance-none bg-gray-200 cursor-pointer accent-blue-500"
        />
        <span className="text-[13px] font-medium text-gray-700 w-10 text-right tabular-nums">
          {value as number}%
        </span>
      </div>
    );
  }

  if (input_type === "checkbox") {
    return (
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => onValueChange(!Boolean(value))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full shrink-0
                      transition-colors duration-200 cursor-pointer
                      ${Boolean(value) ? "bg-blue-500" : "bg-gray-300"}`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm
                        transition-transform duration-200
                        ${Boolean(value) ? "translate-x-6" : "translate-x-1"}`}
          />
        </button>
      </div>
    );
  }

  if (input_type === "number") {
    return (
      <input
        type="number"
        value={(value as number) ?? 0}
        onChange={(e) => onValueChange(parseFloat(e.target.value) || 0)}
        min={config.min as number}
        max={config.max as number}
        className="w-full px-2.5 py-1.5 text-[13px] border border-gray-200 rounded-md bg-white
                   outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                   transition-colors tabular-nums"
      />
    );
  }

  if (input_type === "date") {
    return (
      <input
        type="date"
        value={(value as string) || ""}
        onChange={(e) => onValueChange(e.target.value)}
        className="w-full px-2.5 py-1.5 text-[13px] border border-gray-200 rounded-md bg-white
                   outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                   transition-colors cursor-pointer"
      />
    );
  }

  // Text
  return (
    <input
      type="text"
      value={(value as string) || ""}
      onChange={(e) => onValueChange(e.target.value)}
      placeholder={(config.placeholder as string) || "Enter value..."}
      className="w-full px-2.5 py-1.5 text-[13px] border border-gray-200 rounded-md bg-white
                 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                 transition-colors placeholder:text-gray-400"
    />
  );
}
