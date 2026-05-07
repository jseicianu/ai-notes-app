"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search,
  Plus,
  CornerDownRight,
  Trash2,
  Copy,
  Check,
  ArrowUpDown,
  Filter,
  Pencil,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Command } from "@/lib/models/types";

interface CommandLibraryProps {
  workspaceId: string;
  onBack: () => void;
  onInsertCommand?: (command: Command) => void;
  onEditCommand?: (command: Command) => void;
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getOutputType(schema: Record<string, unknown>): string {
  const props = schema?.properties as Record<string, unknown> | undefined;
  if (!props) return "Text";
  const keys = Object.keys(props);
  const hasArray = keys.some((k) => (props[k] as Record<string, unknown>)?.type === "array");
  if (hasArray && keys.length > 1) return "Table+JSON";
  if (hasArray) return "Table";
  return "JSON";
}

function CommandCard({
  command,
  selected,
  onSelect,
  onEdit,
  onCopySlug,
  copiedSlug,
  onArchive,
}: {
  command: Command;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onCopySlug: () => void;
  copiedSlug: boolean;
  onArchive: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const outputType = getOutputType(command.output_schema);

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
      tabIndex={0}
      className={`flex flex-col w-full text-left px-3.5 py-3 rounded-md
                  border transition-all duration-150 cursor-pointer relative
                  ${selected
                    ? "border-blue-300 bg-blue-50/50 shadow-sm"
                    : "border-gray-200 hover:border-gray-300 hover:shadow-sm bg-white"
                  }`}
    >
      {/* Blue left accent on selected */}
      {selected && (
        <div className="absolute left-0 top-3 bottom-3 w-[3px] bg-blue-500 rounded-r" />
      )}

      {/* Top row: name + input count + output type */}
      <div className="flex items-start justify-between gap-2 w-full">
        <div className="min-w-0">
          <span className="text-[13px] font-medium text-gray-900 truncate block">
            {command.name}
          </span>
          <span className="text-[11px] font-mono text-gray-400 truncate block mt-0.5">
            /{command.slug}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {command.inputs.length > 0 && (
            <div className="flex items-center gap-1 text-[11px] text-gray-400">
              <CornerDownRight className="h-3 w-3" />
              <span>{command.inputs.length}</span>
            </div>
          )}
          <span className="text-[10px] font-medium text-gray-500 bg-gray-100
                           px-1.5 py-0.5 rounded">
            {outputType}
          </span>
        </div>
      </div>

      {/* Bottom row: time ago + dot + actions */}
      <div className="flex items-center justify-between mt-2 w-full">
        <span className="text-[11px] text-gray-400">
          {timeAgo(command.updated_at)}
        </span>

        <div className="flex items-center gap-2">
          {/* Hover actions */}
          <div className={`flex items-center gap-0.5 transition-opacity duration-100
            ${hovered ? "opacity-100" : "opacity-0"}`}
          >
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="h-5 w-5 flex items-center justify-center rounded
                       text-gray-400 hover:text-gray-600 hover:bg-gray-200
                       transition-colors cursor-pointer"
            title="Edit command"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onCopySlug(); }}
            className="h-5 w-5 flex items-center justify-center rounded
                       text-gray-400 hover:text-gray-600 hover:bg-gray-200
                       transition-colors cursor-pointer"
            title="Copy slug"
          >
            {copiedSlug ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className="h-5 w-5 flex items-center justify-center rounded
                       text-gray-400 hover:text-red-500 hover:bg-red-50
                       transition-colors cursor-pointer"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          </div>
          <div className="h-2 w-2 rounded-full bg-blue-400 shrink-0" />
        </div>
      </div>
    </div>
  );
}

export function CommandLibrary({
  workspaceId,
  onInsertCommand,
  onEditCommand,
}: CommandLibraryProps) {
  const supabase = useMemo(() => createClient(), []);
  const [commands, setCommands] = useState<Command[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "updated">("updated");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("commands")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("is_archived", false)
        .order("updated_at", { ascending: false });

      setCommands((data ?? []) as Command[]);
      setLoading(false);
    }
    load();
  }, [supabase, workspaceId]);

  const filtered = useMemo(() => {
    let result = commands;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q)
      );
    }
    if (sortBy === "name") {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    }
    return result;
  }, [commands, search, sortBy]);

  const handleCopySlug = useCallback((slug: string) => {
    navigator.clipboard.writeText(`/${slug}`);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 1500);
  }, []);

  const handleArchive = useCallback(
    async (commandId: string) => {
      setCommands((prev) => prev.filter((c) => c.id !== commandId));
      await supabase
        .from("commands")
        .update({ is_archived: true, updated_at: new Date().toISOString() })
        .eq("id", commandId);
    },
    [supabase]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Commands
        </span>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md
                     bg-blue-500 text-white text-[12px] font-medium
                     hover:bg-blue-600 transition-colors cursor-pointer shadow-sm"
        >
          <Plus className="h-3.5 w-3.5" />
          New Command
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-3 shrink-0">
        <label className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-md
                          focus-within:border-gray-300 transition-colors">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none
                       placeholder:text-gray-400 min-w-0"
          />
          <kbd className="text-[11px] font-mono text-gray-400 border border-gray-200
                          bg-gray-50 px-1.5 py-0.5 rounded shrink-0">⌘K</kbd>
        </label>
      </div>

      {/* Sort / Filter row */}
      <div className="flex items-center gap-2 px-3 pb-3 shrink-0">
        <button
          onClick={() => setSortBy(sortBy === "updated" ? "name" : "updated")}
          className="flex-[3] flex items-center justify-between px-3 py-2 text-[12px]
                     font-semibold text-gray-700 border border-gray-200 rounded-md
                     hover:bg-gray-50 hover:border-gray-300
                     transition-all cursor-pointer whitespace-nowrap"
        >
          <span>Sort: {sortBy === "updated" ? "Last run" : "Name"}</span>
          <ArrowUpDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        </button>
        <button
          className="flex-[2] flex items-center justify-between px-3 py-2 text-[12px]
                     font-semibold text-gray-700 border border-gray-200 rounded-md
                     hover:bg-gray-50 hover:border-gray-300
                     transition-all cursor-pointer"
        >
          <span>Filter</span>
          <Filter className="h-3.5 w-3.5 text-gray-400" />
        </button>
      </div>

      {/* Command cards */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="py-8 text-center text-[13px] text-gray-400">
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-[13px] text-gray-400">
              {search ? "No commands match your search." : "No commands yet."}
            </p>
            <p className="text-[12px] text-gray-300 mt-1.5">
              Run an AI cell and click Make Reusable to create one.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((command) => (
              <CommandCard
                key={command.id}
                command={command}
                selected={selectedId === command.id}
                onSelect={() => {
                  setSelectedId(command.id);
                  onInsertCommand?.(command);
                }}
                onEdit={() => onEditCommand?.(command)}
                onCopySlug={() => handleCopySlug(command.slug)}
                copiedSlug={copiedSlug === command.slug}
                onArchive={() => handleArchive(command.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
