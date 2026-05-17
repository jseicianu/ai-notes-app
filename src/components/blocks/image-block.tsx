"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Check, Copy, Loader2, Replace, Download, Trash2, ImageIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Block } from "@/lib/models/types";

interface ImageBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
}

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const MIN_WIDTH_PERCENT = 25;

export function ImageBlock({ block, onUpdate }: ImageBlockProps) {
  const storagePath = block.content?.storage_path as string | undefined;
  const fileId = block.content?.file_id as string | undefined;
  const filename = block.content?.filename as string | undefined;
  const caption = (block.content?.caption as string) || "";
  const savedWidth = typeof block.content?.width_percent === "number"
    ? block.content.width_percent
    : 100;

  const supabase = useMemo(() => createClient(), []);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [widthPercent, setWidthPercent] = useState(() =>
    Math.min(100, Math.max(MIN_WIDTH_PERCENT, savedWidth))
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const imageFrameRef = useRef<HTMLDivElement>(null);

  const hasImage = Boolean(storagePath);

  useEffect(() => {
    let cancelled = false;
    async function loadSignedUrl() {
      if (!storagePath) {
        if (!cancelled) setImageUrl(null);
        return;
      }

      const { data, error: signedUrlError } = await supabase.storage
        .from("files")
        .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

      if (!cancelled) {
        setImageUrl(signedUrlError ? null : data.signedUrl);
        setError(signedUrlError ? signedUrlError.message : null);
      }
    }

    void loadSignedUrl();
    return () => {
      cancelled = true;
    };
  }, [storagePath, supabase]);

  const removeStoredImage = useCallback(
    async (path?: string, id?: string) => {
      if (path) {
        const { error: storageError } = await supabase.storage.from("files").remove([path]);
        if (storageError) throw storageError;
      }
      if (id) {
        const { error: deleteError } = await supabase
          .from("files")
          .delete()
          .eq("id", id)
          .eq("workspace_id", block.workspace_id);
        if (deleteError) throw deleteError;
      }
    },
    [supabase, block.workspace_id]
  );

  const uploadImage = useCallback(
    async (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError("Only PNG, JPEG, GIF, WebP, and SVG images are supported");
        return;
      }
      setError(null);
      setUploading(true);

      try {
        const ext = file.name.split(".").pop() || "png";
        const path = `${block.workspace_id}/${block.id}/${Date.now()}.${ext}`;
        const previousStoragePath = storagePath;
        const previousFileId = fileId;

        const { error: uploadError } = await supabase.storage
          .from("files")
          .upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;

        const { data: fileRecord, error: dbError } = await supabase
          .from("files")
          .insert({
            workspace_id: block.workspace_id,
            filename: file.name,
            mime_type: file.type,
            size_bytes: file.size,
            storage_path: path,
            metadata: {},
          })
          .select()
          .single();
        if (dbError || !fileRecord) throw dbError || new Error("Failed to save file record");

        onUpdate({
          ...block.content,
          file_id: fileRecord.id,
          filename: file.name,
          mime_type: file.type,
          size: file.size,
          storage_path: path,
          width_percent: widthPercent,
        });

        if (previousStoragePath && previousStoragePath !== path) {
          void removeStoredImage(previousStoragePath, previousFileId).catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "Previous image cleanup failed");
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [
      supabase,
      block.workspace_id,
      block.id,
      block.content,
      storagePath,
      fileId,
      widthPercent,
      removeStoredImage,
      onUpdate,
    ]
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      uploadImage(files[0]);
    },
    [uploadImage]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleRemove = useCallback(async () => {
    const previousStoragePath = storagePath;
    const previousFileId = fileId;
    onUpdate({
      caption: block.content?.caption,
      width_percent: widthPercent,
    });
    try {
      await removeStoredImage(previousStoragePath, previousFileId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image removed, but cleanup failed");
    }
  }, [storagePath, fileId, onUpdate, block.content?.caption, widthPercent, removeStoredImage]);

  const handleDownload = useCallback(() => {
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = filename || "image";
    a.target = "_blank";
    a.click();
  }, [imageUrl, filename]);

  const handleCaptionChange = useCallback(
    (newCaption: string) => {
      onUpdate({ ...block.content, caption: newCaption });
    },
    [block.content, onUpdate]
  );

  const handleCaptionBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const newCaption = e.currentTarget.value;
      if (newCaption !== caption) {
        handleCaptionChange(newCaption);
      }
    },
    [caption, handleCaptionChange]
  );

  const handleCopyUrl = useCallback(async () => {
    if (!imageUrl) return;
    await navigator.clipboard.writeText(imageUrl);
    setCopiedUrl(true);
    window.setTimeout(() => setCopiedUrl(false), 1500);
  }, [imageUrl]);

  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!imageFrameRef.current) return;
      e.preventDefault();
      const frameRect = imageFrameRef.current.getBoundingClientRect();

      const handlePointerMove = (event: PointerEvent) => {
        const nextWidth = ((event.clientX - frameRect.left) / frameRect.width) * 100;
        setWidthPercent(Math.min(100, Math.max(MIN_WIDTH_PERCENT, Math.round(nextWidth))));
      };

      const handlePointerUp = (event: PointerEvent) => {
        const nextWidth = Math.min(
          100,
          Math.max(
            MIN_WIDTH_PERCENT,
            Math.round(((event.clientX - frameRect.left) / frameRect.width) * 100)
          )
        );
        setWidthPercent(nextWidth);
        onUpdate({ ...block.content, width_percent: nextWidth });
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [block.content, onUpdate]
  );

  // Upload zone — no image yet
  if (!hasImage) {
    return (
      <div className="px-4 py-6">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-3 py-10 rounded-lg
                     border-2 border-dashed transition-all duration-200 cursor-pointer
                     ${uploading
                       ? "border-gray-300 bg-gray-50/50"
                       : dragOver
                         ? "border-blue-400 bg-blue-50/50"
                         : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/50"
                     }`}
        >
          {uploading ? (
            <Loader2 className="h-8 w-8 text-gray-300 animate-spin" />
          ) : (
            <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
              <ImageIcon className={`h-6 w-6 transition-colors ${dragOver ? "text-blue-400" : "text-gray-300"}`} />
            </div>
          )}
          <div className="text-center">
            <p className={`text-[13px] font-medium ${dragOver ? "text-blue-600" : "text-gray-500"}`}>
              {uploading ? "Uploading..." : "Drop an image or click to browse"}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">
              PNG, JPEG, GIF, WebP, SVG
            </p>
          </div>
        </div>
        {error && <p className="text-[11px] text-red-500 mt-2 px-1">{error}</p>}
      </div>
    );
  }

  // Image display
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* Image */}
      {imageUrl && (
        <div className="px-4 pt-4" ref={imageFrameRef}>
          <div
            className="relative group"
            style={{ width: `${widthPercent}%` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={caption || filename || "Image"}
              onClick={() => setLightbox(true)}
              className="w-full rounded-md object-contain max-h-[600px] cursor-zoom-in
                         bg-gray-50 border border-gray-100"
            />
            <button
              type="button"
              aria-label="Resize image"
              onPointerDown={handleResizeStart}
              className="absolute right-[-6px] top-1/2 h-12 w-3 -translate-y-1/2
                         rounded-full border border-gray-200 bg-white shadow-sm
                         opacity-0 group-hover:opacity-100 transition-opacity
                         cursor-ew-resize"
            />
          </div>
        </div>
      )}

      {/* Caption */}
      <div className="px-4 py-2">
        <input
          type="text"
          key={`${block.id}:${caption}`}
          defaultValue={caption}
          onBlur={handleCaptionBlur}
          placeholder="Add a caption..."
          className="w-full text-[13px] text-gray-500 bg-transparent outline-none
                     placeholder:text-gray-300 placeholder:italic"
        />
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-1.5 px-4 pb-3">
        <button
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium
                     text-gray-500 hover:bg-gray-100 transition-colors cursor-pointer"
        >
          <Replace className="h-3.5 w-3.5" />
          Replace
        </button>
        <button
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium
                     text-gray-500 hover:bg-gray-100 transition-colors cursor-pointer"
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </button>
        <button
          onClick={handleCopyUrl}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium
                     text-gray-500 hover:bg-gray-100 transition-colors cursor-pointer"
        >
          {copiedUrl ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-500" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy URL
            </>
          )}
        </button>
        <button
          onClick={handleRemove}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium
                     text-gray-500 hover:bg-gray-100 hover:text-red-500 transition-colors cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>

      {/* Lightbox */}
      {lightbox && imageUrl && (
        <div
          className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center cursor-zoom-out
                     animate-in fade-in duration-200"
          onClick={() => setLightbox(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={caption || filename || "Image"}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
