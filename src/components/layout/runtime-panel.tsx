"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Activity,
  FileSearch,
  Wrench,
  Braces,
  PanelRightClose,
  PanelRight,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronUp,
  Terminal,
  Sparkles,
  Globe,
  Search,
  BookOpen,
  Table2,
  FileText,
  SlidersHorizontal,
  ChevronDown,
} from "lucide-react";
import {
  Anthropic,
  OpenAI,
  Google,
  Ollama,
  Meta,
  Mistral,
  DeepSeek,
} from "@lobehub/icons";
import { createClient } from "@/lib/supabase/client";
import type { Run } from "@/lib/models/types";

const TOOL_ICONS: Record<string, React.ReactNode> = {
  create_text_output: <FileText className="h-3.5 w-3.5 text-blue-500" />,
  create_table: <Table2 className="h-3.5 w-3.5 text-blue-500" />,
  create_json: <Braces className="h-3.5 w-3.5 text-blue-500" />,
  create_todo: <FileText className="h-3.5 w-3.5 text-blue-500" />,
  create_bulleted_list: <FileText className="h-3.5 w-3.5 text-blue-500" />,
  create_numbered_list: <FileText className="h-3.5 w-3.5 text-blue-500" />,
  create_callout: <FileText className="h-3.5 w-3.5 text-blue-500" />,
  create_source_card: <Globe className="h-3.5 w-3.5 text-blue-500" />,
  read_block: <BookOpen className="h-3.5 w-3.5 text-gray-400" />,
  read_page: <BookOpen className="h-3.5 w-3.5 text-gray-400" />,
  read_inputs: <SlidersHorizontal className="h-3.5 w-3.5 text-gray-400" />,
  search_workspace: <Search className="h-3.5 w-3.5 text-purple-500" />,
  web_search: <Globe className="h-3.5 w-3.5 text-green-500" />,
  web_scrape: <Globe className="h-3.5 w-3.5 text-green-500" />,
  run_command: <Terminal className="h-3.5 w-3.5 text-orange-500" />,
};

function ProviderIcon({ provider }: { provider: string }) {
  switch (provider) {
    case "anthropic": return <Anthropic size={16} />;
    case "openai": return <OpenAI size={16} />;
    case "google": return <Google size={16} />;
    case "ollama": return <Ollama size={16} />;
    case "meta": return <Meta size={16} />;
    case "mistral": return <Mistral size={16} />;
    case "deepseek": return <DeepSeek size={16} />;
    default: return <Sparkles className="h-4 w-4 text-gray-400" />;
  }
}

type Tab = "activity" | "context" | "schema";

interface RuntimePanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  workspaceId?: string;
  pageId?: string;
}

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "activity", label: "Activity", icon: <Activity className="h-3.5 w-3.5" /> },
  { id: "context", label: "Context", icon: <FileSearch className="h-3.5 w-3.5" /> },
  { id: "schema", label: "Schema", icon: <Braces className="h-3.5 w-3.5" /> },
];

const TOOL_INFO: Record<string, { label: string; description: string }> = {
  create_text_output: { label: "Creating text output", description: "Generated text response." },
  create_table: { label: "Creating table block", description: "Extracted structured data into table." },
  create_json: { label: "Creating JSON block", description: "Generated structured JSON output." },
  create_todo: { label: "Creating to-do list", description: "Generated task list." },
  create_bulleted_list: { label: "Creating list", description: "Generated bulleted list." },
  create_numbered_list: { label: "Creating numbered list", description: "Generated ordered list." },
  create_callout: { label: "Creating callout", description: "Generated callout block." },
  create_source_card: { label: "Creating source card", description: "Saved source reference." },
  read_block: { label: "Reading block content", description: "Loaded block data for context." },
  read_page: { label: "Reading page content", description: "Loaded full page for context." },
  read_inputs: { label: "Reading input values", description: "Loaded input block values." },
  search_workspace: { label: "Searching workspace memory", description: "Retrieved relevant content via RAG." },
  web_search: { label: "Searching the web", description: "Queried web search API." },
  web_scrape: { label: "Scraping website", description: "Extracted content from URL." },
  run_command: { label: "Running command", description: "Executed saved command internally." },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  });
}

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ── Status badge ── */

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
        <CheckCircle2 className="h-3 w-3" />
        Completed
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
        <Loader2 className="h-3 w-3 animate-spin" />
        Running
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
        <XCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  return <span className="text-[11px] text-gray-400">{status}</span>;
}

