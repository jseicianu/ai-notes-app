"use client";

import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./sidebar";
import { NotebookCanvas } from "./notebook-canvas";
import { RuntimePanel } from "./runtime-panel";
import { SettingsPage } from "./settings-page";
import { CommandPalette } from "./command-palette";
import { SchedulesList } from "../schedules/schedules-list";
import type { Block, Command, Notebook, Page } from "@/lib/models/types";

interface AppShellProps {
  workspaceName: string;
  workspaceId?: string;
  notebooks: Notebook[];
  pages: Record<string, Page[]>;
  activePage?: Page;
  activePageBlocks?: Block[];
  userName?: string;
  userEmail?: string;
  userAvatarUrl?: string;
  onPageSelect: (pageId: string) => void;
  onCreateNotebook: () => void;
  onCreatePage: (notebookId: string) => void;
  onInsertCommand?: (command: Command) => void;
  onEditCommand?: (command: Command) => void;
  openRuntimeRef?: React.MutableRefObject<(() => void) | null>;
  activeRunChangeRef?: React.MutableRefObject<((runId: string | null) => void) | null>;
  onQuickCreatePage?: () => void;
  onRunAll?: () => void;
  children?: React.ReactNode;
}

type ActiveNav = "pages" | "commands" | "files" | "runs" | "schedules" | "settings";

export function AppShell({
  workspaceName,
  workspaceId,
  notebooks,
  pages,
  activePage,
  onPageSelect,
  onCreateNotebook,
  onCreatePage,
  onInsertCommand,
  onEditCommand,
  activePageBlocks,
  userName,
  userEmail,
  userAvatarUrl,
  openRuntimeRef,
  activeRunChangeRef,
  onQuickCreatePage,
  onRunAll,
  children,
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [runtimeCollapsed, setRuntimeCollapsed] = useState(true);
  const [runtimeTab, setRuntimeTab] = useState<
    "activity" | "context" | "schema"
  >("activity");
  const [activeNav, setActiveNav] = useState<ActiveNav>("pages");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const showSettings = activeNav === "settings";
  const showSchedules = activeNav === "schedules";

  const openRuntime = useCallback(() => {
    setRuntimeCollapsed(false);
    setRuntimeTab("activity");
  }, []);

  const showPageCanvas = useCallback(() => {
    setActiveNav("pages");
  }, []);

  const handleExportPage = useCallback(async () => {
    if (!activePage) return;

    try {
      const res = await fetch(`/api/pages/${activePage.id}/export?format=markdown`);
      if (!res.ok) return;
      const text = await res.text();
      const blob = new Blob([text], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activePage.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "page"}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Export is a convenience action; keep the palette quiet on transient failures.
    }
  }, [activePage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (openRuntimeRef) openRuntimeRef.current = openRuntime;
  }, [openRuntimeRef, openRuntime]);

  useEffect(() => {
    if (activeRunChangeRef) activeRunChangeRef.current = setActiveRunId;
  }, [activeRunChangeRef]);

  return (
    <div className="flex h-screen overflow-hidden bg-white">
        <Sidebar
          workspaceName={workspaceName}
          workspaceId={workspaceId}
          notebooks={notebooks}
          pages={pages}
          activePageId={activePage?.id}
          userName={userName}
          userEmail={userEmail}
          userAvatarUrl={userAvatarUrl}
          onPageSelect={(pageId) => { showPageCanvas(); onPageSelect(pageId); }}
          onCreateNotebook={onCreateNotebook}
          onCreatePage={onCreatePage}
          onInsertCommand={(command) => {
            showPageCanvas();
            onInsertCommand?.(command);
          }}
          onEditCommand={onEditCommand}
          activeNav={activeNav}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onNavChange={setActiveNav}
          onOpenPalette={() => setPaletteOpen(true)}
        />

        {showSettings && workspaceId ? (
          <SettingsPage
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            userEmail={userEmail}
          />
        ) : showSchedules && workspaceId ? (
          <div className="flex-1 overflow-y-auto bg-white">
            <div className="max-w-2xl mx-auto py-8 px-6">
              <h1 className="text-[20px] font-semibold text-gray-900 mb-1">Schedules</h1>
              <p className="text-[14px] text-gray-500 mb-6">
                Commands that run automatically on a schedule.
              </p>
              <SchedulesList workspaceId={workspaceId} />
            </div>
          </div>
        ) : (
          <>
            <NotebookCanvas blocks={activePageBlocks}>
              {children}
            </NotebookCanvas>

            <RuntimePanel
              collapsed={runtimeCollapsed}
              onToggleCollapse={() => setRuntimeCollapsed(!runtimeCollapsed)}
              activeTab={runtimeTab}
              onTabChange={setRuntimeTab}
              workspaceId={workspaceId}
              pageId={activePage?.id}
              activeRunId={activeRunId}
            />
          </>
        )}

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          workspaceId={workspaceId}
          onPageSelect={(pageId) => {
            showPageCanvas();
            onPageSelect(pageId);
          }}
          onInsertCommand={(command) => {
            showPageCanvas();
            onInsertCommand?.(command);
          }}
          onCreatePage={onQuickCreatePage}
          onCreateNotebook={onCreateNotebook}
          onNavigateSettings={() => setActiveNav("settings")}
          onRunAll={() => {
            showPageCanvas();
            onRunAll?.();
          }}
          onExportPage={handleExportPage}
          onRunSelect={(run) => {
            showPageCanvas();
            if (run.pageId) onPageSelect(run.pageId);
            setActiveRunId(run.id);
            openRuntime();
          }}
        />
    </div>
  );
}
