"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ChevronRight, ChevronDown, Copy, Check } from "lucide-react";
import { DuotoneIcon } from "@/components/ui/duotone-icon";
import type { Block } from "@/lib/models/types";

interface JsonBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// --- Tree View ---

function JsonNode({
  keyName,
  value,
  depth,
  isLast,
  defaultExpanded,
}: {
  keyName?: string;
  value: JsonValue;
  depth: number;
  isLast: boolean;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const isExpandable = isObject || isArray;

  const entries = isObject
    ? Object.entries(value as Record<string, JsonValue>)
    : isArray
      ? (value as JsonValue[]).map((v, i) => [i, v] as [number, JsonValue])
      : [];

  const comma = isLast ? "" : ",";

  const renderKey = () =>
    keyName !== undefined ? (
      <span className="text-gray-700 font-medium">&quot;{keyName}&quot;</span>
    ) : null;

  const renderColon = () =>
    keyName !== undefined ? <span className="text-gray-400 mr-1">:</span> : null;

  if (!isExpandable) {
    return (
      <div className="flex items-baseline" style={{ paddingLeft: depth * 20 }}>
        {renderKey()}
        {renderColon()}
        <ValueDisplay value={value} />
        <span className="text-gray-400">{comma}</span>
      </div>
    );
  }

  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";
  const count = entries.length;

  if (!expanded) {
    return (
      <div className="flex items-baseline" style={{ paddingLeft: depth * 20 }}>
        <button
          onClick={() => setExpanded(true)}
          className="cursor-pointer text-gray-400 hover:text-gray-600 transition-colors duration-100
                     shrink-0 relative top-[1px] mr-0.5"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
        {renderKey()}
        {renderColon()}
        <span className="text-gray-400">
          {open}
          <span className="text-[11px] italic mx-1">
            {count} {count === 1 ? "item" : "items"}
          </span>
          {close}
        </span>
        <span className="text-gray-400">{comma}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline" style={{ paddingLeft: depth * 20 }}>
        <button
          onClick={() => setExpanded(false)}
          className="cursor-pointer text-gray-400 hover:text-gray-600 transition-colors duration-100
                     shrink-0 relative top-[1px] mr-0.5"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
        {renderKey()}
        {renderColon()}
        <span className="text-gray-400">{open}</span>
      </div>
      {entries.map(([k, v], i) => (
        <JsonNode
          key={String(k)}
          keyName={isObject ? String(k) : undefined}
          value={v as JsonValue}
          depth={depth + 1}
          isLast={i === entries.length - 1}
          defaultExpanded={depth < 1}
        />
      ))}
      <div className="flex items-baseline" style={{ paddingLeft: depth * 20 }}>
        <span className="text-gray-400 ml-4">{close}</span>
        <span className="text-gray-400">{comma}</span>
      </div>
    </div>
  );
}

function ValueDisplay({ value }: { value: JsonValue }) {
  if (value === null) return <span className="text-gray-400 italic">null</span>;
  if (typeof value === "boolean")
    return <span className="text-violet-600 font-medium">{String(value)}</span>;
  if (typeof value === "number")
    return <span className="text-blue-600 tabular-nums">{String(value)}</span>;
  if (typeof value === "string") {
    const display = value.length > 120 ? value.slice(0, 120) + "..." : value;
    return (
      <span className="text-emerald-600">
        &quot;<span className="break-all">{display}</span>&quot;
      </span>
    );
  }
  return <span className="text-gray-500">{String(value)}</span>;
}

// --- Main component ---

export function JsonBlock({ block, onUpdate }: JsonBlockProps) {
  const data = block.content?.data as JsonValue ?? {};
  const [rawText, setRawText] = useState(() => {
    const d = block.content?.data;
    if (d === undefined || d === null || (typeof d === "object" && Object.keys(d as Record<string, unknown>).length === 0)) {
      return "{\n  \n}";
    }
    return JSON.stringify(d, null, 2);
  });
  const [parsedData, setParsedData] = useState<JsonValue>(data);
  const [parseError, setParseError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const updateTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Live-parse as user types
  const handleChange = useCallback(
    (text: string) => {
      setRawText(text);
      try {
        const parsed = JSON.parse(text);
        setParsedData(parsed);
        setParseError(null);
        clearTimeout(updateTimeout.current);
        updateTimeout.current = setTimeout(() => {
          onUpdate({ ...block.content, data: parsed });
        }, 300);
      } catch {
        setParseError("Invalid JSON");
      }
    },
    [block.content, onUpdate]
  );

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(parsedData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [parsedData]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      const ta = textareaRef.current;
      ta.style.height = "auto";
      ta.style.height = `${Math.max(ta.scrollHeight, 60)}px`;
    }
  }, [rawText]);

  const hasOutput = parsedData !== undefined && parsedData !== null;

  return (
    <div>
      {/* Input — raw editor, stretches when block is resized */}
      <div
        className="px-4 py-3 cursor-text flex-1 min-h-0 flex flex-col"
        style={{ backgroundColor: "#f0f4f8" }}
        onClick={() => textareaRef.current?.focus()}
      >
        <textarea
          ref={textareaRef}
          value={rawText}
          onChange={(e) => handleChange(e.target.value)}
          spellCheck={false}
          className="w-full resize-none bg-transparent text-[13px] text-gray-700
                     font-mono leading-relaxed placeholder:text-gray-400 outline-none
                     flex-1 min-h-0"
          placeholder='{ "key": "value" }'
        />
      </div>

      {/* Output — tree view */}
      <div className="group/output relative border-t border-gray-200">
        {parseError ? (
          <div className="px-4 py-3 text-[12px] text-gray-400 italic font-mono">
            {parseError}
          </div>
        ) : hasOutput ? (
          <div className="px-4 py-3 text-[13px] font-mono leading-relaxed overflow-x-auto select-text">
            <JsonNode
              value={parsedData}
              depth={0}
              isLast={true}
              defaultExpanded={true}
            />
          </div>
        ) : (
          <div className="px-4 py-3 text-[12px] text-gray-400 italic">
            No output
          </div>
        )}

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 h-6 w-6 flex items-center justify-center rounded
                     opacity-0 group-hover/output:opacity-100
                     hover:bg-gray-100 transition-all duration-150 cursor-pointer"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <DuotoneIcon icon={Copy} size={13} />
          )}
        </button>
      </div>
    </div>
  );
}
