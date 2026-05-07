"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface InputSettingsProps {
  inputType: string;
  variableName: string;
  config: Record<string, unknown>;
  onUpdate: (changes: Record<string, unknown>) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
  anchorRect?: { bottom: number; left: number };
}

export function InputSettingsPopover({
  inputType,
  variableName,
  config,
  onUpdate,
  onClose,
  anchorRef,
  anchorRect,
}: InputSettingsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [newOption, setNewOption] = useState("");

  useLayoutEffect(() => {
    const popover = ref.current;
    const canvas = document.querySelector<HTMLElement>("[data-notebook-canvas]");
    if (!popover) return;

    const rect = anchorRect ?? anchorRef?.current?.getBoundingClientRect();
    if (!rect) return;

    const originTop = rect.bottom + 4;
    const originLeft = rect.left;
    const originScrollTop = canvas?.scrollTop ?? 0;
    const originScrollLeft = canvas?.scrollLeft ?? 0;

    const updatePosition = () => {
      const scrollDeltaY = (canvas?.scrollTop ?? 0) - originScrollTop;
      const scrollDeltaX = (canvas?.scrollLeft ?? 0) - originScrollLeft;
      popover.style.top = `${originTop - scrollDeltaY}px`;
      popover.style.left = `${originLeft - scrollDeltaX}px`;
    };

    updatePosition();
    popover.style.visibility = "visible";
    canvas?.addEventListener("scroll", updatePosition, { passive: true });

    return () => {
      canvas?.removeEventListener("scroll", updatePosition);
    };
  }, [anchorRef, anchorRect]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [anchorRef, onClose]);

  const options = (config.options as string[]) || [];

  const updateConfig = (key: string, value: unknown) => {
    onUpdate({ config: { ...config, [key]: value } });
  };

  const addOption = () => {
    const trimmed = newOption.trim();
    if (!trimmed || options.includes(trimmed)) return;
    updateConfig("options", [...options, trimmed]);
    setNewOption("");
  };

  const removeOption = (opt: string) => {
    updateConfig("options", options.filter((o) => o !== opt));
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const canvas = document.querySelector<HTMLElement>("[data-notebook-canvas]");
    if (!canvas) return;

    e.preventDefault();
    canvas.scrollBy({
      top: e.deltaY,
      left: e.deltaX,
      behavior: "auto",
    });
  };

  const content = (
    <div
      ref={ref}
      className="fixed z-[100] w-72 bg-white border border-gray-200 rounded-lg shadow-lg
                 "
      onWheel={handleWheel}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <span className="text-[12px] font-semibold text-gray-700">Settings</span>
        <button
          onClick={onClose}
          className="h-5 w-5 flex items-center justify-center text-gray-400
                     hover:text-gray-600 transition-colors cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-4 py-3 flex flex-col gap-3.5">
        {/* Variable name */}
        <Field label="Variable name">
          <input
            type="text"
            value={variableName}
            onChange={(e) =>
              onUpdate({ variable_name: e.target.value.replace(/\s+/g, "_").toLowerCase() })
            }
            className="w-full px-2.5 py-1.5 text-[13px] font-mono border border-gray-200 rounded-md
                       bg-white outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200
                       transition-colors"
          />
        </Field>

        {/* Display label */}
        <Field label="Display label">
          <input
            type="text"
            value={(config.label as string) || ""}
            onChange={(e) => updateConfig("label", e.target.value)}
            placeholder="Optional label shown above control"
            className="w-full px-2.5 py-1.5 text-[13px] border border-gray-200 rounded-md
                       bg-white outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200
                       transition-colors placeholder:text-gray-300"
          />
        </Field>

        {/* Placeholder — text inputs */}
        {inputType === "text" && (
          <Field label="Placeholder">
            <input
              type="text"
              value={(config.placeholder as string) || ""}
              onChange={(e) => updateConfig("placeholder", e.target.value)}
              placeholder="Enter text..."
              className="w-full px-2.5 py-1.5 text-[13px] border border-gray-200 rounded-md
                         bg-white outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200
                         transition-colors placeholder:text-gray-300"
            />
          </Field>
        )}

        {/* Options — select inputs */}
        {inputType === "select" && (
          <Field label="Options">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {options.map((opt) => (
                <span
                  key={opt}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[12px]
                             bg-gray-100 border border-gray-200 rounded-md text-gray-700"
                >
                  {opt}
                  <button
                    onClick={() => removeOption(opt)}
                    className="text-gray-400 hover:text-gray-600 cursor-pointer"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newOption}
                onChange={(e) => setNewOption(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addOption()}
                placeholder="Add option..."
                className="flex-1 px-2.5 py-1.5 text-[13px] border border-gray-200 rounded-md
                           bg-white outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200
                           transition-colors placeholder:text-gray-300"
              />
              <button
                onClick={addOption}
                disabled={!newOption.trim()}
                className="px-2.5 py-1.5 text-[12px] font-medium text-gray-600 bg-gray-100
                           border border-gray-200 rounded-md hover:bg-gray-200
                           disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </Field>
        )}

        {/* Default value — select inputs */}
        {inputType === "select" && options.length > 0 && (
          <Field label="Default value">
            <select
              value={(config.defaultValue as string) || ""}
              onChange={(e) => updateConfig("defaultValue", e.target.value)}
              className="w-full px-2.5 py-1.5 text-[13px] border border-gray-200 rounded-md
                         bg-white outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200
                         transition-colors cursor-pointer"
            >
              <option value="">None</option>
              {options.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </Field>
        )}

        {/* Min / Max / Step — number and slider */}
        {(inputType === "number" || inputType === "slider") && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Min">
              <input
                type="number"
                value={(config.min as number) ?? 0}
                onChange={(e) => updateConfig("min", parseFloat(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 text-[13px] border border-gray-200 rounded-md
                           bg-white outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200
                           transition-colors"
              />
            </Field>
            <Field label="Max">
              <input
                type="number"
                value={(config.max as number) ?? 100}
                onChange={(e) => updateConfig("max", parseFloat(e.target.value) || 100)}
                className="w-full px-2.5 py-1.5 text-[13px] border border-gray-200 rounded-md
                           bg-white outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200
                           transition-colors"
              />
            </Field>
            {inputType === "slider" && (
              <Field label="Step">
                <input
                  type="number"
                  value={(config.step as number) ?? 1}
                  onChange={(e) => updateConfig("step", parseFloat(e.target.value) || 1)}
                  className="w-full px-2.5 py-1.5 text-[13px] border border-gray-200 rounded-md
                             bg-white outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200
                             transition-colors"
                />
              </Field>
            )}
          </div>
        )}

        {/* Checkbox label */}
        {inputType === "checkbox" && (
          <Field label="Checkbox label">
            <input
              type="text"
              value={(config.checkboxLabel as string) || ""}
              onChange={(e) => updateConfig("checkboxLabel", e.target.value)}
              placeholder="Checked"
              className="w-full px-2.5 py-1.5 text-[13px] border border-gray-200 rounded-md
                         bg-white outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200
                         transition-colors placeholder:text-gray-300"
            />
          </Field>
        )}

        {/* Allow empty — only for types where "empty" is meaningful */}
        {(inputType === "text" || inputType === "select" || inputType === "date") && (
          <Toggle
            label="Allow empty value"
            checked={Boolean(config.allowEmpty)}
            onChange={(v) => updateConfig("allowEmpty", v)}
          />
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-[12px] text-gray-600">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-8 h-[18px] rounded-full transition-colors cursor-pointer ${
          checked ? "bg-cell-accent" : "bg-gray-200"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm
                      transition-transform ${checked ? "translate-x-3.5" : ""}`}
        />
      </button>
    </label>
  );
}
