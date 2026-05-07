"use client";

import { useCallback, useRef } from "react";
import { PageMinimap } from "./page-minimap";
import type { Block } from "@/lib/models/types";

interface NotebookCanvasProps {
  blocks?: Block[];
  children?: React.ReactNode;
}

export function NotebookCanvas({ blocks = [], children }: NotebookCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScrollToBlock = useCallback((blockId: string) => {
    const el = document.querySelector(`[data-block-id="${blockId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  return (
    <div
      ref={scrollRef}
      data-notebook-canvas
      className="flex-1 min-w-0 min-h-0 bg-canvas-bg overflow-y-auto relative"
    >
      <div className="px-10 py-8">
        {children}
      </div>
      {/* Minimap — absolute right edge of canvas content area */}
      {blocks.length > 0 && (
        <div className="absolute top-14 right-4 z-20">
          <PageMinimap blocks={blocks} onScrollToBlock={handleScrollToBlock} />
        </div>
      )}
    </div>
  );
}
