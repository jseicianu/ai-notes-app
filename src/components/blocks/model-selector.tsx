"use client";

import { useState, useRef, useEffect, useLayoutEffect, memo, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import {
  Anthropic,
  OpenAI,
  Google,
  Ollama,
  Meta,
  Mistral,
  DeepSeek,
} from "@lobehub/icons";

const MODELS = [
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", Icon: Anthropic },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic", Icon: Anthropic },
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", Icon: OpenAI },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", Icon: OpenAI },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google", Icon: Google },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "deepseek", Icon: DeepSeek },
  { id: "mistral-large", name: "Mistral Large", provider: "mistral", Icon: Mistral },
  { id: "llama-3.3-70b", name: "Llama 3.3 70B", provider: "meta", Icon: Meta },
  { id: "local-ollama", name: "Local (Ollama)", provider: "local", Icon: Ollama },
] as const;

type ModelEntry = (typeof MODELS)[number];

interface ModelSelectorProps {
  value?: string;
  onChange?: (modelId: string, provider: string) => void;
}

export const ModelSelector = memo(function ModelSelector({
  value,
  onChange,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected: ModelEntry =
    MODELS.find((m) => m.id === value) ?? MODELS[0];

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;

    const updatePosition = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const menuWidth = 264;
      const menuHeight = 332;
      const gap = 4;
      const margin = 8;
      const openUp = rect.bottom + gap + menuHeight > window.innerHeight - margin;
      const top = openUp
        ? Math.max(margin, rect.top - gap - menuHeight)
        : Math.min(rect.bottom + gap, window.innerHeight - margin - menuHeight);
      const left = Math.max(
        margin,
        Math.min(window.innerWidth - margin - menuWidth, rect.right - menuWidth)
      );

      setMenuStyle({ position: "fixed", top, left, width: menuWidth });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const menu = open && menuStyle && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="z-[1000] bg-white border border-gray-200 rounded-lg shadow-lg"
        >
          <div className="py-1 max-h-80 overflow-y-auto">
            {MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => {
                  onChange?.(model.id, model.provider);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-[13px]
                  transition-colors cursor-pointer ${
                    selected.id === model.id
                      ? "bg-gray-50 text-gray-900 font-medium"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
              >
                <model.Icon size={18} />
                <span>{model.name}</span>
                {selected.id === model.id && (
                  <Check className="ml-auto h-4 w-4 text-blue-500 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(!open)}
        className={`h-8 px-3 flex items-center gap-2 rounded-md border
                   text-[13px] font-medium transition-colors cursor-pointer
                   ${open
                     ? "border-gray-400 bg-gray-50 text-gray-800"
                     : "border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50"}`}
      >
        <selected.Icon size={16} />
        <span>{selected.name}</span>
        <ChevronDown className={`h-3 w-3 text-gray-400 transition-transform duration-150
          ${open ? "rotate-180" : ""}`} />
      </button>
      {menu}
    </div>
  );
});
