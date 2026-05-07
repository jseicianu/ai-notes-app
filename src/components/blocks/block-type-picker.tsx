"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  Sparkles,
  Table,
  Braces,
  CheckSquare,
  Minus,
  List,
  ListOrdered,
  MessageSquareQuote,
  TextCursorInput,
  Hash,
  SlidersHorizontal,
  ToggleLeft,
  ChevronDown,
  CalendarDays,
  LayoutDashboard,
} from "lucide-react";
import type { BlockType } from "@/lib/models/types";

interface BlockTypeOption {
  type: BlockType | "heading_1" | "heading_2" | "heading_3" | "input_text" | "input_number" | "input_slider" | "input_checkbox" | "input_select" | "input_date";
  label: string;
  icon: React.ReactNode;
  description: string;
  category: "basic" | "ai" | "data" | "media" | "input";
}

const blockTypeOptions: BlockTypeOption[] = [
  {
    type: "text",
    label: "Text",
    icon: <Type className="h-4 w-4" />,
    description: "Plain text with rich formatting",
    category: "basic",
  },
  {
    type: "heading_1",
    label: "Heading 1",
    icon: <Heading1 className="h-4 w-4" />,
    description: "Large section heading",
    category: "basic",
  },
  {
    type: "heading_2",
    label: "Heading 2",
    icon: <Heading2 className="h-4 w-4" />,
    description: "Medium section heading",
    category: "basic",
  },
  {
    type: "heading_3",
    label: "Heading 3",
    icon: <Heading3 className="h-4 w-4" />,
    description: "Small section heading",
    category: "basic",
  },
  {
    type: "bulleted_list",
    label: "Bulleted list",
    icon: <List className="h-4 w-4" />,
    description: "Simple bullet point list",
    category: "basic",
  },
  {
    type: "numbered_list",
    label: "Numbered list",
    icon: <ListOrdered className="h-4 w-4" />,
    description: "Numbered ordered list",
    category: "basic",
  },
  {
    type: "todo",
    label: "To-do list",
    icon: <CheckSquare className="h-4 w-4" />,
    description: "Checkbox task list",
    category: "basic",
  },
  {
    type: "callout",
    label: "Callout",
    icon: <MessageSquareQuote className="h-4 w-4" />,
    description: "Highlighted info, tip, or warning",
    category: "basic",
  },
  {
    type: "separator",
    label: "Separator",
    icon: <Minus className="h-4 w-4" />,
    description: "Horizontal divider",
    category: "basic",
  },
  {
    type: "ai_cell",
    label: "AI Cell",
    icon: <Sparkles className="h-4 w-4" />,
    description: "Run AI prompts and get structured output",
    category: "ai",
  },
  {
    type: "table",
    label: "Table",
    icon: <Table className="h-4 w-4" />,
    description: "Editable data table",
    category: "data",
  },
  {
    type: "json",
    label: "JSON",
    icon: <Braces className="h-4 w-4" />,
    description: "Structured JSON data",
    category: "data",
  },
  {
    type: "input_text",
    label: "Text input",
    icon: <TextCursorInput className="h-4 w-4" />,
    description: "Text field with variable name",
    category: "input",
  },
  {
    type: "input_number",
    label: "Number input",
    icon: <Hash className="h-4 w-4" />,
    description: "Numeric field with stepper",
    category: "input",
  },
  {
    type: "input_slider",
    label: "Slider",
    icon: <SlidersHorizontal className="h-4 w-4" />,
    description: "Range slider with min/max",
    category: "input",
  },
  {
    type: "input_checkbox",
    label: "Checkbox",
    icon: <ToggleLeft className="h-4 w-4" />,
    description: "Boolean toggle with label",
    category: "input",
  },
  {
    type: "input_select",
    label: "Dropdown",
    icon: <ChevronDown className="h-4 w-4" />,
    description: "Select from predefined options",
    category: "input",
  },
  {
    type: "input_date",
    label: "Date picker",
    icon: <CalendarDays className="h-4 w-4" />,
    description: "Date input with calendar",
    category: "input",
  },
  {
    type: "input_group",
    label: "Control Panel",
    icon: <LayoutDashboard className="h-4 w-4" />,
    description: "Grouped inputs as a workflow control bar",
    category: "input",
  },
];

interface BlockTypePickerProps {
  onSelect: (type: string) => void;
  onClose: () => void;
  position?: { top: number; left: number };
}

export function BlockTypePicker({
  onSelect,
  onClose,
  position,
}: BlockTypePickerProps) {
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [flipUp, setFlipUp] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = blockTypeOptions.filter(
    (opt) =>
      opt.label.toLowerCase().includes(search.toLowerCase()) ||
      opt.description.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 16) {
      setFlipUp(true);
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlightedIndex]) {
        onSelect(filtered[highlightedIndex].type);
      }
    }
  };

  return (
    <div
      ref={menuRef}
      className={`absolute z-[200] w-64 rounded-lg border border-gray-200 bg-white shadow-lg
                 animate-in fade-in duration-150
                 ${flipUp ? "slide-in-from-bottom-1" : "slide-in-from-top-1"}`}
      style={
        position
          ? flipUp
            ? { bottom: position.top || 0, left: position.left }
            : { top: position.top, left: position.left }
          : flipUp
            ? { bottom: "100%", left: 0 }
            : { top: "100%", left: 0 }
      }
    >
      <div className="p-2 border-b border-gray-100">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search blocks..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setHighlightedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          className="w-full px-2.5 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-md
                     outline-none focus:border-cell-accent focus:ring-1 focus:ring-cell-accent/30
                     transition-colors placeholder:text-gray-400"
        />
      </div>

      <div className="max-h-72 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-sm text-gray-400 text-center">
            No blocks found
          </div>
        ) : (
          filtered.map((option, index) => (
            <button
              key={option.type}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors cursor-pointer
                ${
                  index === highlightedIndex
                    ? "bg-cell-accent-light text-gray-900"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              onClick={() => onSelect(option.type)}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors
                  ${
                    index === highlightedIndex
                      ? "border-cell-accent/30 bg-white text-cell-accent"
                      : "border-gray-200 bg-gray-50 text-gray-500"
                  }`}
              >
                {option.icon}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{option.label}</div>
                <div className="text-xs text-gray-400 truncate">
                  {option.description}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
