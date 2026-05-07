"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Block } from "@/lib/models/types";

interface FileBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function mimeLabel(mime: string): string {
  const map: Record<string, string> = {
    "application/pdf": "PDF",
    "application/json": "JSON",
    "text/plain": "TXT",
    "text/csv": "CSV",
    "text/markdown": "MD",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/gif": "GIF",
    "image/webp": "WEBP",
    "image/svg+xml": "SVG",
  };
  return map[mime] || mime.split("/").pop()?.toUpperCase() || "FILE";
}

export function FileBlock({ block, onUpdate }: FileBlockProps) {
  const fileId = block.content?.file_id as string | undefined;
  const filename = block.content?.filename as string | undefined;
  const mimeType = block.content?.mime_type as string | undefined;
  const size = block.content?.size as number | undefined;

  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);

  const hasFile = Boolean(fileId && filename);

  const uploadFile = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);

      try {
        const ext = file.name.split(".").pop() || "";
        const storagePath = `${block.workspace_id}/${block.id}/${Date.now()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("files")
          .upload(storagePath, file, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: fileRecord, error: dbError } = await supabase
          .from("files")
          .insert({
            workspace_id: block.workspace_id,
            filename: file.name,
            mime_type: file.type || "application/octet-stream",
            size_bytes: file.size,
            storage_path: storagePath,
            metadata: {},
          })
          .select()
          .single();

        if (dbError || !fileRecord) throw dbError || new Error("Failed to save file record");

        onUpdate({
          file_id: fileRecord.id,
          filename: file.name,
          mime_type: file.type || "application/octet-stream",
          size: file.size,
          storage_path: storagePath,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [supabase, block.workspace_id, block.id, onUpdate]
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      uploadFile(files[0]);
    },
    [uploadFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleRemove = useCallback(() => {
    onUpdate({ file_id: null, filename: null, mime_type: null, size: null, storage_path: null });
  }, [onUpdate]);

  // Upload zone (no file attached yet)
  if (!hasFile) {
    return (
      <div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        <div
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md
                     border border-dashed transition-all duration-200
                     ${uploading
                       ? "border-gray-300 cursor-wait"
                       : dragOver
                         ? "border-gray-400 bg-gray-50"
                         : "border-gray-200 hover:border-gray-300 cursor-pointer"
                     }`}
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 text-gray-400 animate-spin" />
          ) : (
            <Upload className={`h-3.5 w-3.5 transition-colors duration-200
                               ${dragOver ? "text-gray-500" : "text-gray-300"}`} />
          )}
          <span className={`text-[13px] transition-colors duration-200
                          ${dragOver ? "text-gray-600" : "text-gray-400"}`}>
            {uploading ? "Uploading..." : "Drop file or click to browse"}
          </span>
        </div>

        {error && (
          <p className="text-[11px] text-cell-error mt-1.5 px-1">{error}</p>
        )}
      </div>
    );
  }

  // File display — inline input-style chip
  return (
    <div className="px-3 py-2 group/file">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="inline-flex items-center rounded-md border border-gray-200 bg-white
                      hover:border-gray-300 transition-colors duration-150 overflow-hidden">
        {/* Filename */}
        <span className="px-3 py-1.5 text-[13px] text-gray-800 truncate max-w-[240px]">
          {filename}
        </span>

        {/* Metadata */}
        <span className="text-[11px] text-gray-400 pr-3 shrink-0 tabular-nums">
          {mimeLabel(mimeType || "")} · {size != null ? formatBytes(size) : ""}
        </span>

        {/* X remove */}
        <button
          onClick={handleRemove}
          className="h-full px-1.5 flex items-center justify-center
                     border-l border-gray-200
                     text-gray-300 hover:text-gray-500 hover:bg-gray-50
                     transition-colors cursor-pointer"
        >
          <X className="h-3 w-3" />
        </button>

        {/* Replace */}
        <button
          onClick={() => inputRef.current?.click()}
          className="h-full px-2.5 py-1.5 flex items-center justify-center
                     border-l border-gray-200 text-[11px] font-medium
                     text-gray-400 hover:text-gray-600 hover:bg-gray-50
                     transition-colors cursor-pointer"
        >
          Replace
        </button>
      </div>
    </div>
  );
}
