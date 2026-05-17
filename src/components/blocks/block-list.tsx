"use client";

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { createClient } from "@/lib/supabase/client";
import { BlockWrapper } from "./block-wrapper";
import { BlockTypePicker } from "./block-type-picker";
import { TextBlock } from "./text-block";
import { AiCellBlock } from "./ai-cell-block";
import { TodoBlock } from "./todo-block";
import { CalloutBlock } from "./callout-block";
import { SeparatorBlock } from "./separator-block";
import { InputBlock } from "./input-block";
import { ListBlock } from "./list-block";
import { ControlPanelBlock } from "./control-panel-block";
import { TableBlock } from "./table-block";
import { JsonBlock } from "./json-block";
import { OutputBlock } from "./output-block";
import { ErrorBlock } from "./error-block";
import { FileBlock } from "./file-block";
import { CommandRefBlock } from "./command-ref-block";
import { SourceCardBlock } from "./source-card-block";
import { CodeBlock } from "./code-block";
import { ImageBlock } from "./image-block";
import { RefineFooter } from "./refine-footer";
import { getChildBlocksOwnedByParents, getDisplayBlocks } from "./block-display-order";
import type { Block, BlockType, Command } from "@/lib/models/types";
import type { SourceReference } from "@/services/source-service";

export type CellRunStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export interface RunAllState {
  active: boolean;
  cells: Array<{ blockId: string; label: string; status: CellRunStatus; error?: string; durationMs?: number }>;
  currentIndex: number;
  startedAt: number;
}

function resolveType(type: string): { blockType: BlockType; content: Record<string, unknown> } {
  if (type === "heading_1" || type === "heading_2" || type === "heading_3") {
    return {
      blockType: "heading",
      content: { text: "", level: parseInt(type.split("_")[1]) },
    };
  }

  // Control panel must be checked before the input_ prefix
  if (type === "input_group") {
    return {
      blockType: "input_group" as BlockType,
      content: {
        title: "Workflow Controls",
        inputs: [
          { variable_name: "option_1", input_type: "select", value: "Option 1", config: { options: ["Option 1", "Option 2", "Option 3"] } },
          { variable_name: "toggle_1", input_type: "checkbox", value: false, config: { label: "Enabled" } },
          { variable_name: "amount", input_type: "number", value: 50, config: { min: 0, max: 100 } },
        ],
      },
    };
  }

  // Input block subtypes
  if (type.startsWith("input_")) {
    const inputType = type.replace("input_", "");
    const baseContent: Record<string, unknown> = {
      variable_name: `input_${Date.now().toString(36).slice(-4)}`,
      input_type: inputType,
      value: inputType === "checkbox" ? false : inputType === "number" || inputType === "slider" ? 0 : "",
      config: {},
    };
    if (inputType === "slider") baseContent.config = { min: 0, max: 100, step: 1 };
    if (inputType === "number") baseContent.config = { min: 0, max: 100 };
    if (inputType === "select") baseContent.config = { options: ["Option 1", "Option 2"] };
    if (inputType === "checkbox") baseContent.config = { label: "Checked" };
    if (inputType === "date") baseContent.value = new Date().toISOString().split("T")[0];
    return { blockType: "input", content: baseContent };
  }

  const blockType = type as BlockType;
  let content: Record<string, unknown> = {};

  if (type === "ai_cell") content = { prompt: "" };
  if (type === "todo") content = { items: [{ text: "", done: false }] };
  if (type === "table") content = { columns: ["Column 1", "Column 2"], rows: [{ "Column 1": "", "Column 2": "" }] };
  if (type === "json") content = { data: {} };
  if (type === "output") content = { format: "text", data: "This is sample output from an AI cell run.\nIt can contain multiple lines of text." };
  if (type === "error") content = { message: "Model API request failed", code: "API_ERROR", details: "Connection timed out after 30000ms" };
  if (type === "file") content = {};
  if (type === "command_ref") content = {};
  if (type === "source_card") content = { url: "", title: "", summary: "", scraped_at: new Date().toISOString() };
  if (type === "separator") content = {};
  if (type === "code") content = { code: "", language: "javascript" };
  if (type === "image") content = {};
  if (type === "callout") content = { type: "info", doc: "" };
  if (type === "bulleted_list") content = { items: [{ id: `li_${Date.now().toString(36)}`, text: "" }], doc: "<ul><li></li></ul>" };
  if (type === "numbered_list") content = { items: [{ id: `li_${Date.now().toString(36)}`, text: "" }], doc: "<ol><li></li></ol>" };

  return { blockType, content };
}

