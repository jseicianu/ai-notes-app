"use client";

import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./sidebar";
import { NotebookCanvas } from "./notebook-canvas";
import { RuntimePanel } from "./runtime-panel";
import { SettingsPage } from "./settings-page";
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
  children?: React.ReactNode;
}

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
  children,
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [runtimeCollapsed, setRuntimeCollapsed] = useState(true);
  const [runtimeTab, setRuntimeTab] = useState<
    "activity" | "context" | "schema"
  >("activity");
  const [activeNav, setActiveNav] = useState<"pages" | "commands" | "files" | "runs" | "settings">("pages");

  const showSettings = activeNav === "settings";

  const openRuntime = useCallback(() => {
    setRuntimeCollapsed(false);
    setRuntimeTab("activity");
  }, []);

  useEffect(() => {
    if (openRuntimeRef) openRuntimeRef.current = openRuntime;
  }, [openRuntimeRef, openRuntime]);

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
          onPageSelect={(pageId) => { setActiveNav("pages"); onPageSelect(pageId); }}
          onCreateNotebook={onCreateNotebook}
          onCreatePage={onCreatePage}
          onInsertCommand={onInsertCommand}
          onEditCommand={onEditCommand}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onNavChange={setActiveNav}
        />

        {showSettings && workspaceId ? (
          <SettingsPage
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            userEmail={userEmail}
          />
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
            />
          </>
        )}
    </div>
  );
}
