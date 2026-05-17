"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
} from "react";
import {
  X,
  Plus,
  ChevronDown,
  ChevronRight,
  Loader2,
  Check,
  Copy,
  PackagePlus,
  Play,
  FileText,
  Table2,
  Braces,
  CheckSquare,
  List,
  ListOrdered,
  Info,
  Globe,
  Link,
  Search,
  BookOpen,
  Terminal,
  ImageIcon,
  SlidersHorizontal,
  GripVertical,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { generateSchemaFromOutput } from "@/services/schema-service";
import type { Block, SuggestedInput } from "@/lib/models/types";

/* ═══════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════ */

interface InputRow {
  name: string;
  type: string;
  required: boolean;
  source: "page" | "template";
  default_value?: string;
  options?: string[];
  min?: number;
  max?: number;
  description?: string;
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    patternMessage?: string;
  };
}

interface AttachedSourceInfo {
  label: string;
  icon: string;
}

interface MakeReusableDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  prompt: string;
  block: Block;
  editCommand?: Command | null;
  attachedSources?: AttachedSourceInfo[];
  usedContext?: boolean;
}

type Command = import("@/lib/models/types").Command;

const CONTEXT_SCOPE = "page";

const INPUT_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Checkbox" },
  { value: "select", label: "Dropdown" },
];

interface ToolDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  category: "create" | "read" | "web";
}

const AVAILABLE_TOOLS: ToolDef[] = [
  { id: "create_text_output", label: "Text output", icon: <FileText className="h-3 w-3" />, category: "create" },
  { id: "create_table", label: "Table", icon: <Table2 className="h-3 w-3" />, category: "create" },
  { id: "create_json", label: "JSON", icon: <Braces className="h-3 w-3" />, category: "create" },
  { id: "create_todo", label: "To-do", icon: <CheckSquare className="h-3 w-3" />, category: "create" },
  { id: "create_bulleted_list", label: "List", icon: <List className="h-3 w-3" />, category: "create" },
  { id: "create_numbered_list", label: "Num. list", icon: <ListOrdered className="h-3 w-3" />, category: "create" },
  { id: "create_callout", label: "Callout", icon: <Info className="h-3 w-3" />, category: "create" },
  { id: "create_source_card", label: "Source card", icon: <Link className="h-3 w-3" />, category: "create" },
  { id: "create_code_output", label: "Code", icon: <Terminal className="h-3 w-3" />, category: "create" },
  { id: "generate_image", label: "Image", icon: <ImageIcon className="h-3 w-3" />, category: "create" },
  { id: "read_block", label: "Read block", icon: <BookOpen className="h-3 w-3" />, category: "read" },
  { id: "read_page", label: "Read page", icon: <BookOpen className="h-3 w-3" />, category: "read" },
  { id: "read_inputs", label: "Read inputs", icon: <SlidersHorizontal className="h-3 w-3" />, category: "read" },
  { id: "search_workspace", label: "Search workspace", icon: <Search className="h-3 w-3" />, category: "read" },
  { id: "web_search", label: "Web search", icon: <Globe className="h-3 w-3" />, category: "web" },
  { id: "web_scrape", label: "Web scrape", icon: <Globe className="h-3 w-3" />, category: "web" },
  { id: "run_command", label: "Run command", icon: <Terminal className="h-3 w-3" />, category: "web" },
];

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function extractTemplateVars(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.replace(/\{|\}/g, "")))];
}

function mergeInputs(
  pageInputs: SuggestedInput[],
  templateVars: string[]
): InputRow[] {
  const rows: InputRow[] = [];
  const seen = new Set<string>();

  for (const input of pageInputs) {
    seen.add(input.name);
    rows.push({
      name: input.name,
      type: input.type,
      required: input.required,
      source: "page",
      options: input.options,
      min: input.min,
      max: input.max,
      description: input.description,
    });
  }

  for (const varName of templateVars) {
    if (seen.has(varName)) continue;
    rows.push({
      name: varName,
      type: "text",
      required: true,
      source: "template",
    });
  }

  return rows;
}

