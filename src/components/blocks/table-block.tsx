"use client";

import { useState, useRef, useCallback } from "react";
import { Plus, X } from "lucide-react";
import type { Block } from "@/lib/models/types";

interface TableBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
}

// row -1 = header row, 0+ = data rows
type CellAddress = { row: number; col: number };

function cellId(blockId: string, row: number, col: number) {
  return `table-${blockId}-r${row}-c${col}`;
}

const MIN_COL_WIDTH = 80;
const DEFAULT_COL_WIDTH = 180;

export function TableBlock({ block, onUpdate }: TableBlockProps) {
  const [columns, setColumns] = useState<string[]>(
    (block.content?.columns as string[]) || ["Column 1", "Column 2"]
  );
  const [rows, setRows] = useState<Record<string, string>[]>(
    (block.content?.rows as Record<string, string>[]) || [{}]
  );
  const [colWidths, setColWidths] = useState<number[] | null>(() => {
    const saved = block.content?.col_widths as number[] | undefined;
    if (saved && saved.length === ((block.content?.columns as string[]) || []).length) return saved;
    return null;
  });

  const [activeCell, setActiveCell] = useState<CellAddress | null>(null);
  const [headerDrafts, setHeaderDrafts] = useState<Record<number, string>>({});
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [animatingRow, setAnimatingRow] = useState<number | null>(null);
  const [animatingCol, setAnimatingCol] = useState<number | null>(null);
  const [resizingCol, setResizingCol] = useState<number | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);
  const updateTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resizeStart = useRef<{ col: number; startX: number; startWidth: number } | null>(null);

  // --- Persistence (debounced to Supabase, local state is instant) ---

  const persistDebounced = useCallback(
    (newColumns: string[], newRows: Record<string, string>[]) => {
      clearTimeout(updateTimeout.current);
      updateTimeout.current = setTimeout(() => {
        onUpdate({ ...block.content, columns: newColumns, rows: newRows });
      }, 300);
    },
    [block.content, onUpdate]
  );

  const persistNow = useCallback(
    (newColumns: string[], newRows: Record<string, string>[], newWidths?: number[] | null) => {
      clearTimeout(updateTimeout.current);
      const widths = newWidths !== undefined ? newWidths : colWidths;
      onUpdate({ ...block.content, columns: newColumns, rows: newRows, ...(widths ? { col_widths: widths } : {}) });
    },
    [block.content, onUpdate, colWidths]
  );

  const persistWidths = useCallback(
    (newWidths: number[]) => {
      clearTimeout(updateTimeout.current);
      updateTimeout.current = setTimeout(() => {
        onUpdate({ ...block.content, col_widths: newWidths });
      }, 100);
    },
    [block.content, onUpdate]
  );

  const handleResizeStart = useCallback((ci: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    let currentWidths = colWidths;
    if (!currentWidths) {
      const headers = tableRef.current?.querySelectorAll("[data-col-header]");
      if (headers) {
        currentWidths = Array.from(headers).map((el) => el.getBoundingClientRect().width);
        setColWidths(currentWidths);
      } else {
        currentWidths = columns.map(() => DEFAULT_COL_WIDTH);
        setColWidths(currentWidths);
      }
    }

    setResizingCol(ci);
    resizeStart.current = { col: ci, startX: e.clientX, startWidth: currentWidths[ci] };

    const handleMove = (ev: MouseEvent) => {
      if (!resizeStart.current) return;
      const delta = ev.clientX - resizeStart.current.startX;
      const newWidth = Math.max(MIN_COL_WIDTH, resizeStart.current.startWidth + delta);
      setColWidths((prev) => {
        if (!prev) return prev;
        const next = [...prev];
        next[resizeStart.current!.col] = newWidth;
        return next;
      });
    };

    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizingCol(null);
      setColWidths((current) => {
        if (current) persistWidths(current);
        return current;
      });
      resizeStart.current = null;
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [columns, colWidths, persistWidths]);

  // --- Data mutations (update local state immediately, debounce persist) ---

  const updateCell = useCallback(
    (rowIdx: number, colName: string, value: string) => {
      setRows((prev) => {
        const next = prev.map((r, i) => (i === rowIdx ? { ...r, [colName]: value } : r));
        persistDebounced(columns, next);
        return next;
      });
    },
    [columns, persistDebounced]
  );

  const addColumn = useCallback(() => {
    let name = `Column ${columns.length + 1}`;
    let i = columns.length + 1;
    while (columns.includes(name)) { i++; name = `Column ${i}`; }
    const newColumns = [...columns, name];
    const newRows = rows.map((r) => ({ ...r, [name]: "" }));
    const newWidths = colWidths ? [...colWidths, DEFAULT_COL_WIDTH] : null;
    setColumns(newColumns);
    setRows(newRows);
    if (newWidths) setColWidths(newWidths);
    setAnimatingCol(newColumns.length - 1);
    persistNow(newColumns, newRows, newWidths ?? undefined);
    setTimeout(() => setAnimatingCol(null), 250);
  }, [columns, rows, colWidths, persistNow]);

  const addRow = useCallback(() => {
    const newRow: Record<string, string> = {};
    columns.forEach((c) => (newRow[c] = ""));
    const newRows = [...rows, newRow];
    setRows(newRows);
    setAnimatingRow(newRows.length - 1);
    persistNow(columns, newRows);
    setTimeout(() => setAnimatingRow(null), 250);
  }, [columns, rows, persistNow]);

  const deleteColumn = useCallback(
    (colIndex: number) => {
      if (columns.length <= 1) return;
      const colName = columns[colIndex];
      const newColumns = columns.filter((_, i) => i !== colIndex);
      const newRows = rows.map((r) => {
        const copy = { ...r };
        delete copy[colName];
        return copy;
      });
      const newWidths = colWidths ? colWidths.filter((_, i) => i !== colIndex) : null;
      setColumns(newColumns);
      setRows(newRows);
      if (newWidths) setColWidths(newWidths);
      persistNow(newColumns, newRows, newWidths ?? undefined);
      if (activeCell && activeCell.col >= newColumns.length) {
        setActiveCell({ row: activeCell.row, col: newColumns.length - 1 });
      }
    },
    [columns, rows, colWidths, persistNow, activeCell]
  );

  const deleteRow = useCallback(
    (rowIndex: number) => {
      if (rows.length <= 1) return;
      const newRows = rows.filter((_, i) => i !== rowIndex);
      setRows(newRows);
      persistNow(columns, newRows);
    },
    [rows, columns, persistNow]
  );

  const commitHeaderRename = useCallback(
    (colIndex: number, newName: string) => {
      const oldName = columns[colIndex];
      setHeaderDrafts((d) => { const next = { ...d }; delete next[colIndex]; return next; });
      if (!newName.trim() || newName.trim() === oldName) return;
      let finalName = newName.trim();
      if (columns.includes(finalName) && finalName !== oldName) {
        let i = 2;
        while (columns.includes(`${finalName} ${i}`)) i++;
        finalName = `${finalName} ${i}`;
      }
      const newColumns = columns.map((c, i) => (i === colIndex ? finalName : c));
      const newRows = rows.map((r) => {
        const newRow: Record<string, string> = {};
        columns.forEach((c, i) => {
          newRow[i === colIndex ? finalName : c] = r[c] || "";
        });
        return newRow;
      });
      setColumns(newColumns);
      setRows(newRows);
      persistNow(newColumns, newRows);
    },
    [columns, rows, persistNow]
  );

  // --- Unified navigation (row -1 = headers, 0+ = data) ---

  const minRow = -1;
  const maxRow = rows.length - 1;

  const focusCell = useCallback(
    (row: number, col: number) => {
      setActiveCell({ row, col });
      setTimeout(() => {
        const el = document.getElementById(cellId(block.id, row, col));
        if (el) {
          el.focus();
          if (el instanceof HTMLInputElement) {
            el.setSelectionRange(el.value.length, el.value.length);
          }
        }
      }, 0);
    },
    [block.id]
  );

  const navigate = useCallback(
    (from: CellAddress, direction: "up" | "down" | "left" | "right") => {
      let { row, col } = from;
      switch (direction) {
        case "up":
          row = Math.max(minRow, row - 1);
          break;
        case "down":
          row = Math.min(maxRow, row + 1);
          break;
        case "left":
          if (col > 0) col -= 1;
          else if (row > minRow) { row -= 1; col = columns.length - 1; }
          break;
        case "right":
          if (col < columns.length - 1) col += 1;
          else if (row < maxRow) { row += 1; col = 0; }
          break;
      }
      focusCell(row, col);
    },
    [minRow, maxRow, columns.length, focusCell]
  );

  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
      const input = e.currentTarget;
      const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
      const atEnd =
        input.selectionStart === input.value.length &&
        input.selectionEnd === input.value.length;

      if (e.key === "Tab") {
        e.preventDefault();
        if (row === -1) commitHeaderRename(col, input.value);
        if (e.shiftKey) {
          navigate({ row, col }, "left");
        } else if (col === columns.length - 1 && row === maxRow) {
          addRow();
          setTimeout(() => focusCell(row + 1, 0), 30);
        } else {
          navigate({ row, col }, "right");
        }
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (row === -1) commitHeaderRename(col, input.value);
        if (row === maxRow) {
          addRow();
          setTimeout(() => focusCell(row + 1, col), 30);
        } else {
          navigate({ row, col }, "down");
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        if (row === -1) {
          setHeaderDrafts((d) => { const next = { ...d }; delete next[col]; return next; });
        }
        input.blur();
        setActiveCell(null);
        return;
      }

      if (e.key === "ArrowUp") { e.preventDefault(); if (row === -1) commitHeaderRename(col, input.value); navigate({ row, col }, "up"); }
      else if (e.key === "ArrowDown") { e.preventDefault(); if (row === -1) commitHeaderRename(col, input.value); navigate({ row, col }, "down"); }
      else if (e.key === "ArrowLeft" && atStart) { e.preventDefault(); if (row === -1) commitHeaderRename(col, input.value); navigate({ row, col }, "left"); }
      else if (e.key === "ArrowRight" && atEnd) { e.preventDefault(); if (row === -1) commitHeaderRename(col, input.value); navigate({ row, col }, "right"); }

      if (row >= 0 && e.key === "Backspace" && input.value === "" && rows.length > 1) {
        if (columns.every((c) => !rows[row][c])) {
          e.preventDefault();
          deleteRow(row);
          if (row > 0) setTimeout(() => focusCell(row - 1, col), 30);
          else focusCell(-1, col);
        }
      }
    },
    [columns, rows, maxRow, navigate, focusCell, addRow, deleteRow, commitHeaderRename]
  );

  const isActive = (row: number, col: number) =>
    activeCell?.row === row && activeCell?.col === col;

  const headerValue = (ci: number) =>
    ci in headerDrafts ? headerDrafts[ci] : columns[ci];

  const cellAnim = (ri: number, ci: number) => {
    if (animatingRow === ri || animatingCol === ci) return "table-cell-new";
    return "";
  };

  return (
    <div
      ref={tableRef}
      className="relative group/table overflow-x-auto"
      onMouseLeave={() => { setHoveredRow(null); setHoveredCol(null); }}
    >
      <div
        className="inline-grid min-w-full"
        style={{ gridTemplateColumns: colWidths
          ? `36px ${colWidths.map((w) => `${w}px`).join(" ")} 32px`
          : `36px repeat(${columns.length}, minmax(${MIN_COL_WIDTH}px, 1fr)) 32px` }}
      >
        {/* Corner */}
        <div className="sticky left-0 z-10 bg-gray-50 border-b border-r border-gray-200" />

        {/* Column headers */}
        {columns.map((col, ci) => {
          const active = isActive(-1, ci);
          return (
            <div
              key={`h-${ci}`}
              data-col-header={ci}
              className={`group/header relative border-b border-r border-gray-200 transition-colors duration-100
                         ${active
                           ? "ring-2 ring-inset ring-cell-table z-20 bg-white"
                           : hoveredCol === ci
                             ? "bg-cell-table-light/50"
                             : "bg-gray-50"}
                         ${animatingCol === ci ? "table-cell-new" : ""}`}
              onMouseEnter={() => setHoveredCol(ci)}
              onMouseLeave={() => setHoveredCol(null)}
              onClick={() => focusCell(-1, ci)}
            >
              <input
                id={cellId(block.id, -1, ci)}
                type="text"
                value={headerValue(ci)}
                onChange={(e) => setHeaderDrafts((d) => ({ ...d, [ci]: e.target.value }))}
                onFocus={() => {
                  setActiveCell({ row: -1, col: ci });
                  if (!(ci in headerDrafts)) {
                    setHeaderDrafts((d) => ({ ...d, [ci]: columns[ci] }));
                  }
                }}
                onBlur={() => commitHeaderRename(ci, headerValue(ci))}
                onKeyDown={(e) => handleGridKeyDown(e, -1, ci)}
                className={`w-full px-3 py-2 text-[12px] font-semibold uppercase tracking-wider
                           bg-transparent outline-none transition-colors duration-100 cursor-default focus:cursor-text
                           ${active ? "text-gray-800" : "text-gray-500"}`}
              />

              {columns.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteColumn(ci); }}
                  className="absolute top-0 right-3 h-5 w-5 flex items-center justify-center
                             opacity-0 group-hover/header:opacity-100
                             text-gray-300 hover:text-red-500 hover:bg-red-50 rounded
                             transition-all duration-150 cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}

              {/* Resize handle */}
              <div
                onMouseDown={(e) => handleResizeStart(ci, e)}
                className={`absolute top-0 right-0 w-[5px] h-full cursor-col-resize z-30
                           group/resize
                           ${resizingCol === ci ? "" : "hover:bg-blue-500/0"}`}
              >
                <div className={`absolute right-0 top-0 w-[3px] h-full transition-opacity duration-100
                               ${resizingCol === ci
                                 ? "bg-blue-500 opacity-100"
                                 : "bg-blue-400 opacity-0 group-hover/resize:opacity-100"}`}
                />
              </div>
            </div>
          );
        })}

        {/* Add column button */}
        <div className="border-b border-gray-200 bg-gray-50 flex items-center justify-center">
          <button
            onClick={() => {
              addColumn();
              setTimeout(() => focusCell(-1, columns.length), 50);
            }}
            className="h-full w-full flex items-center justify-center
                       text-gray-300 hover:text-cell-table hover:bg-cell-table-light/40
                       transition-all duration-150 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Data rows */}
        {rows.map((row, ri) => (
          <div key={`r-${ri}`} className="contents" role="row">
            {/* Row number / delete */}
            <div
              className={`group/rownum sticky left-0 z-10 flex items-center justify-center
                         border-b border-r border-gray-200 text-[11px] tabular-nums select-none
                         transition-colors duration-100
                         ${hoveredRow === ri ? "bg-cell-table-light/40 text-cell-table" : "bg-gray-50/80 text-gray-400"}
                         ${animatingRow === ri ? "table-cell-new" : ""}`}
              onMouseEnter={() => setHoveredRow(ri)}
              onMouseLeave={() => setHoveredRow(null)}
            >
              {rows.length > 1 ? (
                <button
                  onClick={() => deleteRow(ri)}
                  className={`h-full w-full flex items-center justify-center cursor-pointer
                             transition-all duration-100
                             ${hoveredRow === ri ? "text-gray-400 hover:text-red-500" : ""}`}
                  title="Delete row"
                >
                  {hoveredRow === ri ? <X className="h-3 w-3" /> : <span>{ri + 1}</span>}
                </button>
              ) : (
                <span>{ri + 1}</span>
              )}
            </div>

            {/* Data cells */}
            {columns.map((colName, ci) => {
              const active = isActive(ri, ci);
              return (
                <div
                  key={`c-${ri}-${ci}`}
                  className={`relative border-b border-r border-gray-200 transition-all duration-75
                             ${active
                               ? "ring-2 ring-inset ring-cell-table z-20 bg-white"
                               : hoveredRow === ri || hoveredCol === ci
                                 ? "bg-cell-table-light/20"
                                 : "bg-white"}
                             ${cellAnim(ri, ci)}`}
                  onMouseEnter={() => { setHoveredRow(ri); setHoveredCol(ci); }}
                  onClick={() => focusCell(ri, ci)}
                >
                  <input
                    id={cellId(block.id, ri, ci)}
                    type="text"
                    value={row[colName] || ""}
                    onChange={(e) => updateCell(ri, colName, e.target.value)}
                    onFocus={() => setActiveCell({ row: ri, col: ci })}
                    onKeyDown={(e) => handleGridKeyDown(e, ri, ci)}
                    className="w-full h-full px-3 py-2 text-[13px] text-gray-800 bg-transparent
                               outline-none placeholder:text-gray-300 cursor-default focus:cursor-text"
                    placeholder={active ? "Type..." : ""}
                  />
                </div>
              );
            })}

            {/* Gutter */}
            <div className="border-b border-gray-200" onMouseEnter={() => setHoveredRow(ri)} />
          </div>
        ))}

        {/* Spacer row */}
        <div className="sticky left-0 z-10" />
        {columns.map((_, ci) => (
          <div key={`gap-${ci}`} className="border-r border-gray-200/50" />
        ))}
        <div />
      </div>

      {/* Add row button */}
      <button
        onClick={() => { addRow(); setTimeout(() => focusCell(rows.length, 0), 30); }}
        className="flex items-center gap-1.5 w-full px-3 py-1.5
                   text-[11px] text-gray-400 hover:text-cell-table hover:bg-cell-table-light/30
                   transition-all duration-150 cursor-pointer border-t border-gray-200/50"
      >
        <Plus className="h-3 w-3" />
        <span>New row</span>
      </button>
    </div>
  );
}
