"use client";

import { useState, useCallback, memo } from "react";
import {
  GripVertical,
  MoreHorizontal,
  Type,
  Sparkles,
  Table2,
  Braces,
  CheckSquare,
  FileText,
  Terminal,
  Info,
  List,
  AlertCircle,
  SlidersHorizontal,
  Copy,
  Trash2,
} from "lucide-react";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { BlockTypePicker } from "./block-type-picker";

function CellNotesHexagon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M256 64 L415 156 L415 340 L256 448 L97 356 L97 156 Z"
        fill="none"
        stroke="#005BFF"
        strokeWidth="40"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
    </svg>
  );
}

function BlockTypeIcon({ blockType }: { blockType: string }) {
  switch (blockType) {
    case "ai_cell":
      return <CellNotesHexagon size={16} />;
    case "output":
      return <Sparkles className="h-4 w-4 text-blue-500" />;
    case "text":
    case "heading":
      return (
        <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-blue-50 border border-blue-200">
          <Type className="h-3 w-3 text-blue-600" />
        </span>
      );
    case "table":
      return <Table2 className="h-4 w-4 text-blue-500" />;
    case "json":
      return <Braces className="h-4 w-4 text-blue-500" />;
    case "todo":
      return <CheckSquare className="h-4 w-4 text-blue-500" />;
    case "file":
      return <FileText className="h-4 w-4 text-blue-500" />;
    case "command_ref":
      return <Terminal className="h-4 w-4 text-blue-500" />;
    case "callout":
      return <Info className="h-4 w-4 text-blue-500" />;
    case "bulleted_list":
    case "numbered_list":
      return <List className="h-4 w-4 text-blue-500" />;
    case "error":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case "input":
    case "input_group":
      return <SlidersHorizontal className="h-4 w-4 text-blue-500" />;
    default:
      return <Type className="h-4 w-4 text-blue-500" />;
  }
}

interface BlockTabProps {
  blockIndex: number;
  blockType: string;
  typeLabel: string;
  onChangeType: (newType: string) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: SyntheticListenerMap;
  extraHeaderContent?: React.ReactNode;
}

export const BlockTab = memo(function BlockTab({
  blockIndex,
  blockType,
  typeLabel,
  onChangeType,
  onDelete,
  onDuplicate,
  dragAttributes,
  dragListeners,
  extraHeaderContent,
}: BlockTabProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const handleSelect = useCallback(
    (type: string) => {
      setShowPicker(false);
      onChangeType(type);
    },
    [onChangeType]
  );

  return (
    <div className="flex items-center h-10 px-3.5 bg-white border-b border-gray-200 rounded-t-lg select-none">
      {/* Block number */}
      <span className="text-[13px] font-medium text-gray-400 mr-3 tabular-nums w-5 text-right shrink-0">
        {blockIndex}
      </span>

      {/* Type icon */}
      <div className="mr-1.5 flex items-center">
        <BlockTypeIcon blockType={blockType} />
      </div>

      {/* Type label (clickable for type picker) */}
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowPicker(!showPicker);
          }}
          className="inline-flex items-center hover:bg-gray-50 rounded px-1 py-0.5
                     transition-colors cursor-pointer"
        >
          <span className="text-[13px] font-medium text-gray-700">{typeLabel}</span>
        </button>
        {showPicker && (
          <BlockTypePicker
            onSelect={handleSelect}
            onClose={() => setShowPicker(false)}
          />
        )}
      </div>

      {/* Extra header content (e.g., Make Reusable button) */}
      {extraHeaderContent && (
        <div className="ml-3 flex items-center">
          {extraHeaderContent}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* More menu */}
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="h-6 w-6 flex items-center justify-center rounded
                     text-gray-400 hover:text-gray-600 hover:bg-gray-100
                     transition-colors cursor-pointer"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {showMenu && (
          <div
            className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200
                       rounded-lg shadow-lg z-50 py-1 animate-in fade-in slide-in-from-top-1 duration-100"
            onMouseLeave={() => setShowMenu(false)}
          >
            {onDuplicate && (
              <button
                onClick={() => { onDuplicate(); setShowMenu(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px]
                           text-gray-600 hover:bg-gray-50 hover:text-gray-900
                           cursor-pointer transition-colors"
              >
                <Copy className="h-3 w-3" />
                Duplicate
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => { onDelete(); setShowMenu(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px]
                           text-red-500 hover:bg-red-50 hover:text-red-600
                           cursor-pointer transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {/* Drag handle */}
      <div
        className="h-6 w-6 flex items-center justify-center rounded ml-0.5
                   text-gray-400 hover:text-gray-600 hover:bg-gray-100
                   cursor-grab active:cursor-grabbing transition-colors"
        {...dragAttributes}
        {...dragListeners}
      >
        <GripVertical className="h-4 w-4" />
      </div>
    </div>
  );
});
