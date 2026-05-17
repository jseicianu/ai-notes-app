"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search,
  Plus,
  Star,
  Pencil,
  ArrowRight,
  Terminal,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CommandDetailModal } from "@/components/blocks/command-detail-modal";
import type { Command } from "@/lib/models/types";

interface CommandLibraryProps {
  workspaceId: string;
  onBack: () => void;
  onInsertCommand?: (command: Command) => void;
  onEditCommand?: (command: Command) => void;
}

function CommandRow({
  command,
  selected,
  starred,
  onSelect,
  onInsert,
  onEdit,
  onViewDetails,
  onToggleStar,
}: {
  command: Command;
  selected: boolean;
  starred: boolean;
  onSelect: () => void;
  onInsert: () => void;
  onEdit: () => void;
  onViewDetails: () => void;
  onToggleStar: () => void;
}) {
  return (
    <div
      className={`flex flex-col w-full text-left rounded-md
                  transition-all duration-150 group/row
                  ${selected
                    ? "border border-blue-300 bg-blue-50/40"
                    : "border border-transparent hover:bg-gray-50"
                  }`}
    >
      <div className="px-3 py-2.5 cursor-pointer" onClick={onSelect}>
        {/* Top row: slug + star */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Terminal className={`h-3.5 w-3.5 shrink-0 transition-colors duration-150
              ${selected ? "text-blue-500" : "text-gray-400"}`}
            />
            <span className={`text-[13px] font-medium truncate
              ${selected ? "text-blue-600" : "text-gray-800"}`}
            >
              /{command.slug}
            </span>
          </div>
          <button
            onClick={onToggleStar}
            className={`h-5 w-5 flex items-center justify-center rounded shrink-0
                       transition-colors cursor-pointer
                       ${starred
                         ? "text-blue-500 hover:text-blue-600"
                         : selected
                           ? "text-gray-300 hover:text-blue-500"
                           : "text-gray-300 hover:text-blue-500 opacity-0 group-hover/row:opacity-100"
                       }`}
            title={starred ? "Unstar" : "Star"}
          >
            <Star className={`h-3 w-3 ${starred ? "fill-blue-500" : ""}`} />
          </button>
        </div>

        {/* Bottom row: description + edit */}
        <div className="flex items-center justify-between gap-2 mt-0.5 pl-[22px]">
          <span className="text-[12px] text-gray-400 truncate min-w-0">
            {command.description || command.name}
          </span>
          <button
            onClick={onEdit}
            className="h-5 w-5 flex items-center justify-center rounded shrink-0
                       text-gray-300 hover:text-gray-600 hover:bg-gray-200
                       transition-colors cursor-pointer opacity-0 group-hover/row:opacity-100"
            title="Edit command"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Hover action row */}
      <div className="grid grid-cols-2 h-0 overflow-hidden opacity-0
                      group-hover/row:h-[34px] group-hover/row:opacity-100
                      transition-all duration-150 ease-out border-t border-transparent
                      group-hover/row:border-gray-200">
        <button
          onClick={onInsert}
          className="flex items-center justify-center gap-1.5 text-[12px] font-medium
                     text-blue-600 bg-white hover:bg-blue-50/60
                     transition-colors cursor-pointer rounded-bl-md
                     border-r border-gray-200"
        >
          <Plus className="h-3 w-3" /> Insert
        </button>
        <button
          onClick={onViewDetails}
          className="flex items-center justify-center gap-1.5 text-[12px] font-medium
                     text-white bg-blue-500 hover:bg-blue-600
                     transition-colors cursor-pointer rounded-br-md"
        >
          Details <ArrowRight className="h-3 w-3" />
        </button>
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [detailCommand, setDetailCommand] = useState<Command | null>(null);

  const refreshCommands = useCallback(async () => {
    const { data } = await supabase
      .from("commands")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_archived", false)
      .order("updated_at", { ascending: false });
    setCommands((data ?? []) as Command[]);
    setLoading(false);
  }, [supabase, workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshCommands();
  }, [refreshCommands]);

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
    // Starred commands float to top
    result = [...result].sort((a, b) => {
      const aStarred = starredIds.has(a.id) ? 0 : 1;
      const bStarred = starredIds.has(b.id) ? 0 : 1;
      return aStarred - bStarred;
    });
    return result;
  }, [commands, search, starredIds]);

  const handleToggleStar = useCallback((commandId: string) => {
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(commandId)) next.delete(commandId);
      else next.add(commandId);
      return next;
    });
    // TODO: persist to backend once is_starred column exists on commands table
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Command Library
        </span>
        <button
          className="h-6 w-6 flex items-center justify-center rounded-md
                     text-gray-400 hover:text-gray-700 hover:bg-gray-100
                     transition-colors cursor-pointer"
          title="New command"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2 shrink-0">
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

      {/* Command list */}
      <div className="flex-1 overflow-y-auto px-1.5 pb-3">
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
          <div className="flex flex-col gap-0.5">
            {filtered.map((command) => (
              <CommandRow
                key={command.id}
                command={command}
                selected={selectedId === command.id}
                starred={starredIds.has(command.id)}
                onSelect={() => setSelectedId(command.id)}
                onInsert={() => {
                  setSelectedId(command.id);
                  onInsertCommand?.(command);
                }}
                onEdit={() => onEditCommand?.(command)}
                onViewDetails={() => {
                  setSelectedId(command.id);
                  setDetailCommand(command);
                }}
                onToggleStar={() => handleToggleStar(command.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* View all commands footer */}
      {!loading && commands.length > 0 && (
        <div className="px-3 pb-4 pt-2 shrink-0 border-t border-gray-100">
          <button
            className="flex w-full items-center justify-center gap-1.5 py-2 rounded-md
                       text-[12px] font-medium text-gray-500
                       hover:text-gray-700 hover:bg-gray-50
                       transition-all duration-150 cursor-pointer"
          >
            View all commands
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {detailCommand && (
        <CommandDetailModal
          command={detailCommand}
          open={!!detailCommand}
          onClose={() => setDetailCommand(null)}
          onInsert={(cmd) => onInsertCommand?.(cmd)}
          onEdit={(cmd) => onEditCommand?.(cmd)}
          onRefresh={refreshCommands}
        />
      )}
    </div>
  );
}
