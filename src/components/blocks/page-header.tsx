"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Star,
  MoreHorizontal,
  Plus,
  Play,
  Link2,
  ChevronsUpDown,
  Search,
  Check,
  Copy,
  Archive,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Page, Notebook } from "@/lib/models/types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/* ── helpers ─────────────────────────────────────────────── */

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ── breadcrumb dropdown ─────────────────────────────────── */

interface BreadcrumbDropdownProps {
  items: { id: string; label: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  createLabel?: string;
  settingsLabel?: string;
  onSettings?: () => void;
}

function BreadcrumbDropdown({
  items,
  activeId,
  onSelect,
  onCreate,
  createLabel = "New",
  settingsLabel,
}: BreadcrumbDropdownProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = items.filter((item) =>
    item.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="absolute left-0 top-full mt-1.5 w-64 bg-white border border-gray-200
                    rounded-lg shadow-lg z-50 animate-in fade-in slide-in-from-top-1 duration-100">
      <div className="p-2 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-[13px] bg-gray-50 border border-gray-200 rounded-md
                       outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30
                       transition-colors placeholder:text-gray-400"
          />
        </div>
      </div>
      <div className="max-h-56 overflow-y-auto py-1 px-1">
        {filtered.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className="flex w-full items-center justify-between rounded-md px-3 py-2
                       text-[14px] text-gray-700 hover:bg-gray-50 cursor-pointer transition-colors"
          >
            <span className={item.id === activeId ? "font-medium text-gray-900" : ""}>
              {item.label}
            </span>
            {item.id === activeId && (
              <Check className="h-4 w-4 text-gray-400 shrink-0" />
            )}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-3 text-[13px] text-gray-400 text-center">
            No results
          </div>
        )}
      </div>
      {(settingsLabel || onCreate) && (
        <>
          <div className="border-t border-gray-100" />
          <div className="py-1 px-1">
            {settingsLabel && (
              <button
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2
                           text-[14px] text-gray-500 hover:bg-gray-50 cursor-pointer transition-colors"
              >
                {settingsLabel}
              </button>
            )}
            {onCreate && (
              <button
                onClick={onCreate}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2
                           text-[14px] text-gray-500 hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <Plus className="h-4 w-4" />
                {createLabel}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── breadcrumb segment ──────────────────────────────────── */

interface BreadcrumbSegmentProps {
  label: string;
  isBold?: boolean;
  items: { id: string; label: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  createLabel?: string;
  settingsLabel?: string;
}

function BreadcrumbSegment({
  label,
  isBold,
  items,
  activeId,
  onSelect,
  onCreate,
  createLabel,
  settingsLabel,
}: BreadcrumbSegmentProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleChevronClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setOpen((v) => !v);
    },
    []
  );

  return (
    <div className="relative flex items-center" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 h-7 px-2 rounded-md
                   text-[14px] hover:bg-gray-100
                   transition-colors cursor-pointer
                   ${isBold ? "font-semibold text-gray-900" : "font-medium text-gray-500 hover:text-gray-900"}`}
      >
        <span className="truncate max-w-[180px]">{label}</span>
        <ChevronsUpDown
          className="h-3.5 w-3.5 text-gray-400 shrink-0"
          onClick={handleChevronClick}
        />
      </button>

      {open && (
        <BreadcrumbDropdown
          items={items}
          activeId={activeId}
          onSelect={(id) => { onSelect(id); setOpen(false); }}
          onCreate={onCreate ? () => { onCreate(); setOpen(false); } : undefined}
          createLabel={createLabel}
          settingsLabel={settingsLabel}
        />
      )}
    </div>
  );
}

/* ── page header ─────────────────────────────────────────── */

interface PageHeaderProps {
  page: Page;
  notebooks: Notebook[];
  pages: Record<string, Page[]>;
  onTitleChange: (title: string) => void;
  onPageSelect: (pageId: string) => void;
  onCreatePage: (notebookId: string) => void;
  onCreateNotebook: () => void;
  onAddBlock?: () => void;
  onRunAll?: () => void;
  onStarToggle?: (starred: boolean) => void;
  onDuplicatePage?: () => void;
  onArchivePage?: () => void;
  onDeletePage?: () => void;
}

export function PageHeader({
  page,
  notebooks,
  pages,
  onTitleChange,
  onPageSelect,
  onCreatePage,
  onCreateNotebook,
  onAddBlock,
  onRunAll,
  onStarToggle,
  onDuplicatePage,
  onArchivePage,
  onDeletePage,
}: PageHeaderProps) {
  const [linkedSourceCount, setLinkedSourceCount] = useState(0);
  const supabase = useMemo(() => createClient(), []);

  const currentNotebook = notebooks.find((n) => n.id === page.notebook_id);
  const notebookPages = useMemo(
    () => pages[page.notebook_id] ?? [],
    [pages, page.notebook_id]
  );
  const isStarred = Boolean(page.is_starred);

  useEffect(() => {
    async function countSources() {
      let count = 0;

      // Count file and source_card blocks on the page
      const { count: blockCount } = await supabase
        .from("blocks")
        .select("id", { count: "exact", head: true })
        .eq("page_id", page.id)
        .in("type", ["file", "source_card"]);
      count += blockCount ?? 0;

      // Count unique sources from completed runs on this page
      const { data: runs } = await supabase
        .from("runs")
        .select("input")
        .eq("page_id", page.id)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(20);

      const seenSources = new Set<string>();
      for (const run of runs ?? []) {
        const input = run.input as Record<string, unknown> | null;
        if (!input) continue;
        const sources = input.sources as Array<{ type: string; [key: string]: unknown }> | undefined;
        if (!Array.isArray(sources)) continue;
        for (const s of sources) {
          const key = s.type === "block" ? `block:${(s as Record<string, unknown>).blockId}`
            : s.type === "file" ? `file:${(s as Record<string, unknown>).fileId}`
            : s.type === "url" ? `url:${(s as Record<string, unknown>).url}`
            : s.type === "paste" ? `paste:${String((s as Record<string, unknown>).content).slice(0, 50)}`
            : null;
          if (key) seenSources.add(key);
        }
      }
      count += seenSources.size;

      // Count control panel source inputs
      const { data: panels } = await supabase
        .from("blocks")
        .select("content")
        .eq("page_id", page.id)
        .eq("type", "input_group");
      for (const panel of panels ?? []) {
        const inputs = (panel.content as Record<string, unknown>)?.inputs;
        if (!Array.isArray(inputs)) continue;
        for (const inp of inputs) {
          const input = inp as Record<string, unknown>;
          if (input.input_type === "source" && Array.isArray(input.value)) {
            count += (input.value as unknown[]).length;
          }
        }
      }

      setLinkedSourceCount(count);
    }
    countSources();
  }, [supabase, page.id]);

  const handleNotebookSelect = useCallback(
    (notebookId: string) => {
      const nbPages = pages[notebookId];
      if (nbPages && nbPages.length > 0) {
        onPageSelect(nbPages[0].id);
      }
    },
    [pages, onPageSelect]
  );

  return (
    <div className="mb-5">
      {/* Row 1: Breadcrumb  ·  right-side meta */}
      <div className="flex items-center justify-between mb-3">
        {/* Breadcrumb — clickable segments with chevrons */}
        <nav className="flex items-center gap-0 min-w-0 -ml-2">
          <BreadcrumbSegment
            label={currentNotebook?.name ?? "Notebooks"}
            items={notebooks.map((n) => ({ id: n.id, label: n.name }))}
            activeId={page.notebook_id}
            onSelect={handleNotebookSelect}
            onCreate={onCreateNotebook}
            createLabel="New notebook"
          />

          <span className="text-gray-300 text-[14px] mx-0.5 select-none">/</span>

          <BreadcrumbSegment
            label={page.title}
            isBold
            items={notebookPages.map((p) => ({ id: p.id, label: p.title }))}
            activeId={page.id}
            onSelect={onPageSelect}
            onCreate={() => onCreatePage(page.notebook_id)}
            createLabel="New page"
          />

          {/* Star / favorite — next to the page name like inspo */}
          <button
            type="button"
            aria-label={isStarred ? "Unstar page" : "Star page"}
            aria-pressed={isStarred}
            onClick={() => onStarToggle?.(!isStarred)}
            className={`h-7 w-7 flex items-center justify-center rounded-md
                       hover:text-yellow-400 transition-colors cursor-pointer ml-0.5
                       ${isStarred ? "text-yellow-400" : "text-gray-300"}`}
          >
            <Star className={`h-4 w-4 ${isStarred ? "fill-current" : ""}`} />
          </button>
        </nav>

        {/* Right: Updated · | · ··· */}
        <div className="flex items-center gap-2.5 shrink-0 ml-4">
          <span className="text-[13px] text-gray-400">
            Updated {timeAgo(page.updated_at)}
          </span>

          <div className="h-4 w-px bg-gray-200" />

          <DropdownMenu>
            <DropdownMenuTrigger
              className="h-7 w-7 flex items-center justify-center rounded-md
                         text-gray-400 hover:text-gray-600 hover:bg-gray-100
                         transition-colors cursor-pointer"
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4} className="min-w-[160px]">
              <DropdownMenuItem onClick={() => onDuplicatePage?.()} className="whitespace-nowrap">
                <Copy className="h-4 w-4 text-gray-400" />
                Duplicate page
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onArchivePage?.()} className="whitespace-nowrap">
                <Archive className="h-4 w-4 text-gray-400" />
                Archive page
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDeletePage?.()} className="whitespace-nowrap">
                <Trash2 className="h-4 w-4" />
                Delete page
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Row 2: Title */}
      <input
        type="text"
        value={page.title === "Untitled" ? "" : page.title}
        onChange={(e) => onTitleChange(e.target.value || "Untitled")}
        placeholder="Untitled"
        className="w-full text-[32px] font-bold text-gray-900 tracking-tight leading-tight
                   bg-transparent border-none outline-none placeholder:text-gray-300 mb-3"
      />

      {/* Row 3: Action bar */}
      <div className="flex items-center gap-2.5 mb-3">
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onAddBlock?.()}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded
                     border border-gray-300 bg-white text-[13px] font-medium text-gray-700
                     hover:bg-gray-50 hover:border-gray-400 transition-colors cursor-pointer
                     shadow-sm"
        >
          <Plus className="h-3.5 w-3.5" />
          Add block
        </button>

        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onRunAll?.()}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded
                     border border-gray-300 bg-white text-[13px] font-medium text-gray-700
                     hover:bg-gray-50 hover:border-gray-400 transition-colors cursor-pointer
                     shadow-sm"
        >
          <Play className="h-3.5 w-3.5 text-blue-500 fill-blue-500" />
          Run all
        </button>

        <span
          className="inline-flex items-center gap-1.5 h-8 px-3 text-[13px] text-gray-400"
        >
          <Link2 className="h-3.5 w-3.5" />
          {linkedSourceCount} linked source{linkedSourceCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-100" />
    </div>
  );
}
