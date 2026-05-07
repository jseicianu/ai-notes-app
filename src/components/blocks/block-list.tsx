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
import type { Block, BlockType, Command } from "@/lib/models/types";

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
  if (type === "separator") content = {};
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
  onViewRun?: () => void;
  onEditCommand?: (command: Command) => void;
}

export function BlockList({
  pageId,
  workspaceId,
  initialBlocks,
  onBlocksChange,
  refreshTrigger,
  addBlockTrigger,
  runAllTrigger,
  onViewRun,
  onEditCommand,
}: BlockListProps) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);

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

  // "Run all" triggered from page header — run all AI cells sequentially
  const runAllRef = useRef(false);
  const blocksRef = useRef(blocks);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    if (!runAllTrigger || runAllTrigger === 0) return;
    if (runAllRef.current) return;
    runAllRef.current = true;

    async function runAllCells() {
      const aiCells = blocksRef.current.filter((b) => b.type === "ai_cell");
      for (const cell of aiCells) {
        const el = document.querySelector(`[data-block-id="${cell.id}"] button[data-run-button]`) as HTMLButtonElement | null;
        if (el) {
          el.click();
          await new Promise<void>((resolve) => {
            const check = () => {
              const still = document.querySelector(`[data-block-id="${cell.id}"] [data-running="true"]`);
              if (!still) { resolve(); return; }
              setTimeout(check, 500);
            };
            setTimeout(check, 1000);
          });
        }
      }
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
    },
    [supabase]
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

      const oldIndex = blocks.findIndex((b) => b.id === active.id);
      const newIndex = blocks.findIndex((b) => b.id === over.id);

      const newBlocks = arrayMove(blocks, oldIndex, newIndex);
      setBlocks(newBlocks);

      const updates = newBlocks.map((b, i) => ({ id: b.id, sort_order: i }));
      await Promise.all(
        updates.map(({ id, sort_order }) =>
          supabase.from("blocks").update({ sort_order }).eq("id", id)
        )
      );
    },
    [blocks, supabase]
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
          />
        );

      case "todo":
        return (
          <TodoBlock
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
          />
        );

      case "table":
        return (
          <TableBlock
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

      case "command_ref":
        return (
          <CommandRefBlock
            block={block}
            onUpdate={(content) => updateBlock(block.id, content)}
            onRunComplete={refreshBlocks}
            onRunningChange={(running) => setRunningBlockId(running ? block.id : null)}
            pageBlocks={blocks}
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
        items={blocks.map((b) => b.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2">
          {(() => {
            let visibleCount = 0;
            return blocks.map((block, index) => {
            // Hide output blocks owned by AI cells — they render inline
            if (block.type === "output" && block.parent_block_id) return null;

            visibleCount++;

            const isDragging = activeId === block.id;
            const isDropTarget = overId === block.id && activeId !== block.id;
            const activeIndex = activeId ? blocks.findIndex((b) => b.id === activeId) : -1;
            const showDropAbove = isDropTarget && activeIndex > index;
            const showDropBelow = isDropTarget && activeIndex < index;

            const visibleIndex = visibleCount;

            return (
              <React.Fragment key={block.id}>
                {/* Hover add-line between blocks — sits in the gap */}
                {index > 0 && !activeId && (
                  <AddLine onAdd={(type) => createBlock(type, index - 1)} />
                )}

                <div data-block-id={block.id} className="relative">
                  {/* Drop indicator — above */}
                  {showDropAbove && (
                    <div className="absolute -top-1 left-0 right-0 h-0.5 bg-blue-500 z-10" />
                  )}

                  <div
                    className={`transition-all duration-200 ${
                      isDragging ? "opacity-20 scale-[0.98]" : ""
                    }`}
                  >
                    <BlockWrapper
                      blockId={block.id}
                      blockIndex={visibleIndex}
                      blockType={block.type}
                      typeLabel={getTypeLabel(block)}
                      blockLabel={(block.content?.label as string) || ""}
                      onLabelChange={(label) => updateBlockLabel(block.id, label)}
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
                    </BlockWrapper>
                  </div>

                  {/* Drop indicator — below */}
                  {showDropBelow && (
                    <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-blue-500 z-10" />
                  )}
                </div>

                {/* Pulsing dots — shown below running AI cell while tools create blocks */}
                {runningBlockId === block.id && (
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
          });
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
