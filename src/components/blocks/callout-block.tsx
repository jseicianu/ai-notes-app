"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Info, AlertTriangle, Lightbulb, AlertCircle } from "lucide-react";
import type { Block } from "@/lib/models/types";

const calloutStyles: Record<string, { bg: string; border: string; icon: React.ReactNode }> = {
  info: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    icon: <Info className="h-4 w-4 text-blue-500" />,
  },
  warning: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  },
  tip: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    icon: <Lightbulb className="h-4 w-4 text-emerald-500" />,
  },
  error: {
    bg: "bg-red-50",
    border: "border-red-200",
    icon: <AlertCircle className="h-4 w-4 text-red-500" />,
  },
};

interface CalloutBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
}

export function CalloutBlock({ block, onUpdate }: CalloutBlockProps) {
  const calloutType = (block.content?.type as string) || "info";
  const style = calloutStyles[calloutType] || calloutStyles.info;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Placeholder.configure({ placeholder: "Type something..." }),
    ],
    content: (block.content?.doc as string) || "",
    editorProps: {
      attributes: {
        class: "outline-none w-full text-[14px] text-gray-700 leading-relaxed",
      },
    },
    onUpdate: ({ editor: ed }) => {
      onUpdate({ ...block.content, doc: ed.getHTML() });
    },
    immediatelyRender: false,
  });

  const cycleType = () => {
    const types = ["info", "warning", "tip", "error"];
    const next = types[(types.indexOf(calloutType) + 1) % types.length];
    onUpdate({ ...block.content, type: next });
  };

  return (
    <div className={`flex gap-3 rounded-md ${style.bg} border ${style.border} px-4 py-3`}>
      <button
        onClick={cycleType}
        className="flex-shrink-0 mt-0.5 cursor-pointer hover:opacity-70 transition-opacity"
        title="Change callout type"
      >
        {style.icon}
      </button>
      <div className="flex-1 min-w-0">
        <EditorContent
          editor={editor}
          className="prose prose-sm max-w-none
                     prose-p:my-0 prose-p:leading-relaxed
                     [&_.tiptap_p.is-editor-empty:first-child::before]:text-gray-400
                     [&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]
                     [&_.tiptap_p.is-editor-empty:first-child::before]:float-left
                     [&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none
                     [&_.tiptap_p.is-editor-empty:first-child::before]:h-0"
        />
      </div>
    </div>
  );
}
