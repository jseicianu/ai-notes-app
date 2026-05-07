"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Page, Tag } from "@/lib/models/types";

/* ── main component ── */

interface PageHeaderV2Props {
  page: Page;
  workspaceId: string;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
  onTagsChange: (tags: string[]) => void;
  controlPanelContent?: React.ReactNode;
}

export function PageHeaderV2({
  page,
  workspaceId,
  onTitleChange,
  onDescriptionChange,
  onTagsChange,
  controlPanelContent,
}: PageHeaderV2Props) {
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [workspaceTags, setWorkspaceTags] = useState<Tag[]>([]);
  const tagPickerRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);

  const loadTags = useCallback(async () => {
    const { data } = await supabase
      .from("tags")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("usage_count", { ascending: false });
    setWorkspaceTags((data as Tag[]) ?? []);
  }, [supabase, workspaceId]);

  useEffect(() => {
    void Promise.resolve().then(loadTags);
  }, [loadTags]);

  useEffect(() => {
    if (!showTagPicker) return;
    function handleClickOutside(e: MouseEvent) {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target as Node)) {
        setShowTagPicker(false);
        setTagSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showTagPicker]);

  useEffect(() => {
    if (showTagPicker) tagInputRef.current?.focus();
  }, [showTagPicker]);

  const currentTags = page.tags ?? [];

  const suggestedTags = workspaceTags
    .filter((t) => !currentTags.includes(t.name))
    .filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase()));

  const canCreateNew =
    tagSearch.trim().length > 0 &&
    !workspaceTags.some((t) => t.name.toLowerCase() === tagSearch.trim().toLowerCase()) &&
    !currentTags.includes(tagSearch.trim());

  const addTag = async (tagName: string) => {
    const name = tagName.trim().toLowerCase().replace(/\s+/g, "-");
    if (!name || currentTags.includes(name)) return;
    const newTags = [...currentTags, name];
    onTagsChange(newTags);
    setTagSearch("");

    const existing = workspaceTags.find((t) => t.name === name);
    if (existing) {
      await supabase.from("tags").update({ usage_count: existing.usage_count + 1 }).eq("id", existing.id);
    } else {
      await supabase.from("tags").insert({ workspace_id: workspaceId, name, usage_count: 1 });
    }
    loadTags();
  };

  const removeTag = (tagName: string) => {
    onTagsChange(currentTags.filter((t) => t !== tagName));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagSearch.trim()) {
      e.preventDefault();
      if (suggestedTags.length > 0) addTag(suggestedTags[0].name);
      else if (canCreateNew) addTag(tagSearch);
    }
    if (e.key === "Escape") {
      setShowTagPicker(false);
      setTagSearch("");
    }
  };

  const hasControlPanel = Boolean(controlPanelContent);

  return (
    <div className="relative mb-8 select-none">
      <div className="border border-gray-200">
        {/* ── Title section ── */}
        <div className="px-6 pt-6 pb-4">
          <input
            type="text"
            value={page.title === "Untitled" ? "" : page.title}
            onChange={(e) => onTitleChange(e.target.value || "Untitled")}
            placeholder="Untitled"
            className="w-full text-[36px] font-bold text-gray-900 tracking-tight leading-tight
                       bg-transparent border-none outline-none placeholder:text-gray-200"
          />
          <input
            type="text"
            value={page.description ?? ""}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Add a description..."
            className="w-full text-[14px] text-gray-400 bg-transparent border-none outline-none
                       placeholder:text-gray-200 mt-1"
          />
        </div>

        {/* ── Tags section ── */}
        <div className="border-t border-gray-200">
          <div className="relative flex items-center gap-0 min-h-[36px]">
            {currentTags.map((tag) => (
              <div key={tag} className="flex items-center">
                <div
                  className="group/tag flex items-center gap-1.5 px-4 h-[36px]
                             border-r border-gray-200
                             text-[12px] font-medium text-gray-600 uppercase tracking-wider
                             hover:bg-gray-50 transition-colors duration-200"
                >
                  <span>{tag}</span>
                  <button
                    onClick={() => removeTag(tag)}
                    className="flex h-4 w-4 items-center justify-center
                               text-gray-300 hover:text-red-400
                               opacity-0 group-hover/tag:opacity-100 transition-all duration-150 cursor-pointer"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
            ))}

            {/* Add tag button */}
            <div className="relative" ref={tagPickerRef}>
              <button
                onClick={() => setShowTagPicker(!showTagPicker)}
                className="flex items-center justify-center h-[36px] w-[36px]
                           text-gray-300 hover:text-cell-accent hover:bg-cell-accent-light/30
                           transition-all duration-200 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>

              {showTagPicker && (
                <div className="absolute left-0 top-[36px] w-56 border border-gray-200 bg-white shadow-lg z-50
                                animate-in fade-in slide-in-from-top-1 duration-150">
                  <div className="p-2 border-b border-gray-200">
                    <input
                      ref={tagInputRef}
                      type="text"
                      placeholder="Search or create tag..."
                      value={tagSearch}
                      onChange={(e) => setTagSearch(e.target.value)}
                      onKeyDown={handleTagKeyDown}
                      className="w-full px-2.5 py-1.5 text-sm bg-gray-50 border border-gray-200
                                 outline-none focus:border-cell-accent focus:ring-1 focus:ring-cell-accent/30
                                 transition-colors placeholder:text-gray-400"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto p-1">
                    {suggestedTags.length > 0 && (
                      <>
                        <div className="px-3 py-1 text-[10px] uppercase tracking-wider font-medium text-gray-400">
                          {tagSearch ? "Matching" : "Suggested"}
                        </div>
                        {suggestedTags.slice(0, 8).map((tag) => (
                          <button
                            key={tag.id}
                            onClick={() => addTag(tag.name)}
                            className="flex w-full items-center gap-2 px-3 py-1.5
                                       text-sm text-gray-700 hover:bg-gray-50 cursor-pointer transition-colors"
                          >
                            <span>{tag.name}</span>
                            <span className="ml-auto text-[10px] text-gray-300">{tag.usage_count}</span>
                          </button>
                        ))}
                      </>
                    )}
                    {canCreateNew && (
                      <>
                        {suggestedTags.length > 0 && <div className="mx-2 my-1 border-t border-gray-100" />}
                        <button
                          onClick={() => addTag(tagSearch)}
                          className="flex w-full items-center gap-2 px-3 py-1.5
                                     text-sm text-cell-accent hover:bg-cell-accent-light cursor-pointer transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Create &quot;{tagSearch.trim().toLowerCase().replace(/\s+/g, "-")}&quot;</span>
                        </button>
                      </>
                    )}
                    {suggestedTags.length === 0 && !canCreateNew && (
                      <div className="px-3 py-3 text-sm text-gray-400 text-center">No tags found</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Control Panel section (only if present) ── */}
        {hasControlPanel && (
          <div className="border-t border-gray-200">
            {controlPanelContent}
          </div>
        )}
      </div>

    </div>
  );
}