/* ═══════════════════════════════════════════════════════════
   Prompt display with highlighted {{variables}}
   ═══════════════════════════════════════════════════════════ */

function HighlightedPrompt({
  template,
  onSelectText,
}: {
  template: string;
  onSelectText: (text: string) => void;
  highlight?: string | null;
}) {
  const tokens = useMemo(() => {
    const result: Array<{ text: string; kind: "word" | "var" | "space"; wordIndex: number }> = [];
    const regex = /\{\{(\w+)\}\}/g;
    let lastIndex = 0;
    let match;
    let wordIdx = 0;

    while ((match = regex.exec(template)) !== null) {
      if (match.index > lastIndex) {
        wordIdx = splitIntoWords(template.slice(lastIndex, match.index), result, wordIdx);
      }
      result.push({ text: match[1], kind: "var", wordIndex: -1 });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < template.length) {
      splitIntoWords(template.slice(lastIndex), result, wordIdx);
    }
    return result;
  }, [template]);

  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const isDragging = useRef(false);

  const selectionRange = useMemo(() => {
    if (dragStart === null) return null;
    const end = dragEnd ?? dragStart;
    return { from: Math.min(dragStart, end), to: Math.max(dragStart, end) };
  }, [dragStart, dragEnd]);

  const handleMouseDown = useCallback((wordIndex: number) => {
    isDragging.current = true;
    setDragStart(wordIndex);
    setDragEnd(wordIndex);
  }, []);

  const handleMouseEnterWord = useCallback((wordIndex: number) => {
    setHoveredIndex(wordIndex);
    if (isDragging.current) {
      setDragEnd(wordIndex);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!isDragging.current || dragStart === null) return;
    isDragging.current = false;

    const range = selectionRange;
    if (!range) return;

    const selectedWords = tokens
      .filter((t) => t.kind === "word" && t.wordIndex >= range.from && t.wordIndex <= range.to)
      .map((t) => t.text);

    if (selectedWords.length > 0) {
      onSelectText(selectedWords.join(" "));
    }

    setDragStart(null);
    setDragEnd(null);
  }, [dragStart, selectionRange, tokens, onSelectText]);

  useEffect(() => {
    const up = () => {
      if (isDragging.current) handleMouseUp();
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [handleMouseUp]);

  return (
    <div
      className="text-[13px] font-mono leading-relaxed text-gray-700 whitespace-pre-wrap select-none"
      onMouseLeave={() => { if (!isDragging.current) setHoveredIndex(null); }}
    >
      {/* eslint-disable-next-line react-hooks/refs */}
      {tokens.map((token, i) => {
        if (token.kind === "var") {
          return (
            <span
              key={i}
              className="inline-flex items-center gap-0.5 text-blue-600 bg-blue-50 px-1.5 py-0.5
                         rounded font-medium border border-blue-200/50"
            >
              {`{{${token.text}}}`}
            </span>
          );
        }
        if (token.kind === "space") {
          return <span key={i}>{token.text}</span>;
        }

        const inSelection = selectionRange &&
          token.wordIndex >= selectionRange.from &&
          token.wordIndex <= selectionRange.to;
        const isHovered = hoveredIndex === token.wordIndex && !isDragging.current;

        return (
          <span
            key={i}
            onMouseDown={(e) => { e.preventDefault(); handleMouseDown(token.wordIndex); }}
            onMouseEnter={() => handleMouseEnterWord(token.wordIndex)}
            className={`relative cursor-pointer transition-all duration-100 rounded-sm px-0.5 -mx-0.5
                       ${inSelection
                         ? "bg-blue-100 text-blue-700 border-b-[1.5px] border-blue-400"
                         : isHovered
                           ? "bg-blue-50/80 border-b-[1.5px] border-dashed border-blue-400 text-blue-700"
                           : "border-b-[1.5px] border-transparent"
                       }`}
          >
            {token.text}
          </span>
        );
      })}
    </div>
  );
}

function splitIntoWords(
  text: string,
  result: Array<{ text: string; kind: "word" | "var" | "space"; wordIndex: number }>,
  startIndex: number
): number {
  const parts = text.split(/(\s+)/);
  let idx = startIndex;
  for (const part of parts) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      result.push({ text: part, kind: "space", wordIndex: -1 });
    } else {
      result.push({ text: part, kind: "word", wordIndex: idx });
      idx++;
    }
  }
  return idx;
}

