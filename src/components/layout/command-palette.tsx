"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  FileText,
  Terminal,
  Settings,
  Plus,
  Play,
  Download,
  CheckCircle2,
  XCircle,
  FolderPlus,
  Sparkles,
  Table,
  Braces,
  Code2,
  ImageIcon,
  CheckSquare,
  Type,
  Minus,
  List,
  ListOrdered,
  MessageSquareQuote,
  LayoutDashboard,
} from "lucide-react";
import type { Command } from "@/lib/models/types";

interface SearchResultPage {
  id: string;
  title: string;
  notebookId: string;
  notebookName: string;
  updatedAt: string;
}

interface SearchResultCommand {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface SearchResultAction {
  id: string;
  label: string;
  shortcut?: string;
  type: "create" | "navigate" | "action";
}

interface RecentRun {
  id: string;
  label: string;
  commandSlug?: string;
  pageId?: string;
  pageName?: string;
  status: "completed" | "failed" | "cancelled";
  timestamp: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  workspaceId?: string;
  onPageSelect: (pageId: string) => void;
  onInsertCommand?: (command: Command) => void;
  onInsertBlock?: (type: string) => void;
  onCreatePage?: () => void;
  onCreateNotebook?: () => void;
  onNavigateSettings?: () => void;
  onRunAll?: () => void;
  onExportPage?: () => void;
  onRunSelect?: (run: RecentRun) => void;
}

const ACTION_DEFS: Array<{ id: string; icon: React.ElementType; iconBg: string; iconColor: string }> = [
  { id: "new-page", icon: Plus, iconBg: "bg-blue-50", iconColor: "text-blue-500" },
  { id: "new-notebook", icon: FolderPlus, iconBg: "bg-blue-50", iconColor: "text-blue-500" },
  { id: "settings", icon: Settings, iconBg: "bg-gray-100", iconColor: "text-gray-500" },
  { id: "run-all", icon: Play, iconBg: "bg-green-50", iconColor: "text-green-500" },
  { id: "export", icon: Download, iconBg: "bg-gray-100", iconColor: "text-gray-500" },
];

const BLOCK_TYPES = [
  { id: "text", label: "Text", icon: Type, iconBg: "bg-gray-100", iconColor: "text-gray-500" },
  { id: "ai_cell", label: "AI Cell", icon: Sparkles, iconBg: "bg-blue-50", iconColor: "text-blue-500" },
  { id: "table", label: "Table", icon: Table, iconBg: "bg-blue-50", iconColor: "text-blue-500" },
  { id: "json", label: "JSON", icon: Braces, iconBg: "bg-blue-50", iconColor: "text-blue-500" },
  { id: "code", label: "Code", icon: Code2, iconBg: "bg-blue-50", iconColor: "text-blue-500" },
  { id: "image", label: "Image", icon: ImageIcon, iconBg: "bg-blue-50", iconColor: "text-blue-500" },
  { id: "todo", label: "To-do", icon: CheckSquare, iconBg: "bg-gray-100", iconColor: "text-gray-500" },
  { id: "bulleted_list", label: "Bulleted List", icon: List, iconBg: "bg-gray-100", iconColor: "text-gray-500" },
  { id: "numbered_list", label: "Numbered List", icon: ListOrdered, iconBg: "bg-gray-100", iconColor: "text-gray-500" },
  { id: "callout", label: "Callout", icon: MessageSquareQuote, iconBg: "bg-gray-100", iconColor: "text-gray-500" },
  { id: "separator", label: "Separator", icon: Minus, iconBg: "bg-gray-100", iconColor: "text-gray-500" },
  { id: "input_group", label: "Control Panel", icon: LayoutDashboard, iconBg: "bg-gray-100", iconColor: "text-gray-500" },
];

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function IconBox({ icon: Icon, bg, color }: { icon: React.ElementType; bg: string; color: string }) {
  return (
    <div className={`h-8 w-8 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
      <Icon className={`h-[18px] w-[18px] ${color}`} />
    </div>
  );
}

export function CommandPalette({
  open,
  onClose,
  workspaceId,
  onPageSelect,
  onInsertCommand,
  onInsertBlock,
  onCreatePage,
  onCreateNotebook,
  onNavigateSettings,
  onRunAll,
  onExportPage,
  onRunSelect,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<SearchResultPage[]>([]);
  const [commands, setCommands] = useState<SearchResultCommand[]>([]);
  const [actions, setActions] = useState<SearchResultAction[]>([]);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestSeqRef = useRef(0);

  const mode = query.startsWith("/")
    ? "command"
    : query.startsWith(">")
      ? "action"
      : query.startsWith("#")
        ? "block"
        : "all";
  const searchQuery = mode === "all" ? query : query.slice(1).trimStart();

  const filteredBlocks = useMemo(() => {
    if (mode !== "block" && mode !== "all") return [];
    if (mode === "all" && query) return [];
    const q = searchQuery.toLowerCase();
    return q
      ? BLOCK_TYPES.filter((b) => b.label.toLowerCase().includes(q) || b.id.includes(q))
      : BLOCK_TYPES;
  }, [mode, query, searchQuery]);

  const handleClose = useCallback(() => {
    onClose();
    setQuery("");
    setSelectedIndex(0);
  }, [onClose]);

  const allItems = useMemo(() => {
    const items: Array<{
      type: "action" | "command" | "page" | "run" | "block";
      id: string;
      data: unknown;
    }> = [];

    if (mode === "all" || mode === "action") {
      actions.forEach((a) => items.push({ type: "action", id: a.id, data: a }));
    }
    if (mode === "block") {
      filteredBlocks.forEach((b) => items.push({ type: "block", id: b.id, data: b }));
    }
    if (mode === "all" || mode === "command") {
      commands.forEach((c) => items.push({ type: "command", id: c.id, data: c }));
    }
    if (mode === "all") {
      pages.forEach((p) => items.push({ type: "page", id: p.id, data: p }));
      if (!searchQuery) {
        filteredBlocks.slice(0, 6).forEach((b) => items.push({ type: "block", id: b.id, data: b }));
        recentRuns.forEach((r) => items.push({ type: "run", id: r.id, data: r }));
      }
    }

    return items;
  }, [actions, commands, mode, pages, recentRuns, searchQuery, filteredBlocks]);

  const activeIndex =
    allItems.length === 0 ? 0 : Math.min(selectedIndex, allItems.length - 1);

  const fetchResults = useCallback(
    async (q: string) => {
      if (!workspaceId) return;
      const requestSeq = requestSeqRef.current + 1;
      requestSeqRef.current = requestSeq;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search/global?q=${encodeURIComponent(q)}&workspaceId=${workspaceId}`
        );
        if (res.ok) {
          const data = await res.json();
          if (requestSeq !== requestSeqRef.current) return;
          setPages(data.pages ?? []);
          setCommands(data.commands ?? []);
          setActions(data.actions ?? []);
        }
      } catch {
        // silently fail
      } finally {
        if (requestSeq === requestSeqRef.current) setLoading(false);
      }
    },
    [workspaceId]
  );

  const fetchRecentRuns = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(
        `/api/runs?workspaceId=${workspaceId}&limit=5`
      );
      if (res.ok) {
        const data = await res.json();
        const runs = (data.runs ?? data ?? []).slice(0, 5);
        setRecentRuns(
          runs.map((r: Record<string, unknown>) => ({
            id: r.id as string,
            label: (r.command_name as string) || (r.type === "ai_cell" ? "AI Cell run" : "Run"),
            commandSlug: r.command_slug as string | undefined,
            pageId: r.page_id as string | undefined,
            pageName: r.page_title as string | undefined,
            status:
              r.status === "completed"
                ? "completed"
                : r.status === "cancelled"
                  ? "cancelled"
                  : "failed",
            timestamp: r.created_at as string,
          }))
        );
      }
    } catch {
      setRecentRuns([]);
    }
  }, [workspaceId]);

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      fetchResults("");
      fetchRecentRuns();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    prevOpenRef.current = open;
  }, [open, fetchResults, fetchRecentRuns]);

  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchResults(searchQuery);
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery, open, fetchResults]);

  const executeItem = useCallback(
    (item: (typeof allItems)[number]) => {
      handleClose();
      switch (item.type) {
        case "action": {
          const action = item.data as SearchResultAction;
          switch (action.id) {
            case "new-page": onCreatePage?.(); break;
            case "new-notebook": onCreateNotebook?.(); break;
            case "settings": onNavigateSettings?.(); break;
            case "run-all": onRunAll?.(); break;
            case "export": onExportPage?.(); break;
          }
          break;
        }
        case "command": {
          const cmd = item.data as SearchResultCommand;
          onInsertCommand?.({
            id: cmd.id,
            name: cmd.name,
            slug: cmd.slug,
            description: cmd.description,
          } as Command);
          break;
        }
        case "page": {
          const page = item.data as SearchResultPage;
          onPageSelect(page.id);
          break;
        }
        case "run": {
          const run = item.data as RecentRun;
          onRunSelect?.(run);
          break;
        }
        case "block": {
          const block = item.data as (typeof BLOCK_TYPES)[number];
          onInsertBlock?.(block.id);
          break;
        }
      }
    },
    [handleClose, onPageSelect, onInsertCommand, onInsertBlock, onCreatePage, onCreateNotebook, onNavigateSettings, onRunAll, onExportPage, onRunSelect]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => allItems.length === 0 ? 0 : Math.min(i + 1, allItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (allItems[activeIndex]) executeItem(allItems[activeIndex]);
          break;
        case "Escape":
          e.preventDefault();
          handleClose();
          break;
      }
    },
    [activeIndex, allItems, executeItem, handleClose]
  );

  useEffect(() => {
    const item = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const hasResults = allItems.length > 0;
  const emptyLabel =
    mode === "command" ? `No commands for "${searchQuery}"`
    : mode === "action" ? `No actions for "${searchQuery}"`
    : mode === "block" ? `No block types for "${searchQuery}"`
    : `No results for "${query}"`;

  let globalIdx = 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/40" />

      <div
        className="relative w-full max-w-[560px] rounded-xl bg-white shadow-2xl border border-gray-200
                   overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-200">
          <Search className="h-[18px] w-[18px] text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, commands, actions..."
            className="flex-1 text-[15px] text-gray-900 placeholder-gray-400
                       bg-transparent outline-none"
          />
          <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded
                          bg-gray-100 border border-gray-200 text-[11px] text-gray-400 font-medium">
            ⌘K
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto">
          {!hasResults && !loading && (
            <div className="px-4 py-8 text-center text-[13px] text-gray-400">
              {query ? emptyLabel : "Type to search. Use / for commands, # for blocks, > for actions."}
            </div>
          )}

          {/* Actions section */}
          {actions.length > 0 && (mode === "all" || mode === "action") && (() => {
            const startIdx = globalIdx;
            const section = (
              <div key="actions">
                <SectionHeader label={searchQuery ? "Actions" : "Suggested Actions"} />
                {actions.map((action, i) => {
                  const idx = startIdx + i;
                  const def = ACTION_DEFS.find((d) => d.id === action.id);
                  const Icon = def?.icon || Plus;
                  return (
                    <PaletteRow
                      key={action.id}
                      index={idx}
                      selected={activeIndex === idx}
                      onSelect={() => setSelectedIndex(idx)}
                      onExecute={() => executeItem(allItems[idx])}
                    >
                      <IconBox icon={Icon} bg={def?.iconBg || "bg-gray-100"} color={def?.iconColor || "text-gray-500"} />
                      <span className="flex-1 text-[13px] font-medium text-gray-800 truncate">
                        {action.label}
                      </span>
                      {action.shortcut && (
                        <kbd className="px-1.5 py-0.5 rounded bg-gray-100 border border-gray-200 text-[10px] text-gray-400 font-medium">
                          {action.shortcut}
                        </kbd>
                      )}
                    </PaletteRow>
                  );
                })}
              </div>
            );
            globalIdx += actions.length;
            return section;
          })()}

          {/* Commands section */}
          {commands.length > 0 && (mode === "all" || mode === "command") && (() => {
            const startIdx = globalIdx;
            const section = (
              <div key="commands">
                <SectionDivider />
                <SectionHeader label="Commands" />
                {commands.map((cmd, i) => {
                  const idx = startIdx + i;
                  return (
                    <PaletteRow
                      key={cmd.id}
                      index={idx}
                      selected={activeIndex === idx}
                      onSelect={() => setSelectedIndex(idx)}
                      onExecute={() => executeItem(allItems[idx])}
                    >
                      <IconBox icon={Terminal} bg="bg-blue-50" color="text-blue-500" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-gray-900 truncate">
                            /{cmd.slug}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-blue-600 bg-blue-50 border border-blue-100 shrink-0">
                            Callable
                          </span>
                        </div>
                        {cmd.description && (
                          <p className="text-[12px] text-gray-400 truncate mt-0.5">
                            {cmd.description}
                          </p>
                        )}
                      </div>
                    </PaletteRow>
                  );
                })}
              </div>
            );
            globalIdx += commands.length;
            return section;
          })()}

          {/* Pages section */}
          {pages.length > 0 && mode === "all" && (() => {
            const startIdx = globalIdx;
            const section = (
              <div key="pages">
                <SectionDivider />
                <SectionHeader label="Pages" />
                {pages.map((page, i) => {
                  const idx = startIdx + i;
                  return (
                    <PaletteRow
                      key={page.id}
                      index={idx}
                      selected={activeIndex === idx}
                      onSelect={() => setSelectedIndex(idx)}
                      onExecute={() => executeItem(allItems[idx])}
                    >
                      <IconBox icon={FileText} bg="bg-gray-100" color="text-gray-500" />
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] font-medium text-gray-900 truncate block">
                          {page.title || "Untitled"}
                        </span>
                        <span className="text-[11px] text-gray-400 truncate block">
                          {page.notebookName}
                        </span>
                      </div>
                      <span className="text-[11px] text-gray-400 shrink-0">
                        {relativeTime(page.updatedAt)}
                      </span>
                    </PaletteRow>
                  );
                })}
              </div>
            );
            globalIdx += pages.length;
            return section;
          })()}

          {/* Insert Block section — only when on a page */}
          {onInsertBlock && filteredBlocks.length > 0 && (mode === "block" || (mode === "all" && !searchQuery)) && (() => {
            const blocksToShow = mode === "all" ? filteredBlocks.slice(0, 6) : filteredBlocks;
            const startIdx = globalIdx;
            const section = (
              <div key="blocks">
                <SectionDivider />
                <SectionHeader label="Insert Block" />
                {blocksToShow.map((block, i) => {
                  const idx = startIdx + i;
                  return (
                    <PaletteRow
                      key={block.id}
                      index={idx}
                      selected={activeIndex === idx}
                      onSelect={() => setSelectedIndex(idx)}
                      onExecute={() => executeItem(allItems[idx])}
                    >
                      <IconBox icon={block.icon} bg={block.iconBg} color={block.iconColor} />
                      <span className="flex-1 text-[13px] font-medium text-gray-800 truncate">
                        {block.label}
                      </span>
                    </PaletteRow>
                  );
                })}
              </div>
            );
            globalIdx += blocksToShow.length;
            return section;
          })()}

          {/* Recent Runs section */}
          {recentRuns.length > 0 && mode === "all" && !searchQuery && (() => {
            const startIdx = globalIdx;
            const section = (
              <div key="runs">
                <SectionDivider />
                <SectionHeader label="Recent Runs" />
                {recentRuns.map((run, i) => {
                  const idx = startIdx + i;
                  const StatusIcon = run.status === "completed" ? CheckCircle2 : XCircle;
                  const statusBg = run.status === "completed" ? "bg-green-50" : "bg-red-50";
                  const statusColor = run.status === "completed" ? "text-green-500" : run.status === "cancelled" ? "text-gray-400" : "text-red-500";
                  return (
                    <PaletteRow
                      key={run.id}
                      index={idx}
                      selected={activeIndex === idx}
                      onSelect={() => setSelectedIndex(idx)}
                      onExecute={() => executeItem(allItems[idx])}
                    >
                      <IconBox icon={StatusIcon} bg={statusBg} color={statusColor} />
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] font-medium text-gray-900 truncate block">
                          {run.label}
                        </span>
                        {(run.commandSlug || run.pageName) && (
                          <span className="text-[11px] text-gray-400 truncate block">
                            {run.commandSlug ? `/${run.commandSlug}` : ""}{run.commandSlug && run.pageName ? " · " : ""}{run.pageName ?? ""}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-gray-400 shrink-0">
                        {relativeTime(run.timestamp)}
                      </span>
                    </PaletteRow>
                  );
                })}
              </div>
            );
            globalIdx += recentRuns.length;
            return section;
          })()}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-gray-200 bg-gray-50/80">
          <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <kbd className="px-1 py-0.5 rounded bg-gray-100 border border-gray-200 text-[10px] font-medium">↑↓</kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <kbd className="px-1 py-0.5 rounded bg-gray-100 border border-gray-200 text-[10px] font-medium">↵</kbd>
            Open
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <kbd className="px-1 py-0.5 rounded bg-gray-100 border border-gray-200 text-[10px] font-medium">esc</kbd>
            Close
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 pt-3 pb-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {label}
      </span>
    </div>
  );
}

function SectionDivider() {
  return <div className="mx-3 border-t border-gray-100" />;
}

function PaletteRow({
  children,
  index,
  selected,
  onSelect,
  onExecute,
}: {
  children: React.ReactNode;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onExecute: () => void;
}) {
  return (
    <button
      data-index={index}
      className={`w-full flex items-center gap-3 px-4 py-2 text-left cursor-pointer
                  transition-colors duration-75 rounded-md mx-0
                  ${selected ? "bg-blue-50" : "hover:bg-gray-50"}`}
      onMouseEnter={onSelect}
      onClick={onExecute}
    >
      {children}
    </button>
  );
}
