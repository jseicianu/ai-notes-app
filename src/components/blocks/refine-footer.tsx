"use client";

import { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Play,
  Info,
  AlignLeft,
  MessageSquare,
  CheckSquare,
  Table2,
} from "lucide-react";

interface RefineFooterProps {
  parentBlockId: string;
  blockId: string;
  blockType: string;
}

const QUICK_ACTIONS = [
  { icon: AlignLeft, label: "Make shorter", action: "Make shorter" },
  { icon: MessageSquare, label: "Add citations", action: "Add citations" },
  { icon: CheckSquare, label: "Extract action items", action: "Extract action items" },
  { icon: Table2, label: "Turn into table", action: "Turn into table" },
] as const;

function dispatchRefine(parentBlockId: string, focusBlockId: string, focusBlockType: string, prompt: string) {
  window.dispatchEvent(
    new CustomEvent("cell-refine-request", {
      detail: { parentBlockId, focusBlockId, focusBlockType, prompt },
    })
  );
}

export function RefineFooter({ parentBlockId, blockId, blockType }: RefineFooterProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const trayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (trayRef.current && !trayRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const typeLabel =
    blockType === "table" ? "table"
    : blockType === "json" ? "JSON"
    : blockType === "todo" ? "to-do list"
    : "output";

  const handleSubmit = (text: string) => {
    if (!text.trim()) return;
    dispatchRefine(parentBlockId, blockId, blockType, `Refine the ${typeLabel}: ${text}`);
    setPrompt("");
    setOpen(false);
  };

  const handleQuickAction = (action: string) => {
    dispatchRefine(parentBlockId, blockId, blockType, `${action} in the ${typeLabel}`);
    setOpen(false);
  };

  return (
    <div ref={trayRef} className="border-t border-gray-100 px-4 py-1.5 flex items-center relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors cursor-pointer
                   ${open ? "text-blue-600" : "text-gray-400 hover:text-gray-600"}`}
      >
        <Sparkles className="h-3 w-3" />
        Refine
        {open ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
      </button>

      {open && (
        <div className="absolute left-3 top-full mt-1 z-[200] w-[380px]">
          <div className="absolute -top-[6px] left-5
                          w-3 h-3 rotate-45 bg-white border-l border-t border-gray-200 z-10" />

          <div className="relative bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
            <div className="px-4 pt-3.5 pb-3">
              <h4 className="text-[13px] font-semibold text-gray-900 mb-2.5">
                Refine this {typeLabel}
              </h4>
              <div className="flex items-center gap-2.5 border border-gray-200 rounded-lg px-3 py-2
                              focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400">
                <Sparkles className="h-3.5 w-3.5 text-gray-300 shrink-0" />
                <input
                  autoFocus
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && prompt.trim()) {
                      e.preventDefault();
                      handleSubmit(prompt);
                    }
                    if (e.key === "Escape") setOpen(false);
                  }}
                  placeholder="Describe a change..."
                  className="flex-1 text-[13px] text-gray-800 placeholder:text-gray-400 outline-none bg-transparent"
                />
              </div>
            </div>

            <div className="border-t border-gray-100">
              {QUICK_ACTIONS.map((item) => (
                <button
                  key={item.label}
                  onClick={() => handleQuickAction(item.action)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-gray-700
                             hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <item.icon className="h-4 w-4 text-gray-400 shrink-0" />
                  {item.label}
                </button>
              ))}
            </div>

            <div className="border-t border-gray-100 px-4 py-2.5 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <Info className="h-3 w-3" />
                Refines using original sources
              </div>
              <button
                onClick={() => handleSubmit(prompt)}
                disabled={!prompt.trim()}
                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-blue-500
                           hover:bg-blue-600 transition-colors cursor-pointer
                           disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-medium"
              >
                Run
                <Play className="h-3 w-3 fill-white" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
