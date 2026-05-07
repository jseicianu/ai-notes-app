"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Plus,
  X,
  Sparkles,
  Type,
  Heading1,
  CheckSquare,
  Table,
  ChevronDown,
  ToggleLeft,
  SlidersHorizontal,
  Braces,
  MoreHorizontal,
} from "lucide-react";
import { DuotoneIcon } from "@/components/ui/duotone-icon";
import { BlockTypePicker } from "./block-type-picker";

const QUICK_TYPES = [
  { type: "ai_cell", label: "AI Cell", icon: Sparkles, key: "A" },
  { type: "text", label: "Text", icon: Type, key: "T" },
  { type: "heading_1", label: "Heading", icon: Heading1, key: "H" },
  { type: "todo", label: "To-do", icon: CheckSquare, key: "D" },
  { type: "table", label: "Table", icon: Table, key: "B" },
  { type: "input_select", label: "Dropdown", icon: ChevronDown, key: "S" },
  { type: "input_checkbox", label: "Checkbox", icon: ToggleLeft, key: "C" },
  { type: "input_slider", label: "Slider", icon: SlidersHorizontal, key: "L" },
  { type: "json", label: "JSON", icon: Braces, key: "J" },
] as const;

interface AddBlockStripProps {
  onAdd: (type: string) => void;
}

export function AddBlockStrip({ onAdd }: AddBlockStripProps) {
  const [open, setOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setShowMore(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (stripRef.current && !stripRef.current.contains(e.target as Node)) {
        close();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, close]);

  const handleSelect = useCallback(
    (type: string) => {
      onAdd(type);
      close();
    },
    [onAdd, close]
  );

  return (
    <div ref={stripRef} className="relative flex items-center justify-center h-5 my-1.5">
      {/* Resting state: full-width clickable zone */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="absolute inset-0 z-10 flex items-center justify-center
                     cursor-pointer group/line"
        >
          <div className="absolute inset-x-0 top-1/2 h-px bg-transparent
                          group-hover/add:bg-gray-300 transition-colors duration-150" />
          <div className="relative h-5 w-5 rounded-full
                          bg-transparent text-transparent
                          group-hover/add:bg-[#4a9ece] group-hover/add:text-white
                          flex items-center justify-center transition-all">
            <Plus className="h-3 w-3" />
          </div>
        </button>
      )}

      {/* Expanded strip */}
      {open && (
        <div
          className="relative z-20 flex items-center gap-0.5 bg-white border border-gray-200
                     shadow-sm px-1 py-1
                     animate-in fade-in zoom-in-95 duration-150"
        >
          {QUICK_TYPES.map(({ type, label, icon: Icon, key }) => (
            <button
              key={type}
              onClick={() => handleSelect(type)}
              className="flex flex-col items-center gap-0.5 px-2.5 py-1.5
                         hover:bg-gray-50 transition-colors cursor-pointer rounded-sm group/item"
            >
              <DuotoneIcon icon={Icon} size={16} />
              <span className="text-[10px] leading-none font-medium text-gray-600">{label}</span>
              <span className="text-[9px] leading-none text-gray-300 group-hover/item:text-gray-400">
                {key}
              </span>
            </button>
          ))}

          {/* Divider */}
          <div className="w-px h-8 bg-gray-200 mx-0.5" />

          {/* More */}
          <div className="relative">
            <button
              onClick={() => setShowMore(!showMore)}
              className="flex flex-col items-center gap-0.5 px-2.5 py-1.5
                         text-gray-500 hover:text-gray-900 hover:bg-gray-50
                         transition-colors cursor-pointer rounded-sm"
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="text-[10px] leading-none font-medium">More</span>
            </button>
            {showMore && (
              <div className="absolute right-0 top-full mt-1 z-50">
                <BlockTypePicker
                  onSelect={handleSelect}
                  onClose={() => setShowMore(false)}
                />
              </div>
            )}
          </div>

          {/* Close */}
          <button
            onClick={close}
            className="flex items-center justify-center w-6 h-6 ml-0.5
                       text-gray-400 hover:text-gray-600 hover:bg-gray-100
                       transition-colors cursor-pointer rounded-sm"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