function BlueCheck() {
  return (
    <div className="h-5 w-5 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
      <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  );
}

function FailIcon() {
  return (
    <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center shrink-0">
      <XCircle className="h-3 w-3 text-white" />
    </div>
  );
}

/* ── Timeline step ── */

function TimelineStep({
  time,
  icon,
  label,
  description,
  badge,
  badgeColor = "gray",
  isLast = false,
}: {
  time?: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  badge?: string;
  badgeColor?: "gray" | "green" | "red";
  isLast?: boolean;
}) {
  const badgeStyles = {
    gray: "bg-gray-100 text-gray-600 border-gray-200",
    green: "bg-blue-50 text-blue-600 border-blue-200",
    red: "bg-red-50 text-red-600 border-red-200",
  };

  return (
    <div className="flex gap-3 relative">
      {/* Timestamp */}
      <div className="w-[52px] shrink-0 text-right pt-0.5">
        {time && (
          <span className="text-[10px] text-gray-400 tabular-nums">{time}</span>
        )}
      </div>

      {/* Icon + connector */}
      <div className="relative flex flex-col items-center">
        {icon}
        {!isLast && (
          <div className="w-px flex-1 bg-gray-200 mt-1" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-4">
        <span className="text-[12px] font-medium text-gray-800">{label}</span>
        {description && (
          <p className="text-[11px] text-gray-500 mt-0.5">{description}</p>
        )}
        {badge && (
          <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded border mt-1.5 ${badgeStyles[badgeColor]}`}>
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Expanded run detail ── */

function RunDetail({ run }: { run: Run }) {
  const toolsUsed = run.tools_used || [];
  const contextUsed = run.context_used || [];
  const blockCount = (run.output_block_ids || []).length;
  const schemaStatus = run.schema_validation;
  const modelLabel = run.model_name || run.model_provider || "Unknown";
  const baseTime = run.created_at;

  const steps: Array<{
    time: string;
    icon: React.ReactNode;
    label: string;
    description: string;
    badge?: string;
    badgeColor?: "gray" | "green" | "red";
  }> = [];

  // Context step
  if (contextUsed.length > 0) {
    steps.push({
      time: formatTime(baseTime),
      icon: <BlueCheck />,
      label: "Reading context",
      description: `Loaded ${contextUsed.length} source${contextUsed.length !== 1 ? "s" : ""} for context.`,
      badge: `${contextUsed.length} source${contextUsed.length !== 1 ? "s" : ""}`,
    });
  }

  // Tool steps
  for (const tool of toolsUsed) {
    const info = TOOL_INFO[tool] || { label: tool, description: "" };
    const isCreate = tool.startsWith("create_");
    steps.push({
      time: formatTime(baseTime),
      icon: <BlueCheck />,
      label: info.label,
      description: info.description,
      badge: isCreate ? tool.replace("create_", "").replace(/_/g, " ") : undefined,
    });
  }

  // Schema step
  if (schemaStatus && schemaStatus !== "not_applicable") {
    const passed = schemaStatus.startsWith("passed");
    steps.push({
      time: formatTime(baseTime),
      icon: passed ? <BlueCheck /> : <FailIcon />,
      label: "Validating schema",
      description: passed ? "Ensured output matches schema." : "Output did not match schema.",
      badge: passed ? "Schema passed" : "Failed",
      badgeColor: passed ? "green" : "red",
    });
  }

  // Output step
  if (blockCount > 0) {
    steps.push({
      time: formatTime(baseTime),
      icon: <BlueCheck />,
      label: "Created output",
      description: `Generated ${blockCount} output block${blockCount !== 1 ? "s" : ""}.`,
      badge: `${blockCount} block${blockCount !== 1 ? "s" : ""}`,
    });
  }

  // Error
  if (run.error) {
    steps.push({
      time: formatTime(baseTime),
      icon: <FailIcon />,
      label: "Error",
      description: run.error.message,
    });
  }

  return (
    <div>
      {/* Timeline */}
      <div className="px-3 pt-4 pb-2">
        {steps.map((step, i) => (
          <TimelineStep
            key={i}
            time={step.time}
            icon={step.icon}
            label={step.label}
            description={step.description}
            badge={step.badge}
            badgeColor={step.badgeColor}
            isLast={i === steps.length - 1}
          />
        ))}
        {steps.length === 0 && (
          <p className="text-[12px] text-gray-400 text-center py-4">No details available</p>
        )}
      </div>

      {/* Summary section */}
      <div className="mx-3 mb-3 border border-gray-200 rounded-lg divide-y divide-gray-100">
        {schemaStatus && schemaStatus !== "not_applicable" && (
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[12px] text-gray-700">
              {schemaStatus.startsWith("passed") ? "Schema passed" : "Schema failed"}
            </span>
            {schemaStatus.startsWith("passed") ? (
              <CheckCircle2 className="h-4 w-4 text-blue-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
          </div>
        )}
        {toolsUsed.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[12px] text-gray-700">
              {toolsUsed.length} tool{toolsUsed.length !== 1 ? "s" : ""} used
            </span>
            <div className="flex gap-1">
              {toolsUsed.slice(0, 4).map((t, i) => (
                <span key={i}>{TOOL_ICONS[t] || <Wrench className="h-3.5 w-3.5 text-gray-400" />}</span>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[12px] text-gray-700">Model: {modelLabel}</span>
          <ProviderIcon provider={run.model_provider || ""} />
        </div>
        {run.token_usage && (
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[12px] text-gray-700">
              Tokens: {run.token_usage.total_tokens?.toLocaleString()}
            </span>
          </div>
        )}
      </div>

    </div>
  );
}

/* ── Run card (collapsed) ── */

function RunCard({ run, expanded, onToggle }: { run: Run; expanded: boolean; onToggle: () => void }) {
  const isCommand = run.type === "command";

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={onToggle}
        className="flex items-center w-full px-3.5 py-3 gap-2.5 hover:bg-gray-50 transition-colors cursor-pointer"
      >
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        )}
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            {isCommand ? (
              <Terminal className="h-3.5 w-3.5 text-blue-500 shrink-0" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-blue-500 shrink-0" />
            )}
            <span className="text-[12px] font-medium text-gray-800">
              {isCommand ? "Command run" : "AI Cell run"}
            </span>
          </div>
          <span className="text-[10px] text-gray-400 mt-0.5 block">
            {timeAgo(run.created_at)}
            {run.duration_ms ? ` · ${formatDuration(run.duration_ms)}` : ""}
          </span>
        </div>
        <StatusBadge status={run.status} />
      </button>

      {expanded && (
        <div className="border-t border-gray-100">
          <RunDetail run={run} />
        </div>
      )}
    </div>
  );
}

/* ── Context tab ── */

const CONTEXT_TYPE_INFO: Record<string, { label: string; icon: React.ReactNode }> = {
  text: { label: "Text block", icon: <FileText className="h-4 w-4 text-blue-500" /> },
  heading: { label: "Heading", icon: <FileText className="h-4 w-4 text-blue-500" /> },
  table: { label: "Table", icon: <Table2 className="h-4 w-4 text-blue-500" /> },
  json: { label: "JSON data", icon: <Braces className="h-4 w-4 text-blue-500" /> },
  output: { label: "AI output", icon: <Sparkles className="h-4 w-4 text-blue-500" /> },
  todo: { label: "To-do list", icon: <FileText className="h-4 w-4 text-blue-500" /> },
  file: { label: "File", icon: <FileText className="h-4 w-4 text-blue-500" /> },
  input: { label: "Input value", icon: <SlidersHorizontal className="h-4 w-4 text-blue-500" /> },
  ai_cell: { label: "AI cell", icon: <Sparkles className="h-4 w-4 text-blue-500" /> },
  callout: { label: "Callout", icon: <FileText className="h-4 w-4 text-blue-500" /> },
};

function ContextTab({ run }: { run: Run | null }) {
  if (!run || !run.context_used || run.context_used.length === 0) {
    return <EmptyState icon={FileSearch} text="No context used" sub="Run an AI cell to see context sources" />;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
          <FileSearch className="h-5 w-5 text-white" />
        </div>
        <div>
          <span className="text-[13px] font-semibold text-gray-900 block">
            {run.context_used.length} source{run.context_used.length !== 1 ? "s" : ""} loaded
          </span>
          <span className="text-[11px] text-gray-400">{formatTime(run.created_at)}</span>
        </div>
      </div>

      {/* Source cards */}
      <div className="space-y-3">
        {run.context_used.map((ctx, i) => {
          const info = CONTEXT_TYPE_INFO[ctx.type] || { label: ctx.type, icon: <BookOpen className="h-4 w-4 text-blue-500" /> };
          const preview = typeof ctx.label === "string" && ctx.label.length > 0 ? ctx.label : ctx.id;
          const truncatedPreview = preview.length > 140 ? preview.slice(0, 140) + "..." : preview;

          return (
            <div key={i} className="border border-gray-200 rounded-xl bg-white">
              {/* Card header */}
              <div className="flex items-center justify-between px-4 pt-3.5 pb-1.5">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                    {info.icon}
                  </div>
                  <span className="text-[13px] font-semibold text-gray-900">{info.label}</span>
                </div>
                <div className="h-5 w-5 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>

              {/* Content preview */}
              <div className="px-4 pb-2.5">
                <p className="text-[12px] text-gray-500 leading-relaxed">{truncatedPreview}</p>
              </div>

              {/* Metadata footer */}
              <div className="px-4 pb-3.5 flex items-center text-[11px] text-gray-400">
                <span>{info.label}</span>
                <span className="ml-auto">{formatTime(run.created_at)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── JSON syntax colorizer ── */

function colorizeJsonLine(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = line;
  let key = 0;

  while (remaining.length > 0) {
    // Match JSON key ("key":)
    const keyMatch = remaining.match(/^(\s*)"([^"]+)"(\s*:\s*)/);
    if (keyMatch) {
      if (keyMatch[1]) parts.push(<span key={key++}>{keyMatch[1]}</span>);
      parts.push(<span key={key++} className="text-gray-800 font-medium">&quot;{keyMatch[2]}&quot;</span>);
      parts.push(<span key={key++}>{keyMatch[3]}</span>);
      remaining = remaining.slice(keyMatch[0].length);
      continue;
    }

    // Match string value ("value")
    const strMatch = remaining.match(/^"([^"]*)"/);
    if (strMatch) {
      parts.push(<span key={key++} className="text-blue-600">&quot;{strMatch[1]}&quot;</span>);
      remaining = remaining.slice(strMatch[0].length);
      continue;
    }

    // Match number
    const numMatch = remaining.match(/^(-?\d+\.?\d*)/);
    if (numMatch) {
      parts.push(<span key={key++} className="text-amber-600">{numMatch[1]}</span>);
      remaining = remaining.slice(numMatch[0].length);
      continue;
    }

    // Match boolean/null
    const boolMatch = remaining.match(/^(true|false|null)/);
    if (boolMatch) {
      parts.push(<span key={key++} className="text-purple-600">{boolMatch[1]}</span>);
      remaining = remaining.slice(boolMatch[0].length);
      continue;
    }

    // Consume one character (brackets, commas, whitespace)
    parts.push(<span key={key++} className="text-gray-400">{remaining[0]}</span>);
    remaining = remaining.slice(1);
  }

  return <>{parts}</>;
}

/* ── Schema tab ── */

function SchemaTab({ run }: { run: Run | null }) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  if (!run) return <EmptyState icon={Braces} text="No schema data" sub="Select a run to view schema" />;

  const validation = run.schema_validation;
  const output = run.output;
  const passed = validation?.startsWith("passed");
  const hasOutput = output && Object.keys(output).length > 0;
  const outputKeys = hasOutput ? Object.keys(output as Record<string, unknown>) : [];
  const jsonString = hasOutput ? JSON.stringify(output, null, 2) : "";
  const jsonLines = jsonString.split("\n");
  const modelLabel = run.model_name || run.model_provider || "";

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      {/* Status banner */}
      {validation && validation !== "not_applicable" && (
        <div className={`rounded-xl overflow-hidden mb-4 ${passed ? "bg-blue-500" : "bg-red-500"}`}>
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="h-7 w-7 rounded-full bg-white flex items-center justify-center shrink-0">
              {passed ? (
                <CheckCircle2 className="h-4 w-4 text-blue-500" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
            </div>
            <div>
              <span className="text-[13px] font-semibold text-white block leading-tight">
                {passed ? "Schema passed" : "Schema failed"}
              </span>
              <span className="text-[11px] text-white/80 leading-tight">
                {passed
                  ? "Output matches the expected schema."
                  : "Output did not match expected fields or types."}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Output data section */}
      {hasOutput && (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden mb-3">
          {/* Header */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center justify-between w-full px-4 py-3
                       hover:bg-gray-50 transition-colors cursor-pointer"
          >
            <div>
              <span className="text-[13px] font-semibold text-gray-900 block text-left">Output data</span>
              <span className="text-[11px] text-gray-400">{outputKeys.length} top-level field{outputKeys.length !== 1 ? "s" : ""}</span>
            </div>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            )}
          </button>

          {expanded && (
            <>
              {/* Field pills — dark filled */}
              <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                {outputKeys.slice(0, 10).map((key) => (
                  <span key={key} className="text-[11px] font-medium text-white bg-gray-800
                                             px-2.5 py-1 rounded-md">
                    {key}
                  </span>
                ))}
              </div>

              {/* JSON preview with line numbers + syntax colors */}
              <div className="border-t border-gray-200">
                <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">JSON Preview</span>
                  <button
                    onClick={handleCopy}
                    className="text-[11px] text-gray-400 hover:text-gray-600 cursor-pointer
                               flex items-center gap-1.5 transition-colors"
                  >
                    {copied ? (
                      <><CheckCircle2 className="h-3 w-3 text-blue-500" /> Copied</>
                    ) : (
                      <>Copy</>
                    )}
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto overflow-x-auto select-text">
                  <table className="w-full">
                    <tbody>
                      {jsonLines.map((line, i) => (
                        <tr key={i} className="hover:bg-blue-50/30">
                          <td className="text-[11px] text-gray-300 text-right pr-3 pl-3 py-0 select-none
                                         font-mono tabular-nums align-top leading-[20px] w-8 border-r border-gray-100">
                            {i + 1}
                          </td>
                          <td className="text-[11px] font-mono whitespace-pre py-0 pl-3
                                         leading-[20px]">
                            {colorizeJsonLine(line)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Model / Tokens / Duration summary */}
      <div className="border border-gray-200 rounded-xl bg-white divide-y divide-gray-100">
        {(run.model_provider || run.model_name) && (
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[13px] font-medium text-gray-900">Model</span>
            <div className="flex items-center gap-2">
              <ProviderIcon provider={run.model_provider || ""} />
              <span className="text-[13px] text-gray-500">{modelLabel}</span>
            </div>
          </div>
        )}
        {run.token_usage && (
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[13px] font-medium text-gray-900">Tokens</span>
            <span className="text-[13px] text-gray-500">
              {(run.token_usage.prompt_tokens || 0).toLocaleString()} input · {(run.token_usage.completion_tokens || 0).toLocaleString()} output
            </span>
          </div>
        )}
        {run.duration_ms && (
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[13px] font-medium text-gray-900">Duration</span>
            <span className="text-[13px] text-gray-500">{formatDuration(run.duration_ms)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Empty state ── */

function EmptyState({ icon: Icon, text, sub }: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
  sub: string;
}) {
  return (
    <div className="text-center py-8">
      <Icon className="h-8 w-8 text-gray-200 mx-auto mb-2" />
      <p className="text-[12px] text-gray-400">{text}</p>
      <p className="text-[11px] text-gray-300 mt-1">{sub}</p>
    </div>
  );
}

/* ── Main panel ── */

export function RuntimePanel({
  collapsed,
  onToggleCollapse,
  activeTab,
  onTabChange,
  workspaceId,
  pageId,
}: RuntimePanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const didAutoExpand = useRef(false);

  const loadRuns = useCallback(async () => {
    if (!workspaceId || !pageId) return;
    setLoading(true);
    const { data } = await supabase
      .from("runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("page_id", pageId)
      .order("created_at", { ascending: false })
      .limit(20);
    setRuns((data ?? []) as Run[]);
    setLoading(false);
    if (data && data.length > 0 && !didAutoExpand.current) {
      didAutoExpand.current = true;
      setExpandedRunId(data[0].id);
    }
  }, [workspaceId, pageId, supabase]);

  useEffect(() => {
    if (!collapsed && workspaceId && pageId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadRuns();
    }
  }, [collapsed, workspaceId, pageId, loadRuns]);

  useEffect(() => {
    if (collapsed || !workspaceId || !pageId) return;
    const interval = setInterval(loadRuns, 5000);
    return () => clearInterval(interval);
  }, [collapsed, workspaceId, pageId, loadRuns]);

  const selectedRun = runs.find((r) => r.id === expandedRunId) ?? runs[0] ?? null;

  if (collapsed) {
    return (
      <div className="flex h-full w-12 flex-col items-center border-l border-gray-200 bg-white pt-3">
        <button
          onClick={onToggleCollapse}
          className="h-8 w-8 flex items-center justify-center rounded-md
                     text-gray-400 hover:text-gray-700 hover:bg-gray-100
                     transition-colors cursor-pointer"
        >
          <PanelRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-[380px] flex-col border-l border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <h3 className="text-[14px] font-semibold text-gray-900">Runtime</h3>
        <button
          onClick={onToggleCollapse}
          className="h-7 w-7 flex items-center justify-center rounded-md
                     text-gray-400 hover:text-gray-600 hover:bg-gray-100
                     transition-colors cursor-pointer"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 px-2 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`flex items-center gap-1 px-2.5 py-2 text-[11px] font-medium
                       transition-colors cursor-pointer border-b-2
                       ${activeTab === tab.id
                         ? "border-blue-500 text-blue-600"
                         : "border-transparent text-gray-500 hover:text-gray-700"
                       }`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "activity" && (
          <div className="p-3">
            {loading && runs.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              </div>
            )}

            {!loading && runs.length === 0 && (
              <EmptyState icon={Activity} text="No runs yet" sub="Run an AI cell or command to see activity" />
            )}

            <div className="flex flex-col gap-2">
              {runs.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  expanded={expandedRunId === run.id}
                  onToggle={() =>
                    setExpandedRunId(expandedRunId === run.id ? null : run.id)
                  }
                />
              ))}
            </div>
          </div>
        )}

        {activeTab === "context" && (
          <div className="p-3">
            <ContextTab run={selectedRun} />
          </div>
        )}

        {activeTab === "schema" && (
          <div className="p-3">
            <SchemaTab run={selectedRun} />
          </div>
        )}
      </div>
    </div>
  );
}
