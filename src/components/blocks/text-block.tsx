"use client";

import { useCallback, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Link as LinkIcon,
} from "lucide-react";
import type { Block } from "@/lib/models/types";

interface TextBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
  onEnter?: () => void;
  onBackspace?: () => void;
  autoFocus?: boolean;
}

export function TextBlock({
  block,
  onUpdate,
  onBackspace,
  autoFocus,
}: TextBlockProps) {
  const isHeading = block.type === "heading";
  const headingLevel = (block.content?.level as number) || 1;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: isHeading ? { levels: [1, 2, 3] } : false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-cell-accent underline underline-offset-2 hover:text-cell-accent-dark cursor-pointer transition-colors",
        },
      }),
      Placeholder.configure({
        placeholder: isHeading
          ? `Heading ${headingLevel}`
          : "Type something...",
      }),
    ],
    content: (block.content?.doc as string) || (block.content?.text as string) || "",
    editorProps: {
      attributes: {
        class: `outline-none w-full ${
          isHeading
            ? headingLevel === 1
              ? "text-[22px] font-semibold text-gray-900 tracking-tight leading-snug"
              : headingLevel === 2
                ? "text-[18px] font-semibold text-gray-900 tracking-tight leading-snug"
                : "text-[16px] font-medium text-gray-800 leading-snug"
            : "text-[15px] text-gray-700 leading-[1.7]"
        }`,
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Backspace" && onBackspace) {
          const { state } = editor!;
          if (state.doc.textContent.length === 0) {
            event.preventDefault();
            onBackspace();
            return true;
          }
        }

        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (isHeading) {
        onUpdate({
          text: ed.getText(),
          doc: ed.getHTML(),
          level: headingLevel,
        });
      } else {
        onUpdate({ doc: ed.getHTML() });
      }
    },
    immediatelyRender: false,
  });

  const focus = useCallback(() => {
    editor?.commands.focus("end");
  }, [editor]);

  useEffect(() => {
    if (autoFocus && editor) {
      setTimeout(() => focus(), 50);
    }
  }, [autoFocus, editor, focus]);

  const handleLink = useCallback(() => {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("URL:");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  }, [editor]);

  return (
    <div
      className={`w-full px-5 ${isHeading ? "py-3" : "py-3"}`}
      onClick={() => editor?.commands.focus()}
    >
      {editor && (
        <BubbleMenu
          editor={editor}
          className="flex items-center gap-0.5 px-1 py-0.5 bg-gray-800 rounded shadow-lg
                     border border-gray-700 animate-in fade-in duration-100 z-[100]"
        >
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            icon={Bold}
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            icon={Italic}
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive("underline")}
            icon={UnderlineIcon}
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            icon={Strikethrough}
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            active={editor.isActive("code")}
            icon={Code}
          />
          <div className="w-px h-4 bg-gray-600 mx-0.5" />
          <ToolbarButton
            onClick={handleLink}
            active={editor.isActive("link")}
            icon={LinkIcon}
          />
        </BubbleMenu>
      )}
      <EditorContent
        editor={editor}
        className="max-w-none
                   [&_p]:my-0 [&_p]:leading-relaxed
                   [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-1
                   [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-1
                   [&_li]:my-0.5
                   [&_a]:text-cell-accent [&_a]:no-underline hover:[&_a]:underline
                   [&_.tiptap_p.is-editor-empty:first-child::before]:text-gray-300
                   [&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]
                   [&_.tiptap_p.is-editor-empty:first-child::before]:float-left
                   [&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none
                   [&_.tiptap_p.is-editor-empty:first-child::before]:h-0"
      />
    </div>
  );
}

function ToolbarButton({
  onClick,
  active,
  icon: Icon,
}: {
  onClick: () => void;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-7 w-7 flex items-center justify-center rounded
                 transition-colors cursor-pointer
                 ${active
                   ? "bg-gray-600 text-white"
                   : "text-gray-400 hover:text-white hover:bg-gray-700"
                 }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
