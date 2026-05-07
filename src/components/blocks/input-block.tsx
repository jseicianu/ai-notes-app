"use client";

import { useState, useRef, useCallback } from "react";
import { Settings2 } from "lucide-react";
import { DuotoneIcon } from "@/components/ui/duotone-icon";
import { InputSettingsPopover } from "./input-settings-popover";
import type { Block } from "@/lib/models/types";

interface InputBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
}

export function InputBlock({ block, onUpdate }: InputBlockProps) {
  const inputType = (block.content?.input_type as string) || "text";
  const variableName = (block.content?.variable_name as string) || "input";
  const value = block.content?.value;
  const config = (block.content?.config as Record<string, unknown>) || {};
  const displayLabel = config.label as string | undefined;

  const [showSettings, setShowSettings] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);

  const updateValue = (newValue: unknown) => {
    onUpdate({ ...block.content, value: newValue });
  };

  const handleSettingsUpdate = (changes: Record<string, unknown>) => {
    const merged = { ...block.content, ...changes };

    if (inputType === "select" && changes.config) {
      const newOptions = ((changes.config as Record<string, unknown>).options as string[]) || [];
      const currentValue = merged.value as string;
      if (currentValue && !newOptions.includes(currentValue)) {
        merged.value = newOptions[0] || "";
      }
    }

    onUpdate(merged);
  };

  return (
    <div className="flex items-center gap-2.5">
      {/* Settings button */}
      <div className="relative">
        <button
          ref={settingsBtnRef}
          onClick={() => setShowSettings((open) => !open)}
          className={`h-7 w-7 flex items-center justify-center rounded-md border
                      transition-colors cursor-pointer ${
                        showSettings
                          ? "border-gray-300 bg-gray-100 text-gray-600"
                          : "border-gray-200 bg-white text-gray-400 hover:text-gray-600 hover:border-gray-300"
                      }`}
        >
          <DuotoneIcon icon={Settings2} size={14} fillClass="text-gray-200" strokeClass="text-gray-500" />
        </button>

        {showSettings && (
          <InputSettingsPopover
            inputType={inputType}
            variableName={variableName}
            config={config}
            onUpdate={handleSettingsUpdate}
            onClose={() => setShowSettings(false)}
            anchorRef={settingsBtnRef}
          />
        )}
      </div>

      {inputType === "text" && (
        <input
          type="text"
          value={(value as string) || ""}
          onChange={(e) => updateValue(e.target.value)}
          placeholder={(config.placeholder as string) || "Enter text..."}
          className="w-full max-w-sm px-3 py-1.5 text-sm border border-gray-200 rounded-md
                     bg-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                     transition-colors placeholder:text-gray-400"
        />
      )}

      {inputType === "number" && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={(value as number) ?? 0}
            onChange={(e) => updateValue(parseFloat(e.target.value) || 0)}
            min={config.min as number}
            max={config.max as number}
            className="w-28 px-3 py-1.5 text-sm border border-gray-200 rounded-md
                       bg-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                       transition-colors"
          />
          {config.min !== undefined && config.max !== undefined && (
            <span className="text-[11px] text-gray-400">
              {config.min as number}–{config.max as number}
            </span>
          )}
        </div>
      )}

      {inputType === "slider" && (
        <div className="flex items-center gap-3 max-w-sm flex-1">
          {displayLabel && (
            <span className="text-sm text-gray-600 shrink-0">{displayLabel}</span>
          )}
          <input
            type="range"
            value={(value as number) ?? 0}
            onChange={(e) => updateValue(parseFloat(e.target.value))}
            min={(config.min as number) ?? 0}
            max={(config.max as number) ?? 100}
            step={(config.step as number) ?? 1}
            className="flex-1 h-2 rounded-full appearance-none bg-gray-200 cursor-pointer
                       accent-blue-500"
          />
          <span className="text-sm font-medium text-gray-700 w-10 text-right tabular-nums">
            {value as number}
          </span>
        </div>
      )}

      {inputType === "checkbox" && (
        <CheckboxToggle
          checked={Boolean(value)}
          label={(config.checkboxLabel as string) || (displayLabel as string) || "Checked"}
          onToggle={() => updateValue(!Boolean(value))}
          onLabelChange={(newLabel) => {
            onUpdate({ ...block.content, config: { ...config, checkboxLabel: newLabel } });
          }}
        />
      )}

      {inputType === "select" && (
        <select
          value={(value as string) || ""}
          onChange={(e) => updateValue(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white
                     outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                     transition-colors cursor-pointer"
        >
          <option value="" disabled>Select...</option>
          {((config.options as string[]) || []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )}

      {inputType === "date" && (
        <input
          type="date"
          value={(value as string) || ""}
          onChange={(e) => updateValue(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white
                     outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                     transition-colors cursor-pointer
                     [&::-webkit-calendar-picker-indicator]:cursor-pointer"
        />
      )}
    </div>
  );
}

function CheckboxToggle({
  checked,
  label,
  onToggle,
  onLabelChange,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
  onLabelChange: (label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  const startEditing = useCallback(() => {
    setDraft(label);
    setEditing(true);
  }, [label]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    if (draft.trim() && draft !== label) {
      onLabelChange(draft.trim());
    }
  }, [draft, label, onLabelChange]);

  return (
    <div className="flex items-center gap-2.5">
      {editing ? (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(false); }}
          autoFocus
          className="text-sm text-gray-700 bg-transparent border-b border-blue-400 outline-none px-0 py-0"
        />
      ) : (
        <span
          onClick={startEditing}
          className="text-sm text-gray-600 cursor-text hover:text-gray-800 transition-colors"
        >
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 items-center rounded-full
                    transition-colors duration-200 cursor-pointer shrink-0
                    ${checked ? "bg-blue-500" : "bg-gray-300"}`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm
                      transition-transform duration-200
                      ${checked ? "translate-x-6" : "translate-x-1"}`}
        />
      </button>
    </div>
  );
}