/* ═══════════════════════════════════════════════════════════
   Convert to input popover
   ═══════════════════════════════════════════════════════════ */

function ConvertPopover({
  selectedText,
  onConvert,
  onDismiss,
}: {
  selectedText: string;
  onConvert: (varName: string) => void;
  onDismiss: () => void;
}) {
  const [varName, setVarName] = useState(
    selectedText
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30)
  );

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200
                    rounded-md animate-in fade-in slide-in-from-top-1 duration-150">
      <span className="text-[11px] text-gray-500 shrink-0">Convert</span>
      <span className="text-[11px] text-gray-400 truncate max-w-[80px]">&ldquo;{selectedText}&rdquo;</span>
      <span className="text-[11px] text-gray-500 shrink-0">to</span>
      <input
        type="text"
        value={varName}
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          setVarName(e.target.value.replace(/[^a-z0-9_]/g, "").slice(0, 30))
        }
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && varName) onConvert(varName);
          if (e.key === "Escape") onDismiss();
        }}
        className="w-24 px-2 py-1 text-[11px] font-mono border border-gray-200 rounded
                   bg-white outline-none focus:border-blue-500"
      />
      <button
        onClick={() => varName && onConvert(varName)}
        disabled={!varName}
        className="h-6 px-2 text-[10px] font-medium bg-gray-800 text-white rounded
                   hover:bg-gray-700 disabled:opacity-40 cursor-pointer transition-colors"
      >
        Convert
      </button>
      <button
        onClick={onDismiss}
        className="h-6 w-6 flex items-center justify-center text-gray-400
                   hover:text-gray-600 cursor-pointer"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Validation rules (collapsed by default)
   ═══════════════════════════════════════════════════════════ */

