"use client";

import { useState, useCallback } from "react";
import { Plus, X, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import type { Block } from "@/lib/models/types";

interface ListItem {
  id: string;
  text: string;
}

let listIdCounter = 0;

function nextListId() {
  listIdCounter += 1;
  return `li_new_${listIdCounter}`;
}

function ensureIds(items: ListItem[]): ListItem[] {
  return items.map((item, i) => ({
    ...item,
    id: item.id || `li_${i}`,
  }));
}

function parseHtmlToItems(doc: string): ListItem[] {
  const matches = doc.match(/<li>(.*?)<\/li>/g);
  if (!matches) return [{ id: "li_0", text: "" }];
  return matches.map((m, i) => ({
    id: `li_${i}`,
    text: m.replace(/<\/?li>/g, "").replace(/<\/?p>/g, ""),
  }));
}

interface SortableListItemProps {
  item: ListItem;
  index: number;
  ordered: boolean;
  blockId: string;
  onTextChange: (text: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function SortableListItem({
  item,
  index,
  ordered,
  blockId,
  onTextChange,
  onKeyDown,
  onRemove,
  canRemove,
}: SortableListItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/li flex items-center gap-1.5 rounded-md px-1 py-0.5
                  hover:bg-gray-50 transition-colors duration-100
                  ${isDragging ? "opacity-50 z-50" : ""}`}
    >
      <div
        className="flex items-center justify-center w-4 shrink-0
                   opacity-0 group-hover/li:opacity-100 transition-opacity
                   cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3 w-3 text-gray-300" />
      </div>

      <span className="text-sm text-gray-400 w-4 shrink-0 text-right select-none">
        {ordered ? `${index + 1}.` : "•"}
      </span>

      <input
        type="text"
        value={item.text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="List item..."
        data-list-block={blockId}
        className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-300
                   text-gray-800 transition-all duration-200"
      />

      {canRemove && (
        <button
          onClick={onRemove}
          className="flex h-5 w-5 items-center justify-center rounded text-gray-300
                     opacity-0 group-hover/li:opacity-100 hover:text-gray-500 hover:bg-gray-100
                     transition-all duration-150 cursor-pointer"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

interface ListBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
}

export function ListBlock({ block, onUpdate }: ListBlockProps) {
  const ordered = block.type === "numbered_list";

  const [items, setItems] = useState<ListItem[]>(() => {
    if (block.content?.items) return ensureIds(block.content.items as ListItem[]);
    if (block.content?.doc) return parseHtmlToItems(block.content.doc as string);
    return [{ id: "li_0", text: "" }];
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const updateItems = useCallback(
    (newItems: ListItem[]) => {
      setItems(newItems);
      const tag = ordered ? "ol" : "ul";
      const doc = `<${tag}>${newItems.map((i) => `<li>${i.text}</li>`).join("")}</${tag}>`;
      onUpdate({ items: newItems, doc });
    },
    [onUpdate, ordered]
  );

  const updateText = (index: number, text: string) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], text };
    updateItems(newItems);
  };

  const addItem = () => {
    updateItems([...items, { id: nextListId(), text: "" }]);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    updateItems(items.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const newItems = [...items];
      newItems.splice(index + 1, 0, { id: nextListId(), text: "" });
      updateItems(newItems);
      setTimeout(() => {
        const inputs = document.querySelectorAll<HTMLInputElement>(
          `[data-list-block="${block.id}"]`
        );
        inputs[index + 1]?.focus();
      }, 50);
    }
    if (e.key === "Backspace" && items[index].text === "" && items.length > 1) {
      e.preventDefault();
      removeItem(index);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    updateItems(arrayMove(items, oldIndex, newIndex));
  };

  return (
    <div className="px-3 py-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-0.5">
            {items.map((item, index) => (
              <SortableListItem
                key={item.id}
                item={item}
                index={index}
                ordered={ordered}
                blockId={block.id}
                onTextChange={(text) => updateText(index, text)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                onRemove={() => removeItem(index)}
                canRemove={items.length > 1}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <button
        onClick={addItem}
        className="flex items-center gap-1.5 mt-1 px-1 py-1 rounded-md text-xs
                   text-gray-400 hover:text-cell-accent hover:bg-cell-accent-light
                   transition-all duration-150 cursor-pointer"
      >
        <Plus className="h-3 w-3" />
        <span>Add item</span>
      </button>
    </div>
  );
}
