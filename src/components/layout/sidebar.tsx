"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  FileText,
  Terminal,
  FolderOpen,
  Activity,
  Settings,
  ChevronRight,
  ChevronDown,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  LogOut,
  ChevronsUpDown,
  Bell,
  PanelLeftClose,
  PanelLeft,
  Star,
} from "lucide-react";
import { CommandLibrary } from "./command-library";
import type { Command, Notebook, Page } from "@/lib/models/types";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

interface SidebarProps {
  workspaceName: string;
  workspaceId?: string;
  notebooks: Notebook[];
  pages: Record<string, Page[]>;
  activePageId?: string;
  userName?: string;
  userEmail?: string;
  userAvatarUrl?: string;
  onPageSelect: (pageId: string) => void;
  onCreateNotebook: () => void;
  onCreatePage: (notebookId: string) => void;
  onInsertCommand?: (command: Command) => void;
  onEditCommand?: (command: Command) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavChange?: (nav: "pages" | "commands" | "files" | "runs" | "settings") => void;
}

/* ─── Nav item ─── */

function NavItem({
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2 rounded-md text-[14px]
                  transition-all duration-150 cursor-pointer
                  ${active
                    ? "bg-blue-50 text-blue-600 font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
    >
      <Icon className={`h-[18px] w-[18px] shrink-0 transition-colors duration-150
        ${active ? "text-blue-500" : "text-gray-400"}`}
      />
      <span>{label}</span>
    </button>
  );
}

/* ─── Page tree item ─── */

function PageTreeItem({
  page,
  isActive,
  onSelect,
}: {
  page: Page;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-2 px-2.5 py-[6px] rounded-md text-[13px]
                  transition-all duration-150 cursor-pointer group/page
                  ${isActive
                    ? "text-blue-600 font-medium"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  }`}
    >
      <FileText className={`h-4 w-4 shrink-0 transition-colors duration-150
        ${isActive ? "text-blue-500" : "text-gray-400 group-hover/page:text-gray-500"}`}
      />
      <span className="truncate">
        {page.title === "Untitled" ? (
          <span className={isActive ? "text-blue-400 italic" : "text-gray-400 italic"}>Untitled</span>
        ) : page.title}
      </span>
    </button>
  );
}

/* ─── Notebook section in tree ─── */

function NotebookTreeSection({
  notebook,
  notebookPages,
  activePageId,
  expanded,
  onToggle,
  onPageSelect,
  onCreatePage,
}: {
  notebook: Notebook;
  notebookPages: Page[];
  activePageId?: string;
  expanded: boolean;
  onToggle: () => void;
  onPageSelect: (pageId: string) => void;
  onCreatePage: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  const hasActiveChild = notebookPages.some((p) => p.id === activePageId);

  return (
    <div>
      <div
        className="flex items-center relative"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <button
          onClick={onToggle}
          className={`flex flex-1 items-center gap-2 px-2.5 py-[6px] min-w-0
                     cursor-pointer rounded-md transition-colors duration-150
                     hover:bg-gray-50
                     ${hasActiveChild && !expanded ? "text-blue-600" : "text-gray-700"}`}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform duration-200
              ${expanded ? "rotate-90" : ""}`}
          />
          <FolderOpen className={`h-4 w-4 shrink-0 transition-colors duration-150
            ${hasActiveChild ? "text-blue-500" : "text-gray-400"}`}
          />
          <span className="text-[13px] font-medium truncate">
            {notebook.name}
          </span>
        </button>

        <div className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5
                         bg-white transition-opacity duration-150
          ${hovered || showMenu ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onCreatePage(); }}
            className="h-6 w-6 flex items-center justify-center rounded
                       text-gray-400 hover:text-gray-700 hover:bg-gray-100
                       transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            ref={triggerRef}
            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
            className="h-6 w-6 flex items-center justify-center rounded
                       text-gray-400 hover:text-gray-700 hover:bg-gray-100
                       transition-colors cursor-pointer"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>

        {showMenu && (
          <div
            ref={menuRef}
            className="absolute right-1 top-full mt-1 w-36 bg-white border border-gray-200
                       rounded-md shadow-lg py-1 z-50
                       animate-in fade-in slide-in-from-top-1 duration-100"
          >
            <button
              onClick={() => setShowMenu(false)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px]
                         text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              Rename
            </button>
            <button
              onClick={() => setShowMenu(false)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px]
                         text-red-500 hover:bg-red-50 cursor-pointer transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        )}
      </div>

      <div className={`overflow-hidden transition-all duration-200 ease-out
        ${expanded ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0"}`}
      >
        <div className="ml-[22px] pl-[10px] border-l border-gray-200">
          {notebookPages.map((page) => (
            <PageTreeItem
              key={page.id}
              page={page}
              isActive={page.id === activePageId}
              onSelect={() => onPageSelect(page.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── User profile card ─── */

function UserProfile({
  name,
  email,
  avatarUrl,
}: {
  name?: string;
  email?: string;
  avatarUrl?: string;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const displayName = name || email?.split("@")[0] || "User";
  const initial = displayName.charAt(0).toUpperCase();

  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  return (
    <div className="relative px-3 pb-4" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex w-full items-center gap-3 px-3 py-3 cursor-pointer
                   border border-gray-200 rounded-md
                   hover:bg-gray-50 transition-colors duration-150"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={displayName}
            className="h-9 w-9 rounded-lg object-cover shrink-0"
          />
        ) : (
          <div className="h-9 w-9 rounded-lg bg-blue-100 border-2 border-blue-500
                          flex items-center justify-center shrink-0">
            <span className="text-[13px] font-semibold text-blue-600">{initial}</span>
          </div>
        )}
        <div className="min-w-0 text-left flex-1">
          <p className="text-[13px] font-medium text-gray-900 truncate leading-tight">
            {displayName}
          </p>
          {email && (
            <p className="text-[11px] text-gray-400 truncate leading-tight mt-0.5">{email}</p>
          )}
        </div>
        <ChevronsUpDown className="h-4 w-4 text-gray-400 shrink-0" />
      </button>

      {showMenu && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-gray-200
                        rounded-md shadow-lg py-1 z-50
                        animate-in fade-in slide-in-from-bottom-1 duration-100">
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-[13px]
                       text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors"
          >
            <Settings className="h-4 w-4 text-gray-400" />
            Account settings
          </button>
          <div className="h-px bg-gray-100 mx-2 my-0.5" />
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-[13px]
                       text-red-500 hover:bg-red-50 cursor-pointer transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Main sidebar ─── */

export function Sidebar({
  workspaceId,
  notebooks,
  pages,
  activePageId,
  userName,
  userEmail,
  userAvatarUrl,
  onPageSelect,
  onCreateNotebook,
  onCreatePage,
  onInsertCommand,
  onEditCommand,
  collapsed,
  onToggleCollapse,
  onNavChange,
}: SidebarProps) {
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(
    new Set(notebooks.map((n) => n.id))
  );
  const [showCommands, setShowCommands] = useState(false);
  const [activeNav, setActiveNav] = useState<"pages" | "commands" | "files" | "runs" | "settings">("pages");

  const starredPages = useMemo(() => {
    const all: Page[] = [];
    for (const notebookPages of Object.values(pages)) {
      for (const p of notebookPages) {
        if (p.is_starred) all.push(p);
      }
    }
    return all;
  }, [pages]);

  const toggleNotebook = useCallback((id: string) => {
    setExpandedNotebooks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (collapsed) {
    return (
      <div className="flex h-full w-12 flex-col items-center border-r border-gray-200 bg-white pt-3">
        <button
          onClick={onToggleCollapse}
          className="h-8 w-8 flex items-center justify-center rounded-md
                     text-gray-400 hover:text-gray-700 hover:bg-gray-100
                     transition-colors cursor-pointer"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-[252px] flex-col border-r border-gray-200 bg-white select-none">
      {/* ── Header: Logo + workspace name + bell + collapse ── */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-4 shrink-0">
        {/* Cell Notes logo */}
        <div className="h-8 w-8 flex items-center justify-center shrink-0">
          <svg width="28" height="28" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M256 64 L415 156 L415 340 L256 448 L97 356 L97 156 Z"
              fill="none"
              stroke="#005BFF"
              strokeWidth="34"
              strokeLinejoin="miter"
              strokeLinecap="butt"
            />
          </svg>
        </div>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              className="flex items-center gap-1 cursor-default
                         hover:opacity-80 transition-opacity duration-150 min-w-0"
            >
              <span className="text-[15px] font-semibold text-gray-900 truncate">
                Cell Notes
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Coming soon</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="flex items-center gap-0.5 ml-auto shrink-0">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                className="h-7 w-7 flex items-center justify-center rounded-md
                           text-gray-400 hover:text-gray-600 hover:bg-gray-100
                           transition-colors duration-150 cursor-default"
              >
                <Bell className="h-[16px] w-[16px]" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Coming soon</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <button
            onClick={onToggleCollapse}
            className="h-7 w-7 flex items-center justify-center rounded-md
                       text-gray-400 hover:text-gray-600 hover:bg-gray-100
                       transition-colors duration-150 cursor-pointer"
          >
            <PanelLeftClose className="h-[16px] w-[16px]" />
          </button>
        </div>
      </div>

      {/* ── Primary nav ── */}
      <div className="px-3 pb-1 shrink-0 space-y-0.5">
        <NavItem
          icon={FileText}
          label="Pages"
          active={activeNav === "pages" && !showCommands}
          onClick={() => { setActiveNav("pages"); setShowCommands(false); onNavChange?.("pages"); }}
        />
        <NavItem
          icon={Terminal}
          label="Commands"
          active={showCommands}
          onClick={() => { setShowCommands(true); onNavChange?.("commands"); }}
        />
        <NavItem
          icon={FolderOpen}
          label="Files"
          active={activeNav === "files"}
          onClick={() => { setActiveNav("files"); setShowCommands(false); onNavChange?.("files"); }}
        />
        <NavItem
          icon={Activity}
          label="Runs"
          active={activeNav === "runs"}
          onClick={() => { setActiveNav("runs"); setShowCommands(false); onNavChange?.("runs"); }}
        />
        <NavItem
          icon={Settings}
          label="Settings"
          active={activeNav === "settings"}
          onClick={() => { setActiveNav("settings"); setShowCommands(false); onNavChange?.("settings"); }}
        />
      </div>

      {/* ── Divider ── */}
      <div className="h-px bg-gray-200 mx-4 my-2" />

      {showCommands && workspaceId ? (
        <CommandLibrary
          workspaceId={workspaceId}
          onBack={() => setShowCommands(false)}
          onInsertCommand={(cmd) => {
            onInsertCommand?.(cmd);
            setShowCommands(false);
          }}
          onEditCommand={(cmd) => {
            onEditCommand?.(cmd);
          }}
        />
      ) : (
        <>
          {/* ── Starred pages ── */}
          {starredPages.length > 0 && (
            <>
              <div className="flex items-center justify-between px-4 py-1.5 shrink-0">
                <div className="flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Starred
                  </span>
                </div>
              </div>
              <div className="px-2 pb-1">
                {starredPages.map((page) => (
                  <PageTreeItem
                    key={`starred-${page.id}`}
                    page={page}
                    isActive={page.id === activePageId}
                    onSelect={() => onPageSelect(page.id)}
                  />
                ))}
              </div>
              <div className="h-px bg-gray-200 mx-4 my-2" />
            </>
          )}

          {/* ── Page tree header ── */}
          <div className="flex items-center justify-between px-4 py-1.5 shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Page tree
            </span>
            <button
              onClick={onCreateNotebook}
              className="h-5 w-5 flex items-center justify-center rounded
                         text-gray-400 hover:text-gray-700 hover:bg-gray-100
                         transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* ── Page tree ── */}
          <div className="flex-1 overflow-y-auto px-2">
            {notebooks.map((notebook) => (
              <NotebookTreeSection
                key={notebook.id}
                notebook={notebook}
                notebookPages={pages[notebook.id] ?? []}
                activePageId={activePageId}
                expanded={expandedNotebooks.has(notebook.id)}
                onToggle={() => toggleNotebook(notebook.id)}
                onPageSelect={onPageSelect}
                onCreatePage={() => onCreatePage(notebook.id)}
              />
            ))}

            {notebooks.length === 0 && (
              <div className="px-3 py-8 text-center">
                <p className="text-[13px] text-gray-400 mb-3">No notebooks yet</p>
                <button
                  onClick={onCreateNotebook}
                  className="text-[13px] text-blue-500 hover:text-blue-600
                             transition-colors cursor-pointer"
                >
                  Create your first notebook
                </button>
              </div>
            )}
          </div>

          {/* ── New Page button ── */}
          <div className="px-3 pb-4 pt-2 shrink-0">
            <button
              onClick={() => {
                const firstNotebook = notebooks[0];
                if (firstNotebook) onCreatePage(firstNotebook.id);
              }}
              className="flex w-full items-center justify-center gap-2 py-2 rounded-md
                         border border-blue-200 text-[13px] font-medium text-blue-500
                         hover:bg-blue-50 hover:border-blue-300
                         transition-all duration-150 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              New Page
            </button>
          </div>
        </>
      )}

      {/* ── User profile card ── */}
      <div className="shrink-0">
        <UserProfile
          name={userName}
          email={userEmail}
          avatarUrl={userAvatarUrl}
        />
      </div>
    </div>
  );
}