function ValidationRules({
  row,
  index,
  onUpdate,
}: {
  row: InputRow;
  index: number;
  onUpdate: (index: number, field: keyof InputRow, value: unknown) => void;
}) {
  const v = row.validation;
  const hasRules = v && (v.min !== undefined || v.max !== undefined || v.minLength !== undefined || v.maxLength !== undefined || v.pattern);
  const [open, setOpen] = useState(!!hasRules);

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
      >
        <ChevronRight className={`h-2.5 w-2.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
        Validation
        {hasRules && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />}
      </button>
      {open && (
        <div className="mt-1.5">
          {row.type === "number" && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-500">Min</span>
                <input
                  type="number"
                  value={v?.min ?? ""}
                  onChange={(e) => onUpdate(index, "validation", { ...v, min: e.target.value === "" ? undefined : Number(e.target.value) })}
                  className="w-16 px-2 py-1 text-[12px] text-gray-600 border border-gray-200 rounded
                             bg-white outline-none focus:border-blue-500"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-500">Max</span>
                <input
                  type="number"
                  value={v?.max ?? ""}
                  onChange={(e) => onUpdate(index, "validation", { ...v, max: e.target.value === "" ? undefined : Number(e.target.value) })}
                  className="w-16 px-2 py-1 text-[12px] text-gray-600 border border-gray-200 rounded
                             bg-white outline-none focus:border-blue-500"
                />
              </label>
            </div>
          )}
          {row.type === "text" && (
            <>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5">
                  <span className="text-[11px] text-gray-500">Min len</span>
                  <input
                    type="number"
                    value={v?.minLength ?? ""}
                    onChange={(e) => onUpdate(index, "validation", { ...v, minLength: e.target.value === "" ? undefined : Number(e.target.value) })}
                    className="w-16 px-2 py-1 text-[12px] text-gray-600 border border-gray-200 rounded
                               bg-white outline-none focus:border-blue-500"
                    min={0}
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="text-[11px] text-gray-500">Max len</span>
                  <input
                    type="number"
                    value={v?.maxLength ?? ""}
                    onChange={(e) => onUpdate(index, "validation", { ...v, maxLength: e.target.value === "" ? undefined : Number(e.target.value) })}
                    className="w-16 px-2 py-1 text-[12px] text-gray-600 border border-gray-200 rounded
                               bg-white outline-none focus:border-blue-500"
                    min={0}
                  />
                </label>
              </div>
              <div className="mt-1.5">
                <input
                  type="text"
                  value={v?.pattern ?? ""}
                  onChange={(e) => onUpdate(index, "validation", { ...v, pattern: e.target.value || undefined })}
                  placeholder="Regex pattern (optional)"
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono text-gray-600 border border-gray-200 rounded-md
                             bg-white outline-none focus:border-blue-500 placeholder:text-gray-300"
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Input pill row
   ═══════════════════════════════════════════════════════════ */

function InputTableRow({
  row,
  index,
  onUpdate,
  onRemove,
}: {
  row: InputRow;
  index: number;
  onUpdate: (index: number, field: keyof InputRow, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [optionsText, setOptionsText] = useState((row.options || []).join(", "));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (expanded) setOptionsText((row.options || []).join(", "));
  }, [expanded, row.options]);

  return (
    <div className="border-b border-gray-100 last:border-b-0 group/row">
      {/* Main row */}
      <div className="grid grid-cols-[16px_minmax(0,1fr)_76px_auto_24px_24px] items-center gap-3 py-2.5">
        <GripVertical className="h-3.5 w-3.5 text-gray-300 cursor-grab" />
        <span className="min-w-0 truncate text-[13px] font-mono text-gray-800 font-medium">
          {row.name}
        </span>
        <span className="min-w-0 truncate text-[12px] text-gray-400">
          {INPUT_TYPES.find((t) => t.value === row.type)?.label || row.type}
        </span>
        <button
          onClick={() => onUpdate(index, "required", !row.required)}
          className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer
            ${row.required
              ? "bg-red-50 text-red-500 border border-red-200"
              : "bg-gray-50 text-gray-400 border border-gray-200"
            }`}
        >
          {row.required ? "Required" : "Optional"}
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          className="h-6 w-6 flex items-center justify-center text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
        </button>
        <button
          onClick={() => onRemove(index)}
          className="h-6 w-6 flex items-center justify-center rounded
                     text-gray-300 opacity-0 group-hover/row:opacity-100
                     hover:text-red-500 hover:bg-red-50
                     transition-opacity duration-150 cursor-pointer shrink-0"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Expanded edit area */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="pl-7 pb-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={row.name}
              onChange={(e) =>
                onUpdate(index, "name", e.target.value.replace(/[^a-z0-9_]/g, "").slice(0, 30))
              }
              className="flex-1 px-2.5 py-1.5 text-[12px] font-mono text-gray-700 border border-gray-200 rounded-md
                         bg-white outline-none focus:border-blue-500"
            />
            <select
              value={row.type}
              onChange={(e) => onUpdate(index, "type", e.target.value)}
              className="px-2.5 py-1.5 text-[12px] text-gray-600 border border-gray-200 rounded-md
                         bg-white outline-none cursor-pointer"
            >
              {INPUT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <input
            type="text"
            value={row.description || ""}
            onChange={(e) => onUpdate(index, "description", e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-2.5 py-1.5 text-[12px] text-gray-600 border border-gray-200 rounded-md
                       bg-white outline-none focus:border-blue-500 placeholder:text-gray-300"
          />
          {row.type === "select" && (
            <input
              type="text"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              onBlur={() =>
                onUpdate(index, "options", optionsText.split(",").map((s) => s.trim()).filter(Boolean))
              }
              placeholder="Options: Executive, Technical, General"
              className="w-full px-2.5 py-1.5 text-[12px] text-gray-600 border border-gray-200 rounded-md
                         bg-white outline-none focus:border-blue-500 placeholder:text-gray-300"
            />
          )}
          {/* Validation rules — collapsed by default */}
          {(row.type === "text" || row.type === "number") && (
            <ValidationRules row={row} index={index} onUpdate={onUpdate} />
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Section label
   ═══════════════════════════════════════════════════════════ */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2 block">
      {children}
    </label>
  );
}

/* ═══════════════════════════════════════════════════════════
   Main drawer
   ═══════════════════════════════════════════════════════════ */

export function MakeReusableDrawer({
  isOpen,
  onClose,
  prompt,
  block,
  editCommand,
  attachedSources,
  usedContext,
}: MakeReusableDrawerProps) {
  const supabase = useMemo(() => createClient(), []);

  // Form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const nameRef = useRef("");
  const slugRef = useRef("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState(prompt);
  const [inputs, setInputs] = useState<InputRow[]>([]);
  const contextScope = CONTEXT_SCOPE;
  const [outputSchema, setOutputSchema] = useState<object>({});
  const [showSchema, setShowSchema] = useState(false);
  const [allowedTools, setAllowedTools] = useState<Set<string>>(
    new Set(AVAILABLE_TOOLS.map((t) => t.id))
  );

  // Source config state
  const [sourceRequired, setSourceRequired] = useState(false);
  const [sourceExcludeOutputs, setSourceExcludeOutputs] = useState(true);

  // UI state
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  // Load page blocks and generate schema on open
  useEffect(() => {
    if (!isOpen) return;

    setSaving(false);
    setSaved(false);
    setTesting(false);
    setTestResult(null);
    setError(null);
    setSelectedText(null);
    setShowSchema(false);

    if (editCommand) {
      nameRef.current = editCommand.name;
      slugRef.current = editCommand.slug;
      setSlugEdited(true);
      setName(editCommand.name);
      setSlug(editCommand.slug);
      setDescription(editCommand.description || "");
      setTemplate(editCommand.prompt_template);
      setInputs(
        editCommand.inputs.map((inp) => ({
          name: inp.name,
          type: inp.type,
          required: inp.required,
          source: "template" as const,
          description: inp.description,
          default_value: inp.default_value,
          options: inp.options,
          min: inp.min,
          max: inp.max,
          validation: inp.validation,
        }))
      );
      setOutputSchema(editCommand.output_schema || {});
      setAllowedTools(
        new Set(
          editCommand.allowed_tools?.length
            ? editCommand.allowed_tools
            : AVAILABLE_TOOLS.map((t) => t.id)
        )
      );
      const existingSource = (editCommand.context_config as Record<string, unknown>)?.source as Record<string, unknown> | undefined;
      if (existingSource && typeof existingSource.required === "boolean") {
        setSourceRequired(existingSource.required);
        setSourceExcludeOutputs(existingSource.exclude_previous_outputs !== false);
      } else {
        setSourceRequired(false);
        setSourceExcludeOutputs(true);
      }
      return;
    }

    // Auto-detect: enable source requirement if the AI cell used attached sources or context blocks
    const hadAttachedSources = !!attachedSources && attachedSources.length > 0;
    const usedContextBlocks = usedContext === true;
    setSourceRequired(hadAttachedSources || usedContextBlocks);
    setSourceExcludeOutputs(true);

    setTemplate(prompt);
    nameRef.current = "";
    slugRef.current = "";
    setName("");
    setSlug("");
    setSlugEdited(false);
    setDescription("");
    setAllowedTools(new Set(AVAILABLE_TOOLS.map((t) => t.id)));

    if (editCommand) return;

    async function loadPageBlocks() {
      const { data: pageBlocks } = await supabase
        .from("blocks")
        .select("*")
        .eq("page_id", block.page_id)
        .order("sort_order");

      const blocks = (pageBlocks || []) as Block[];

      const seenTypes = new Set<string>();
      const outputBlocks = blocks
        .filter((b) => b.type === "output" || b.type === "table" || b.type === "json")
        .reverse()
        .filter((b) => {
          const key = b.type + ":" + ((b.content?.format as string) || "");
          if (seenTypes.has(key)) return false;
          seenTypes.add(key);
          return true;
        });

      const schema = generateSchemaFromOutput(outputBlocks, blocks);

      setOutputSchema(schema.outputSchema);

      const templateVars = extractTemplateVars(prompt);
      setInputs(mergeInputs(schema.inputs, templateVars));
    }

    loadPageBlocks();
  }, [
    isOpen,
    prompt,
    block.page_id,
    supabase,
    editCommand,
    attachedSources,
    usedContext,
  ]);

  // Auto-slug from name
  useEffect(() => {
    if (!slugEdited) {
      const nextSlug = slugify(name);
      slugRef.current = nextSlug;
      setSlug(nextSlug);
    }
  }, [name, slugEdited]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleConvertToInput = useCallback(
    (varName: string) => {
      if (!selectedText) return;
      const originalText = selectedText;
      const escaped = selectedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      setTemplate((t) => t.replace(new RegExp(escaped, "g"), `{{${varName}}}`));
      setInputs((prev) => {
        if (prev.some((r) => r.name === varName)) return prev;
        return [...prev, { name: varName, type: "text", required: true, source: "template" as const, default_value: originalText }];
      });
      setSelectedText(null);
    },
    [selectedText]
  );

  const updateInput = useCallback(
    (index: number, field: keyof InputRow, value: unknown) => {
      setInputs((prev) =>
        prev.map((row, i) =>
          i === index ? { ...row, [field]: value } : row
        )
      );
    },
    []
  );

  const removeInput = useCallback((index: number) => {
    setInputs((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addInput = useCallback(() => {
    const varName = `input_${Date.now().toString(36).slice(-4)}`;
    setInputs((prev) => [
      ...prev,
      { name: varName, type: "text", required: false, source: "template" as const },
    ]);
  }, []);

  const toggleTool = useCallback((toolId: string) => {
    setAllowedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  }, []);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const res = await fetch("/api/ai/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: template,
          contextBlocks: [],
          modelProvider: (block.content?.model_provider as string) || "anthropic",
          modelName: (block.content?.model_name as string) || "",
          pageId: block.page_id,
          triggerBlockId: block.id,
          workspaceId: block.workspace_id,
        }),
      });

      if (!res.ok) {
        throw new Error(`Test run failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
      }

      setTestResult(fullText || "No output");
    } catch (err) {
      setError(`Test failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setTesting(false);
    }
  }, [template, block]);

  const handleSave = useCallback(async () => {
    const commandName = (name || nameRef.current || editCommand?.name || "").trim();
    const commandSlug = (slug || slugRef.current || editCommand?.slug || "").trim();

    if (!commandName || !commandSlug) {
      setError("Name and slug are required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const SOURCE_NAME_RE = /^(source|text|content|data|input|body|document|article|notes)$/i;
      const filteredInputs = sourceRequired
        ? inputs.filter((row) => !(row.type === "text" && SOURCE_NAME_RE.test(row.name)))
        : inputs;
      const inputsPayload = filteredInputs.map((row) => {
        const v = row.validation;
        const hasValidation = v && (v.min !== undefined || v.max !== undefined || v.minLength !== undefined || v.maxLength !== undefined || v.pattern);
        return {
          name: row.name,
          type: row.type,
          required: row.required,
          description: row.description,
          default_value: row.default_value,
          min: row.min,
          max: row.max,
          options: row.options,
          ...(hasValidation ? { validation: v } : {}),
        };
      });
      const isEdit = !!editCommand;
      const url = isEdit ? `/api/commands?id=${editCommand.id}` : "/api/commands";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: block.workspace_id,
          name: commandName,
          slug: commandSlug,
          description: description.trim() || undefined,
          promptTemplate: template,
          inputs: inputsPayload,
          outputSchema,
          allowedTools: [...allowedTools],
          contextConfig: {
            scope: contextScope,
            ...(sourceRequired ? {
              source: {
                required: true,
                accepted_types: ["block", "file", "url", "paste"],
                default_mode: "ask_each_time",
                exclude_previous_outputs: sourceExcludeOutputs,
                multi_select: true,
              },
            } : {}),
          },
          modelProvider: (block.content?.model_provider as string) || undefined,
          modelName: (block.content?.model_name as string) || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to save" }));
        throw new Error(err.error || `Request failed (${res.status})`);
      }

      setSaved(true);
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save command");
    } finally {
      setSaving(false);
    }
  }, [name, slug, description, template, inputs, outputSchema, allowedTools, contextScope, sourceRequired, sourceExcludeOutputs, block, onClose, editCommand]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-[420px] bg-white border-l border-gray-200
                      shadow-xl z-50 flex flex-col
                      animate-in slide-in-from-right duration-200">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <PackagePlus className="h-4 w-4 text-blue-500" />
            <h2 className="text-[15px] font-semibold text-gray-900">
              {editCommand ? "Edit Command" : "Make Reusable"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded
                       text-gray-400 hover:text-gray-600 hover:bg-gray-100
                       transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto">
          {/* Section: Identity */}
          <div className="px-5 py-4 border-b border-gray-100">
            <SectionLabel>Command name</SectionLabel>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                nameRef.current = e.target.value;
                setName(e.target.value);
              }}
              placeholder="e.g. Summarize Sources"
              className="w-full px-3 py-2 text-[13px] text-gray-800 border border-gray-200 rounded-md
                         bg-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20
                         transition-colors placeholder:text-gray-300"
            />

            <div className="flex items-center gap-2 mt-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 shrink-0">
                Slug
              </span>
              <input
                type="text"
                value={slug}
                onChange={(e) => {
                  const nextSlug = e.target.value.replace(/[^a-z0-9-]/g, "");
                  slugRef.current = nextSlug;
                  setSlug(nextSlug);
                  setSlugEdited(true);
                }}
                placeholder="summarize-sources"
                className="flex-1 px-2 py-1 text-[12px] font-mono text-gray-600 border border-gray-200 rounded
                           bg-gray-50 outline-none focus:border-blue-500
                           transition-colors placeholder:text-gray-300"
              />
            </div>

            <div className="mt-3">
              <SectionLabel>Description</SectionLabel>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this command do?"
                className="w-full px-3 py-2 text-[13px] text-gray-800 border border-gray-200 rounded-md
                           bg-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20
                           transition-colors placeholder:text-gray-300"
              />
            </div>
          </div>

          {/* Section: Command Template */}
          <div className="px-5 py-4 border-b border-gray-100">
            <SectionLabel>Command template</SectionLabel>

            <div className="rounded-md border border-gray-200 bg-gray-50/50 px-3 py-2.5 mb-2">
              <HighlightedPrompt
                template={template}
                onSelectText={setSelectedText}
              />
            </div>

            {selectedText && (
              <div className="mb-2">
                <ConvertPopover
                  selectedText={selectedText}
                  onConvert={handleConvertToInput}
                  onDismiss={() => setSelectedText(null)}
                />
              </div>
            )}

            <p className="text-[10px] text-gray-400">
              Hover over any word and click to convert it into an input variable
            </p>
          </div>

          {/* Section: Inputs */}
          <div className="px-5 py-4 border-b border-gray-100">
            <SectionLabel>Inputs</SectionLabel>

            {inputs.length === 0 ? (
              <p className="text-[12px] text-gray-400 italic py-1">
                No inputs yet — hover over words above or add one manually.
              </p>
            ) : (
              <div className="border border-gray-200 rounded-lg bg-white px-3">
                {inputs.map((row, i) => (
                  <InputTableRow
                    key={`${row.name}-${i}`}
                    row={row}
                    index={i}
                    onUpdate={updateInput}
                    onRemove={removeInput}
                  />
                ))}
              </div>
            )}

            <button
              onClick={addInput}
              className="flex items-center gap-1.5 mt-3 text-[13px] text-blue-500 hover:text-blue-600
                         font-medium cursor-pointer transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add input
            </button>
          </div>

          {/* Section: Sources */}
          <div className="px-5 py-4 border-b border-gray-100">
            <SectionLabel>Sources</SectionLabel>
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-[13px] text-gray-700 font-medium">Require source input</span>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Users must select sources before running
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSourceRequired(!sourceRequired)}
                className={`relative h-[22px] w-[40px] rounded-full transition-colors duration-200 cursor-pointer shrink-0
                  ${sourceRequired ? "bg-blue-500" : "bg-gray-300"}`}
              >
                <span className={`absolute top-[3px] left-[3px] h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-200
                  ${sourceRequired ? "translate-x-[18px]" : "translate-x-0"}`} />
              </button>
            </div>
            {sourceRequired && (
              <div className="flex items-center justify-between py-2 pl-3 ml-1 border-l-2 border-gray-100">
                <span className="text-[12px] text-gray-500">Exclude previous AI outputs</span>
                <button
                  type="button"
                  onClick={() => setSourceExcludeOutputs(!sourceExcludeOutputs)}
                  className={`relative h-[20px] w-[36px] rounded-full transition-colors duration-200 cursor-pointer shrink-0
                    ${sourceExcludeOutputs ? "bg-blue-500" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-[2px] left-[2px] h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-200
                    ${sourceExcludeOutputs ? "translate-x-[16px]" : "translate-x-0"}`} />
                </button>
              </div>
            )}
          </div>

          {/* Section: Tools */}
          <div className="px-5 py-4 border-b border-gray-100">
            <SectionLabel>Allowed tools</SectionLabel>

            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_TOOLS.map((tool) => {
                const active = allowedTools.has(tool.id);
                return (
                  <button
                    key={tool.id}
                    onClick={() => toggleTool(tool.id)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]
                               border transition-all cursor-pointer
                               ${active
                                 ? "border-blue-200 bg-white text-gray-800"
                                 : "border-gray-200 bg-white text-gray-400 hover:border-gray-300"
                               }`}
                  >
                    <span className={active ? "text-blue-500" : ""}>{tool.icon}</span>
                    {tool.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section: Output Schema */}
          <div className="px-5 py-4">
            <button
              onClick={() => setShowSchema(!showSchema)}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider
                         text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
            >
              {showSchema ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Output schema
            </button>

            {showSchema && (
              <div className="relative mt-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(outputSchema, null, 2));
                  }}
                  className="absolute top-2 right-2 h-6 w-6 flex items-center justify-center rounded
                             text-gray-400 hover:text-gray-600 hover:bg-gray-200
                             transition-colors cursor-pointer z-10"
                >
                  <Copy className="h-3 w-3" />
                </button>
                <pre className="px-3 py-2 text-[11px] font-mono text-gray-600 leading-relaxed
                                bg-gray-50 border border-gray-200 rounded-md
                                overflow-x-auto max-h-48 overflow-y-auto select-text">
                  {JSON.stringify(outputSchema, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Test result */}
          {testResult && (
            <div className="px-5 pb-4">
              <SectionLabel>Test result</SectionLabel>
              <div className="rounded-md border border-green-200 bg-green-50/50 px-3 py-2.5
                              text-[12px] text-gray-700 leading-relaxed max-h-40 overflow-y-auto">
                {testResult}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-4 border-t border-gray-200 shrink-0">
          {error && (
            <p className="text-[11px] text-red-500 mb-2">{error}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[13px] text-gray-500 hover:text-gray-700
                         transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleTest}
              disabled={testing || saving || !template.trim()}
              className="px-3 py-1.5 text-[13px] font-medium text-blue-600 border border-blue-200 rounded-md
                         bg-white hover:bg-blue-50
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors cursor-pointer flex items-center gap-1.5"
            >
              {testing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  Test
                </>
              )}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || saved || !name.trim()}
              className="px-4 py-1.5 text-[13px] font-medium bg-blue-500 text-white rounded-md
                         hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors cursor-pointer flex items-center gap-1.5"
            >
              {saved ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Saved
                </>
              ) : saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                editCommand ? "Update Command" : "Save Command"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