function getTypeLabel(block: Block): string {
  switch (block.type) {
    case "heading": return `H${(block.content?.level as number) || 1}`;
    case "ai_cell": return "AI Cell";
    case "output": return "AI Output";
    case "todo": return "To-do";
    case "text": return "Text";
    case "bulleted_list": return "List";
    case "numbered_list": return "Num List";
    case "callout": return "Callout";
    case "separator": return "Separator";
    case "input": {
      const t = block.content?.input_type as string;
      if (t === "select") return "Dropdown";
      if (t === "checkbox") return "Checkbox";
      if (t === "slider") return "Slider";
      if (t === "number") return "Number";
      if (t === "date") return "Date";
      return "Text Input";
    }
    case "input_group": return "Controls";
    case "table": return "Table";
    case "json": return "JSON";
    case "error": return "Error";
    case "file": return "File";
    case "command_ref": return "Command";
    case "source_card": return "Source";
    case "code": return "Code Block";
    case "image": return "Image";
    default: return block.type;
  }
}



interface BlockListProps {
  pageId: string;
  workspaceId: string;
  initialBlocks: Block[];
  onBlocksChange?: (blocks: Block[]) => void;
  refreshTrigger?: number;
  addBlockTrigger?: number;
  runAllTrigger?: number;
  scrollToBlockId?: string | null;
  onScrollToBlockDone?: () => void;
  onViewRun?: () => void;
  onEditCommand?: (command: Command) => void;
  onScheduleCommand?: (
    commandId: string,
    commandName: string,
    commandSlug: string,
    commandDescription: string | null,
    runConfig?: { inputValues?: Record<string, unknown>; sourceRefs?: SourceReference[] }
  ) => void;
  onActiveRunChange?: (runId: string | null) => void;
  onRunAllStateChange?: (state: RunAllState | null) => void;
}

