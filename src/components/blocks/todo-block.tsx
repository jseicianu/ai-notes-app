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

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

let todoIdCounter = 0;

function nextTodoId() {
  todoIdCounter += 1;
  return `todo_new_${todoIdCounter}`;
}

function ensureIds(items: TodoItem[]): TodoItem[] {
  return items.map((item, i) => ({
    ...item,
    id: item.id || `todo_${i}`,
  }));
}

interface SortableTodoItemProps {
  item: TodoItem;
  index: number;
  blockId: string;
  onToggle: () => void;
  onTextChange: (text: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function SortableTodoItem({
  item,
  blockId,
  onToggle,
  onTextChange,
  onKeyDown,
  onRemove,
  canRemove,
}: SortableTodoItemProps) {
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
      className={`group/todo flex items-center gap-1.5 rounded-md px-1 py-0.5
                  hover:bg-gray-50 transition-colors duration-100
                  ${isDragging ? "opacity-50 z-50" : ""}`}
    >
      <div
        className="flex items-center justify-center w-4 shrink-0
                   opacity-0 group-hover/todo:opacity-100 transition-opacity
                   cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3 w-3 text-gray-300" />
      </div>

      <button
        onClick={onToggle}
        className={`flex h-4 w-4 items-center justify-center rounded border
                   transition-all duration-200 cursor-pointer flex-shrink-0
          ${item.done
            ? "bg-cell-accent border-cell-accent text-white"
            : "border-gray-300 hover:border-cell-accent"
          }`}
      >
        {item.done && (
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>

      <input
        type="text"
        value={item.text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="To-do item..."
        data-todo-block={blockId}
        className={`flex-1 text-sm bg-transparent outline-none placeholder:text-gray-300
                   transition-all duration-200
          ${item.done ? "line-through text-gray-400" : "text-gray-800"}`}
      />

      {canRemove && (
        <button
          onClick={onRemove}
          className="flex h-5 w-5 items-center justify-center rounded text-gray-300
                     opacity-0 group-hover/todo:opacity-100 hover:text-gray-500 hover:bg-gray-100
                     transition-all duration-150 cursor-pointer"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

interface TodoBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
}

export function TodoBlock({ block, onUpdate }: TodoBlockProps) {
  const [items, setItems] = useState<TodoItem[]>(
    ensureIds((block.content?.items as TodoItem[]) || [{ id: "", text: "", done: false }])
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const updateItems = useCallback(
    (newItems: TodoItem[]) => {
      setItems(newItems);
      onUpdate({ items: newItems });
    },
    [onUpdate]
  );

  const toggleItem = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], done: !newItems[index].done };
    updateItems(newItems);
  };

  const updateText = (index: number, text: string) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], text };
    updateItems(newItems);
  };

  const addItem = () => {
    updateItems([...items, { id: nextTodoId(), text: "", done: false }]);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    updateItems(items.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const newItems = [...items];
      newItems.splice(index + 1, 0, { id: nextTodoId(), text: "", done: false });
      updateItems(newItems);
      setTimeout(() => {
        const inputs = document.querySelectorAll<HTMLInputElement>(
          `[data-todo-block="${block.id}"]`
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
              <SortableTodoItem
                key={item.id}
                item={item}
                index={index}
                blockId={block.id}
                onToggle={() => toggleItem(index)}
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
