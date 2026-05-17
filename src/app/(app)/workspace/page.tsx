"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { BlockList } from "@/components/blocks/block-list";
import { PageHeader } from "@/components/blocks/page-header";
import { MakeReusableDrawer } from "@/components/blocks/make-reusable-drawer";
import { ScheduleModal } from "@/components/schedules/schedule-modal";
import type { Command, Notebook, Page, Block } from "@/lib/models/types";
import type { SourceReference } from "@/services/source-service";

export default function WorkspacePage() {
  const [workspaceName, setWorkspaceName] = useState("My Workspace");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | undefined>();
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | undefined>();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [pages, setPages] = useState<Record<string, Page[]>>({});
  const [activePage, setActivePage] = useState<Page | undefined>();
  const [activePageBlocks, setActivePageBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const didLoad = useRef(false);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;

    async function loadWorkspace() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      setUserEmail(user.email);

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", user.id)
        .single();

      if (profile) {
        setUserName(profile.display_name || undefined);
        setUserAvatarUrl(profile.avatar_url || undefined);
      }

      let { data: workspace } = await supabase
        .from("workspaces")
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!workspace) {
        const { data: newWorkspace } = await supabase
          .from("workspaces")
          .insert({ owner_id: user.id, name: "My Workspace" })
          .select()
          .single();
        workspace = newWorkspace;
      }

      if (!workspace) return;

      setWorkspaceId(workspace.id);
      setWorkspaceName(workspace.name);

      const { data: notebooksData } = await supabase
        .from("notebooks")
        .select("*")
        .eq("workspace_id", workspace.id)
        .eq("is_archived", false)
        .order("sort_order");

      setNotebooks(notebooksData ?? []);

      if (notebooksData && notebooksData.length > 0) {
        const { data: pagesData } = await supabase
          .from("pages")
          .select("*")
          .eq("workspace_id", workspace.id)
          .eq("is_archived", false)
          .order("sort_order");

        const pagesByNotebook: Record<string, Page[]> = {};
        for (const page of pagesData ?? []) {
          if (!pagesByNotebook[page.notebook_id]) {
            pagesByNotebook[page.notebook_id] = [];
          }
          pagesByNotebook[page.notebook_id].push(page);
        }
        setPages(pagesByNotebook);

        if (pagesData && pagesData.length > 0) {
          const lastPageId = localStorage.getItem("cellnotes_active_page");
          const restored = lastPageId ? pagesData.find((p) => p.id === lastPageId) : null;
          setActivePage(restored || pagesData[0]);
        }
      }

      setLoading(false);
    }

    loadWorkspace();
  }, [supabase]);

  // Load blocks when active page changes
  useEffect(() => {
    if (!activePage) {
      return;
    }

    async function loadBlocks() {
      const { data } = await supabase
        .from("blocks")
        .select("*")
        .eq("page_id", activePage!.id)
        .order("sort_order");

      setActivePageBlocks((data as Block[]) ?? []);
    }

    loadBlocks();
  }, [activePage, supabase]);

  const handleCreateNotebook = async () => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from("notebooks")
      .insert({
        workspace_id: workspaceId,
        name: "New Notebook",
        sort_order: notebooks.length,
      })
      .select()
      .single();
    if (data) {
      setNotebooks((prev) => [...prev, data]);
    }
  };

  const handleCreatePage = async (notebookId: string) => {
    if (!workspaceId) return;
    const notebookPages = pages[notebookId] ?? [];
    const { data } = await supabase
      .from("pages")
      .insert({
        notebook_id: notebookId,
        workspace_id: workspaceId,
        title: "Untitled",
        sort_order: notebookPages.length,
      })
      .select()
      .single();
    if (data) {
      setPages((prev) => ({
        ...prev,
        [notebookId]: [...(prev[notebookId] ?? []), data],
      }));
      setActivePage(data);
    }
  };

  const handlePageSelect = (pageId: string) => {
    for (const notebookPages of Object.values(pages)) {
      const page = notebookPages.find((p) => p.id === pageId);
      if (page) {
        setActivePage(page);
        setRunAllTrigger(0);
        setRunAllState(null);
        localStorage.setItem("cellnotes_active_page", pageId);
        return;
      }
    }
  };

  const handlePageTitleChange = async (title: string) => {
    if (!activePage) return;
    setActivePage({ ...activePage, title });

    setPages((prev) => ({
      ...prev,
      [activePage.notebook_id]: (prev[activePage.notebook_id] ?? []).map((p) =>
        p.id === activePage.id ? { ...p, title } : p
      ),
    }));

    await supabase
      .from("pages")
      .update({ title })
      .eq("id", activePage.id);
  };

  const handlePageStarToggle = async (isStarred: boolean) => {
    if (!activePage) return;

    const pageBeforeUpdate = activePage;

    setActivePage({ ...activePage, is_starred: isStarred });
    setPages((prev) => ({
      ...prev,
      [activePage.notebook_id]: (prev[activePage.notebook_id] ?? []).map((p) =>
        p.id === activePage.id ? { ...p, is_starred: isStarred } : p
      ),
    }));

    const { error } = await supabase
      .from("pages")
      .update({ is_starred: isStarred })
      .eq("id", activePage.id);

    if (!error) return;

    console.error("Failed to update page star", error);
    setActivePage((current) =>
      current?.id === pageBeforeUpdate.id ? pageBeforeUpdate : current
    );
    setPages((prev) => ({
      ...prev,
      [pageBeforeUpdate.notebook_id]: (prev[pageBeforeUpdate.notebook_id] ?? []).map((p) =>
        p.id === pageBeforeUpdate.id ? pageBeforeUpdate : p
      ),
    }));
  };

  const [blockRefreshTrigger, setBlockRefreshTrigger] = useState(0);
  const [sourceRefreshTrigger, setSourceRefreshTrigger] = useState(0);

  const [scrollToBlockId, setScrollToBlockId] = useState<string | null>(null);

  const handleInsertCommand = async (command: Command) => {
    if (!activePage || !workspaceId) return;

    const { data, error } = await supabase
      .from("blocks")
      .insert({
        page_id: activePage.id,
        workspace_id: workspaceId,
        type: "command_ref",
        content: {
          command_id: command.id,
          command_name: command.name,
          command_slug: command.slug,
          inputs: {},
        },
        sort_order: activePageBlocks.length,
      })
      .select("id")
      .single();

    if (!error && data) {
      setScrollToBlockId(data.id);
      setBlockRefreshTrigger((n) => n + 1);
    }
  };

  const handleDuplicatePage = async () => {
    if (!activePage || !workspaceId) return;
    const notebookPages = pages[activePage.notebook_id] ?? [];
    const { data: newPage } = await supabase
      .from("pages")
      .insert({
        notebook_id: activePage.notebook_id,
        workspace_id: workspaceId,
        title: `${activePage.title} (copy)`,
        sort_order: notebookPages.length,
        tags: activePage.tags,
      })
      .select()
      .single();

    if (newPage) {
      // Copy blocks from original page
      const { data: sourceBlocks } = await supabase
        .from("blocks")
        .select("*")
        .eq("page_id", activePage.id)
        .order("sort_order");

      if (sourceBlocks && sourceBlocks.length > 0) {
        const newBlocks = sourceBlocks.map((b: Block) => ({
          page_id: newPage.id,
          workspace_id: workspaceId,
          type: b.type,
          content: b.content,
          sort_order: b.sort_order,
        }));
        await supabase.from("blocks").insert(newBlocks);
      }

      setPages((prev) => ({
        ...prev,
        [activePage.notebook_id]: [...(prev[activePage.notebook_id] ?? []), newPage],
      }));
      setActivePage(newPage);
    }
  };

  const handleArchivePage = async () => {
    if (!activePage) return;
    await supabase
      .from("pages")
      .update({ is_archived: true })
      .eq("id", activePage.id);

    setPages((prev) => ({
      ...prev,
      [activePage.notebook_id]: (prev[activePage.notebook_id] ?? []).filter(
        (p) => p.id !== activePage.id
      ),
    }));

    // Select another page
    const remainingPages = Object.values(pages).flat().filter((p) => p.id !== activePage.id);
    setActivePage(remainingPages[0] || undefined);
  };

  const handleDeletePage = async () => {
    if (!activePage) return;
    await supabase
      .from("pages")
      .delete()
      .eq("id", activePage.id);

    setPages((prev) => ({
      ...prev,
      [activePage.notebook_id]: (prev[activePage.notebook_id] ?? []).filter(
        (p) => p.id !== activePage.id
      ),
    }));

    const remainingPages = Object.values(pages).flat().filter((p) => p.id !== activePage.id);
    setActivePage(remainingPages[0] || undefined);
  };

  const [editingCommand, setEditingCommand] = useState<Command | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{
    commandId: string;
    commandName: string;
    commandSlug: string;
    commandDescription: string | null;
    inputValues?: Record<string, unknown>;
    sourceRefs?: SourceReference[];
  } | null>(null);
  const [addBlockTrigger, setAddBlockTrigger] = useState(0);
  const [runAllTrigger, setRunAllTrigger] = useState(0);
  const [runAllState, setRunAllState] = useState<import("@/components/blocks/block-list").RunAllState | null>(null);
  const openRuntimeRef = useRef<(() => void) | null>(null);
  const activeRunChangeRef = useRef<((runId: string | null) => void) | null>(null);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas-bg">
        <p className="text-sm text-gray-400">Loading workspace...</p>
      </div>
    );
  }

  return (
    <>
    <AppShell
      workspaceName={workspaceName}
      workspaceId={workspaceId ?? undefined}
      notebooks={notebooks}
      pages={pages}
      activePage={activePage}
      onPageSelect={handlePageSelect}
      onCreateNotebook={handleCreateNotebook}
      onCreatePage={handleCreatePage}
      onInsertCommand={handleInsertCommand}
      onEditCommand={setEditingCommand}
      activePageBlocks={activePageBlocks}
      userName={userName}
      userEmail={userEmail}
      userAvatarUrl={userAvatarUrl}
      openRuntimeRef={openRuntimeRef}
      activeRunChangeRef={activeRunChangeRef}
      onQuickCreatePage={() => {
        const firstNotebook = notebooks[0];
        if (firstNotebook) handleCreatePage(firstNotebook.id);
      }}
      onRunAll={() => setRunAllTrigger((n) => n + 1)}
    >
      {activePage && workspaceId && (
        <>
          <PageHeader
            page={activePage}
            notebooks={notebooks}
            pages={pages}
            onTitleChange={handlePageTitleChange}
            onPageSelect={handlePageSelect}
            onCreatePage={handleCreatePage}
            onCreateNotebook={handleCreateNotebook}
            onAddBlock={() => setAddBlockTrigger((n) => n + 1)}
            onRunAll={() => setRunAllTrigger((n) => n + 1)}
            runAllState={runAllState}
            onStarToggle={handlePageStarToggle}
            onDuplicatePage={handleDuplicatePage}
            onArchivePage={handleArchivePage}
            onDeletePage={handleDeletePage}
            sourceRefreshTrigger={sourceRefreshTrigger}
          />
          <BlockList
            key={activePage.id}
            pageId={activePage.id}
            workspaceId={workspaceId}
            initialBlocks={activePageBlocks}
            onBlocksChange={(blocks) => {
              setActivePageBlocks((prev) => {
                if (blocks.length !== prev.length) {
                  setSourceRefreshTrigger((n) => n + 1);
                }
                return blocks;
              });
            }}
            refreshTrigger={blockRefreshTrigger}
            addBlockTrigger={addBlockTrigger}
            runAllTrigger={runAllTrigger}
            scrollToBlockId={scrollToBlockId}
            onScrollToBlockDone={() => setScrollToBlockId(null)}
            onViewRun={() => openRuntimeRef.current?.()}
            onActiveRunChange={(runId) => activeRunChangeRef.current?.(runId)}
            onEditCommand={setEditingCommand}
            onScheduleCommand={(cmdId, cmdName, cmdSlug, cmdDesc, runConfig) =>
              setScheduleTarget({
                commandId: cmdId,
                commandName: cmdName,
                commandSlug: cmdSlug,
                commandDescription: cmdDesc,
                inputValues: runConfig?.inputValues,
                sourceRefs: runConfig?.sourceRefs,
              })
            }
            onRunAllStateChange={setRunAllState}
          />
        </>
      )}
    </AppShell>
    {editingCommand && workspaceId && (
      <MakeReusableDrawer
        isOpen={!!editingCommand}
        onClose={() => setEditingCommand(null)}
        prompt={editingCommand.prompt_template}
        block={{ workspace_id: workspaceId, page_id: activePage?.id || "", id: "" } as Block}
        editCommand={editingCommand}
      />
    )}
    {workspaceId && (
      <ScheduleModal
        open={!!scheduleTarget}
        onClose={() => setScheduleTarget(null)}
        workspaceId={workspaceId}
        commandId={scheduleTarget?.commandId}
        commandName={scheduleTarget?.commandName}
        commandSlug={scheduleTarget?.commandSlug}
        commandDescription={scheduleTarget?.commandDescription}
        inputValues={scheduleTarget?.inputValues}
        sourceRefs={scheduleTarget?.sourceRefs}
        pages={Object.values(pages).flat()}
        notebooks={notebooks}
        currentPageId={activePage?.id}
        onCreated={() => setScheduleTarget(null)}
      />
    )}
    </>
  );
}