export function BlockList({
  pageId,
  workspaceId,
  initialBlocks,
  onBlocksChange,
  refreshTrigger,
  addBlockTrigger,
  runAllTrigger,
  scrollToBlockId,
  onScrollToBlockDone,
  onViewRun,
  onEditCommand,
  onScheduleCommand,
  onActiveRunChange,
  onRunAllStateChange,
}: BlockListProps) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [highlightBlockId, setHighlightBlockId] = useState<string | null>(null);

  useEffect(() => {
    onBlocksChange?.(blocks);
  }, [blocks, onBlocksChange]);

  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [runningBlockId, setRunningBlockId] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const refreshBlocks = useCallback(async () => {
    const { data } = await supabase
      .from("blocks")
      .select("*")
      .eq("page_id", pageId)
      .order("sort_order");
    if (data) setBlocks(data as Block[]);
  }, [supabase, pageId]);

  // Load blocks from DB on mount — initialBlocks may be stale due to async parent load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshBlocks();
  }, [refreshBlocks]);

  // Re-fetch blocks when external code signals an insert
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      refreshBlocks();
    }
  }, [refreshTrigger, refreshBlocks]);

  // Scroll to and highlight a newly inserted block
  useEffect(() => {
    if (!scrollToBlockId) return;
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-block-id="${scrollToBlockId}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightBlockId(scrollToBlockId);
        setTimeout(() => setHighlightBlockId(null), 1500);
      }
      onScrollToBlockDone?.();
    }, 150);
    return () => clearTimeout(timer);
  }, [scrollToBlockId, onScrollToBlockDone, blocks]);

  // "Add block" triggered from page header — open picker at end of list
  const [showHeaderPicker, setShowHeaderPicker] = useState(false);
  const [headerPickerTop, setHeaderPickerTop] = useState(200);
  const headerPickerAnchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (addBlockTrigger && addBlockTrigger > 0) {
      setHeaderPickerTop(
        headerPickerAnchor.current
          ? headerPickerAnchor.current.getBoundingClientRect().top - 20
          : 200
      );
      setShowHeaderPicker(true);
    }
  }, [addBlockTrigger]);

  // "Run all" — proper state machine
  const runAllRef = useRef(false);
  const runAllAbortRef = useRef(false);
  const runAllSkipRef = useRef(false);
  const runAllRetryRef = useRef(false);
  const [runAllState, setRunAllState] = useState<RunAllState | null>(null);
  const blocksRef = useRef(blocks);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    onRunAllStateChange?.(runAllState);
  }, [runAllState, onRunAllStateChange]);

  const stopRunAll = useCallback(() => { runAllAbortRef.current = true; }, []);
  const skipCurrentCell = useCallback(() => { runAllSkipRef.current = true; }, []);
  const retryFailedCell = useCallback(() => { runAllRetryRef.current = true; }, []);

  useEffect(() => {
    if (!runAllTrigger || runAllTrigger === 0) return;
    if (runAllRef.current) return;
    runAllRef.current = true;
    runAllAbortRef.current = false;

    async function runAllCells() {
      const aiCells = blocksRef.current.filter((b) => b.type === "ai_cell");
      if (aiCells.length === 0) { runAllRef.current = false; return; }

      const cellEntries = aiCells.map((cell) => ({
        blockId: cell.id,
        label: (cell.content?.label as string) || (cell.content?.prompt as string)?.slice(0, 40) || "AI Cell",
        status: "queued" as CellRunStatus,
      }));

      const state: RunAllState = { active: true, cells: cellEntries, currentIndex: 0, startedAt: Date.now() };
      setRunAllState({ ...state });

      for (let i = 0; i < aiCells.length; i++) {
        if (runAllAbortRef.current) {
          state.cells = state.cells.map((c, j) => j >= i ? { ...c, status: "skipped" } : c);
          state.active = false;
          setRunAllState({ ...state });
          break;
        }

        state.currentIndex = i;
        state.cells[i] = { ...state.cells[i], status: "running" };
        setRunAllState({ ...state });

        const cellStart = Date.now();
        const cell = aiCells[i];
        if (!String(cell.content?.prompt ?? "").trim()) {
          const durationMs = Date.now() - cellStart;
          state.cells[i] = {
            ...state.cells[i],
            status: "failed",
            error: "Prompt is empty",
            durationMs,
          };
          state.active = true;
          setRunAllState({ ...state });

          await new Promise<void>((resolve) => {
            const waitForAction = () => {
              if (runAllAbortRef.current || runAllSkipRef.current || runAllRetryRef.current) { resolve(); return; }
              setTimeout(waitForAction, 200);
            };
            waitForAction();
          });

          if (runAllRetryRef.current) {
            runAllRetryRef.current = false;
            i--;
            continue;
          }
          if (runAllSkipRef.current) {
            runAllSkipRef.current = false;
            state.cells[i] = { ...state.cells[i], status: "skipped" };
            setRunAllState({ ...state });
            continue;
          }
          if (runAllAbortRef.current) {
            state.cells = state.cells.map((c, j) => j > i ? { ...c, status: "skipped" } : c);
            state.active = false;
            setRunAllState({ ...state });
            break;
          }
        }

        const el = document.querySelector(`[data-block-id="${cell.id}"] button[data-run-button]`) as HTMLButtonElement | null;
        if (el) {
          el.click();
          await new Promise<void>((resolve) => {
            const check = () => {
              if (runAllAbortRef.current || runAllSkipRef.current) { resolve(); return; }
              const still = document.querySelector(`[data-block-id="${cell.id}"] [data-running="true"]`);
              if (!still) { resolve(); return; }
              setTimeout(check, 500);
            };
            setTimeout(check, 1000);
          });
        }

        const durationMs = Date.now() - cellStart;
        const errorEl = document.querySelector(`[data-block-id="${cell.id}"] [data-run-error]`) as HTMLElement | null;
        const failed = !!errorEl;

        if (runAllSkipRef.current) {
          runAllSkipRef.current = false;
          state.cells[i] = { ...state.cells[i], status: "skipped", durationMs };
          setRunAllState({ ...state });
          continue;
        }

        if (failed) {
          const errorMsg = errorEl?.getAttribute("data-run-error") || "Cell failed";
          state.cells[i] = { ...state.cells[i], status: "failed", error: errorMsg, durationMs };
          state.active = true;
          setRunAllState({ ...state });

          // Wait for user action: retry, skip, or stop
          await new Promise<void>((resolve) => {
            const waitForAction = () => {
              if (runAllAbortRef.current || runAllSkipRef.current || runAllRetryRef.current) { resolve(); return; }
              setTimeout(waitForAction, 200);
            };
            waitForAction();
          });

          if (runAllRetryRef.current) {
            runAllRetryRef.current = false;
            i--; // retry same cell
            continue;
          }
          if (runAllSkipRef.current) {
            runAllSkipRef.current = false;
            state.cells[i] = { ...state.cells[i], status: "skipped" };
            setRunAllState({ ...state });
            continue;
          }
          if (runAllAbortRef.current) {
            state.cells = state.cells.map((c, j) => j > i ? { ...c, status: "skipped" } : c);
            state.active = false;
            setRunAllState({ ...state });
            break;
          }
        } else {
          state.cells[i] = { ...state.cells[i], status: "completed", durationMs };
          setRunAllState({ ...state });
        }
      }

      state.active = false;
      setRunAllState({ ...state });
      runAllRef.current = false;
      refreshBlocks();
    }
    runAllCells();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runAllTrigger]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const displayBlocks = useMemo(() => getDisplayBlocks(blocks), [blocks]);

  const childOutputBlockIds = useMemo(
    () => getChildBlocksOwnedByParents(blocks),
    [blocks]
  );

  const createBlock = useCallback(
    async (type: string, afterIndex: number) => {
      const { blockType, content } = resolveType(type);
      const insertIndex = afterIndex + 1;

      const { data, error } = await supabase
        .from("blocks")
        .insert({
          page_id: pageId,
          workspace_id: workspaceId,
          type: blockType,
          content,
          sort_order: insertIndex,
        })
        .select()
        .single();

      if (error || !data) return;

      setBlocks((prev) => {
        const newBlocks = [...prev];
        newBlocks.splice(insertIndex, 0, data as Block);
        return newBlocks;
      });
      setAutoFocusId(data.id);
    },
    [supabase, pageId, workspaceId]
  );

  const changeBlockType = useCallback(
    async (blockId: string, newType: string) => {
      const { blockType, content } = resolveType(newType);

      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId ? { ...b, type: blockType, content } : b
        )
      );

      await supabase
        .from("blocks")
        .update({ type: blockType, content, updated_at: new Date().toISOString() })
        .eq("id", blockId);
    },
    [supabase]
  );

  const updateBlock = useCallback(
    async (blockId: string, content: Record<string, unknown>) => {
      setBlocks((prev) =>
        prev.map((b) => (b.id === blockId ? { ...b, content } : b))
      );

      await supabase
        .from("blocks")
        .update({ content, updated_at: new Date().toISOString() })
        .eq("id", blockId);

      const skipTypes = new Set(["separator", "input", "input_group", "error"]);
      const block = blocks.find((b) => b.id === blockId);
      if (block && !skipTypes.has(block.type)) {
        fetch("/api/indexing/embed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceType: "block", sourceId: blockId, workspaceId }),
        }).catch(() => {});
      }
    },
    [supabase, blocks, workspaceId]
  );

  const updateBlockLabel = useCallback(
    async (blockId: string, label: string) => {
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId
            ? { ...b, content: { ...b.content, label: label || undefined } }
            : b
        )
      );

      const { data } = await supabase
        .from("blocks")
        .select("content")
        .eq("id", blockId)
        .single();
      if (!data) return;

      const freshContent = { ...(data.content as Record<string, unknown>) };
      if (label) {
        freshContent.label = label;
      } else {
        delete freshContent.label;
      }

      await supabase
        .from("blocks")
        .update({ content: freshContent, updated_at: new Date().toISOString() })
        .eq("id", blockId);
    },
    [supabase]
  );

  const deleteBlock = useCallback(
    async (blockId: string) => {
      setBlocks((prev) => prev.filter((b) => b.id !== blockId));
      await supabase.from("blocks").delete().eq("id", blockId);
    },
    [supabase]
  );

  const duplicateBlock = useCallback(
    async (blockId: string) => {
      const block = blocks.find((b) => b.id === blockId);
      if (!block) return;

      const index = blocks.indexOf(block);
      const { data } = await supabase
        .from("blocks")
        .insert({
          page_id: pageId,
          workspace_id: workspaceId,
          type: block.type,
          content: block.content,
          sort_order: index + 1,
        })
        .select()
        .single();

      if (data) {
        setBlocks((prev) => {
          const newBlocks = [...prev];
          newBlocks.splice(index + 1, 0, data as Block);
          return newBlocks;
        });
      }
    },
    [supabase, blocks, pageId, workspaceId]
  );

  const [overId, setOverId] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverId((event.over?.id as string) ?? null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveId(null);
      setOverId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = displayBlocks.findIndex((b) => b.id === active.id);
      const newIndex = displayBlocks.findIndex((b) => b.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      const newBlocks = arrayMove(displayBlocks, oldIndex, newIndex);
      setBlocks(newBlocks);

      const updates = newBlocks.map((b, i) => ({ id: b.id, sort_order: i }));
      await Promise.all(
        updates.map(({ id, sort_order }) =>
          supabase.from("blocks").update({ sort_order }).eq("id", id)
        )
      );
    },
    [displayBlocks, supabase]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverId(null);
  }, []);

  const handleClickBelow = useCallback(() => {
    if (blocks.length === 0) {
      createBlock("text", -1);
      return;
    }
    const lastBlock = blocks[blocks.length - 1];
    const hasContent =
      lastBlock.type !== "text" && lastBlock.type !== "heading"
        ? true
        : Boolean(
            (lastBlock.content?.doc as string)?.replace(/<[^>]*>/g, "").trim() ||
            (lastBlock.content?.text as string)?.trim()
          );
    if (hasContent) {
      createBlock("text", blocks.length - 1);
    }
  }, [createBlock, blocks]);

  const activeBlock = activeId ? blocks.find((b) => b.id === activeId) : null;

  const renderBlock = (block: Block) => {
    const isAutoFocus = autoFocusId === block.id;

    switch (block.type) {
      case "text":
      case "heading":
        return (
          <TextBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
            onEnter={() => {
              const index = blocks.findIndex((b) => b.id === block.id);
              createBlock("text", index);
            }}
            onBackspace={() => {
              if (blocks.length > 1) deleteBlock(block.id);
            }}
            autoFocus={isAutoFocus}
          />
        );

      case "ai_cell":
        return (
          <AiCellBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
            pageBlocks={blocks}
            onRunComplete={refreshBlocks}
            onRunningChange={(running) => setRunningBlockId(running ? block.id : null)}
            onViewRun={onViewRun}
            onActiveRunChange={onActiveRunChange}
            onSchedule={onScheduleCommand && (block.content?.command_id as string | undefined) ? () => {
              const content = block.content as Record<string, unknown>;
              const cmdId = content?.command_id as string | undefined;
              const cmdName = content?.command_name as string || "AI Cell";
              if (cmdId) {
                onScheduleCommand(cmdId, cmdName, content?.command_slug as string || "", null);
              }
            } : undefined}
          />
        );

      case "todo":
        return (
          <TodoBlock
            key={`${block.version}:${block.updated_at}`}
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
          />
        );

      case "bulleted_list":
      case "numbered_list":
        return (
          <ListBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
          />
        );

      case "callout":
        return (
          <CalloutBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
          />
        );

      case "separator":
        return <SeparatorBlock />;

      case "input":
        return (
          <InputBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
          />
        );

      case "input_group":
        return (
          <ControlPanelBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
            pageBlocks={blocks}
            onSourceCardsReady={refreshBlocks}
          />
        );

      case "table":
        return (
          <TableBlock
            key={`${block.version}:${block.updated_at}`}
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
          />
        );

      case "json":
        return (
          <JsonBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
          />
        );

      case "output":
        return (
          <OutputBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
          />
        );

      case "error":
        return (
          <ErrorBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
          />
        );

      case "file":
        return (
          <FileBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
          />
        );

      case "source_card":
        return (
          <SourceCardBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
          />
        );

      case "command_ref":
        return (
          <CommandRefBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
            onRunComplete={refreshBlocks}
            onRunningChange={(running) => setRunningBlockId(running ? block.id : null)}
            onSchedule={onScheduleCommand ? (config) => {
              const content = block.content as Record<string, unknown>;
              onScheduleCommand(
                content?.command_id as string || "",
                content?.command_name as string || "",
                content?.command_slug as string || "",
                null,
                config
              );
            } : undefined}
            pageBlocks={blocks}
          />
        );

      case "code":
        return (
          <CodeBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
          />
        );

      case "image":
        return (
          <ImageBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
          />
        );

      default:
        return (
          <div className="px-4 py-3 text-sm text-gray-400 italic">
            {block.type} block (coming soon)
          </div>
        );
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <style>{`
        @keyframes block-pulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <SortableContext
        items={displayBlocks.map((b) => b.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-4">
          {(() => {
            const renderWrappedBlock = (block: Block, displayIndex: number) => {
              const isChild = childOutputBlockIds.has(block.id);
              const isDragging = activeId === block.id;
              const isDropTarget = overId === block.id && activeId !== block.id;
              const activeIndex = activeId ? displayBlocks.findIndex((b) => b.id === activeId) : -1;
              const showDropAbove = isDropTarget && activeIndex > displayIndex;
              const showDropBelow = isDropTarget && activeIndex < displayIndex;
              const visibleIndex = displayIndex + 1;
              const sourceIndex = blocks.findIndex((b) => b.id === block.id);

              return (
                <React.Fragment key={block.id}>
                  {displayIndex > 0 && !activeId && !isChild && (
                    <AddLine onAdd={(type) => createBlock(type, sourceIndex - 1)} />
                  )}

                  <div data-block-id={block.id} className={`relative ${isChild ? "-mt-3" : ""}`}>
                    {showDropAbove && (
                      <div className="absolute -top-1 left-0 right-0 h-0.5 bg-blue-500 z-10" />
                    )}

                    {/* Run All status icon — left side overlay */}
                    {(() => {
                      const cellState = runAllState?.active || runAllState?.cells.some(c => c.status !== "queued")
                        ? runAllState?.cells.find(c => c.blockId === block.id)
                        : null;
                      if (!cellState) return null;
                      return (
                        <div className="absolute -left-8 top-3 z-10">
                          {cellState.status === "completed" && (
                            <div className="h-6 w-6 rounded-full bg-green-500 flex items-center justify-center">
                              <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            </div>
                          )}
                          {cellState.status === "running" && (
                            <div className="h-6 w-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                          )}
                          {cellState.status === "failed" && (
                            <div className="h-6 w-6 rounded-full bg-red-500 flex items-center justify-center">
                              <span className="text-white text-[13px] font-bold leading-none">!</span>
                            </div>
                          )}
                          {cellState.status === "queued" && (
                            <div className="h-6 w-6 rounded-full bg-gray-200 flex items-center justify-center">
                              <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                            </div>
                          )}
                          {cellState.status === "skipped" && (
                            <div className="h-6 w-6 rounded-full bg-gray-200 flex items-center justify-center">
                              <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    <div
                      className={`transition-all duration-200 ${
                        isDragging ? "opacity-20 scale-[0.98]" : ""
                      } ${highlightBlockId === block.id ? "ring-2 ring-blue-400 ring-offset-2 rounded-lg animate-pulse" : ""} ${
                        runAllState?.cells.find(c => c.blockId === block.id)?.status === "running"
                          ? "ring-2 ring-blue-400 rounded-lg"
                          : runAllState?.cells.find(c => c.blockId === block.id)?.status === "failed"
                            ? "ring-2 ring-red-300 rounded-lg"
                            : ""
                      }`}
                    >
                      <BlockWrapper
                        blockId={block.id}
                        blockIndex={visibleIndex}
                        blockType={block.type}
                        typeLabel={getTypeLabel(block)}
                        blockLabel={(block.content?.label as string) || ""}
                        blockVersion={block.version}
                        blockUpdatedAt={block.updated_at}
                        onLabelChange={(label) => updateBlockLabel(block.id, label)}
                        onBlockUpdate={(content) => updateBlock(block.id, content)}
                        onChangeType={(newType) => changeBlockType(block.id, newType)}
                        onDelete={() => deleteBlock(block.id)}
                        onDuplicate={() => duplicateBlock(block.id)}
                        onEdit={block.type === "command_ref" && onEditCommand ? async () => {
                          const cmdId = block.content?.command_id as string | undefined;
                          if (!cmdId) return;
                          const { data } = await supabase.from("commands").select("*").eq("id", cmdId).single();
                          if (data) onEditCommand(data as Command);
                        } : undefined}
                      >
                        {renderBlock(block)}
                        {isChild && block.parent_block_id && (
                          <RefineFooter
                            parentBlockId={block.parent_block_id}
                            blockId={block.id}
                            blockType={block.type}
                          />
                        )}
                      </BlockWrapper>
                    </div>

                    {showDropBelow && (
                      <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-blue-500 z-10" />
                    )}
                  </div>

                  {/* Run All — inline error recovery bar */}
                  {(() => {
                    const cellState = runAllState
                      ? runAllState.cells.find(c => c.blockId === block.id)
                      : null;
                    if (!cellState || cellState.status !== "failed") return null;
                    return (
                      <div className="mx-1 mt-1 flex items-center gap-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg animate-in fade-in slide-in-from-top-1 duration-200">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="h-5 w-5 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                            <svg className="h-3 w-3 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </div>
                          <span className="text-[13px] font-medium text-red-700 truncate">
                            Cell failed
                          </span>
                          {cellState.error && (
                            <span className="text-[12px] text-red-500 truncate">{cellState.error}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={retryFailedCell}
                            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md text-[13px] font-semibold
                                       border border-gray-300 bg-white text-gray-700 shadow-sm
                                       hover:bg-gray-50 transition-colors cursor-pointer"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            Retry
                          </button>
                          <button
                            onClick={skipCurrentCell}
                            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md text-[13px] font-semibold
                                       border border-gray-300 bg-white text-gray-700 shadow-sm
                                       hover:bg-gray-50 transition-colors cursor-pointer"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                            Skip and continue
                          </button>
                          <button
                            onClick={stopRunAll}
                            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md text-[13px] font-semibold
                                       border border-red-200 bg-white text-red-600 shadow-sm
                                       hover:bg-red-50 transition-colors cursor-pointer"
                          >
                            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                            Stop run
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Pulsing dots — shown below running AI cell while tools create blocks */}
                  {!isChild && runningBlockId === block.id && (
                    <div className="flex items-center gap-1.5 py-3 px-4">
                      <span className="flex gap-[3px]">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="h-[6px] w-[6px] rounded-full bg-blue-400 inline-block"
                            style={{
                              animation: "block-pulse 1.2s ease-in-out infinite",
                              animationDelay: `${i * 0.2}s`,
                            }}
                          />
                        ))}
                      </span>
                      <span className="text-[12px] text-gray-400">Creating blocks...</span>
                    </div>
                  )}
                </React.Fragment>
              );
            };

            return displayBlocks.map((block, index) => renderWrappedBlock(block, index));
          })()}
        </div>
      </SortableContext>

      {/* Drag overlay — full block with lift effect */}
      <DragOverlay dropAnimation={{
        duration: 200,
        easing: "cubic-bezier(0.25, 1, 0.5, 1)",
      }}>
        {activeBlock ? (
          <div className="opacity-90 shadow-xl shadow-black/10 ring-2 ring-cell-accent/30 rounded-md
                          scale-[1.02] rotate-[0.5deg]">
            {renderBlock(activeBlock)}
          </div>
        ) : null}
      </DragOverlay>

      {/* Click below to create new block */}
      <div
        ref={headerPickerAnchor}
        className="min-h-[40vh] cursor-text"
        onClick={handleClickBelow}
      >
        {blocks.length === 0 && (
          <p className="text-[15px] text-gray-300 pt-2 select-none">
            Click here to start writing...
          </p>
        )}
      </div>

      {/* Block type picker triggered from page header "Add block" button */}
      {showHeaderPicker && createPortal(
        <>
          <div className="fixed inset-0 z-[199]" onClick={() => setShowHeaderPicker(false)} />
          <div
            className="fixed z-[200] left-1/2 -translate-x-1/2"
            style={{ top: headerPickerTop }}
          >
            <BlockTypePicker
              onSelect={(type) => { createBlock(type, blocks.length - 1); setShowHeaderPicker(false); }}
              onClose={() => setShowHeaderPicker(false)}
            />
          </div>
        </>,
        document.body
      )}
    </DndContext>
  );
}

// Hover-activated "+" line between blocks
function AddLine({ onAdd }: { onAdd: (type: string) => void }) {
  const [showPicker, setShowPicker] = useState(false);
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPicker) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showPicker]);

  return (
    <div ref={ref} className="group/addline relative z-30" style={{ height: 0, marginTop: "-4px", marginBottom: "-4px" }}>
      {/* Hover trigger — hidden when picker is open */}
      {!showPicker && (
        <div className="absolute inset-x-0 -top-2 h-4 flex items-center cursor-pointer"
             onClick={() => {
               const rect = ref.current?.getBoundingClientRect();
               setPickerPosition({
                 top: (rect?.top ?? 0) + 4,
                 left: (rect?.left ?? 0) + (rect?.width ?? 0) / 2 - 128,
               });
               setShowPicker(true);
             }}>
          <div className="w-full relative opacity-0 group-hover/addline:opacity-100">
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] bg-blue-400 scale-x-0
                            group-hover/addline:scale-x-100 transition-transform duration-200 ease-out" />
            <div className="relative flex justify-center">
              <span className="bg-white px-2 text-[11px] text-blue-400 font-medium select-none leading-none">
                Add block
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Block type picker — portaled to body so backdrop blocks all hover zones */}
      {showPicker && createPortal(
        <>
          <div className="fixed inset-0 z-[199]" onClick={() => setShowPicker(false)} />
          <div
            className="fixed z-[200]"
            style={pickerPosition}
          >
            <BlockTypePicker
              onSelect={(type) => { onAdd(type); setShowPicker(false); }}
              onClose={() => setShowPicker(false)}
            />
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
