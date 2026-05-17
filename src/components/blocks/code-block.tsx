"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Copy, Check, ChevronDown, Code2 } from "lucide-react";
import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { sql } from "@codemirror/lang-sql";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle, StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import type { Block } from "@/lib/models/types";

interface CodeBlockProps {
  block: Block;
  onUpdate: (content: Record<string, unknown>) => void;
}

const LANGUAGES = [
  { id: "javascript", label: "JavaScript", ext: () => javascript({ jsx: true, typescript: false }) },
  { id: "typescript", label: "TypeScript", ext: () => javascript({ jsx: true, typescript: true }) },
  { id: "python", label: "Python", ext: () => python() },
  { id: "json", label: "JSON", ext: () => json() },
  { id: "html", label: "HTML", ext: () => html() },
  { id: "css", label: "CSS", ext: () => css() },
  { id: "sql", label: "SQL", ext: () => sql() },
  { id: "markdown", label: "Markdown", ext: () => markdown() },
  { id: "bash", label: "Bash", ext: () => StreamLanguage.define(shell) },
  { id: "plain", label: "Plain Text", ext: null },
] as const;

type LangId = (typeof LANGUAGES)[number]["id"];

function getLangDef(id: string) {
  return LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[LANGUAGES.length - 1];
}

export function CodeBlock({ block, onUpdate }: CodeBlockProps) {
  const code = (block.content?.code as string) || "";
  const langId = (block.content?.language as string) || "javascript";
  const [copied, setCopied] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const onUpdateRef = useRef(onUpdate);
  const blockContentRef = useRef(block.content);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
    blockContentRef.current = block.content;
  }, [onUpdate, block.content]);

  const handleCopy = useCallback(() => {
    const currentCode = viewRef.current?.state.doc.toString() || code;
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [code]);

  const handleLangChange = useCallback(
    (newLang: LangId) => {
      onUpdate({ ...block.content, language: newLang });
      setShowLangMenu(false);
    },
    [block.content, onUpdate]
  );

  useEffect(() => {
    if (!showLangMenu) return;
    function handleClick(e: MouseEvent) {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setShowLangMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showLangMenu]);

  useEffect(() => {
    if (!editorRef.current) return;

    const langDef = getLangDef(langId);
    const extensions = [
      lineNumbers(),
      drawSelection(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newCode = update.state.doc.toString();
          onUpdateRef.current({ ...blockContentRef.current, code: newCode });
        }
      }),
      EditorView.theme({
        "&": { fontSize: "13px", backgroundColor: "#fafafa" },
        ".cm-content": {
          padding: "12px 0",
          fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
          caretColor: "#3b82f6",
        },
        ".cm-gutters": {
          backgroundColor: "#fafafa",
          borderRight: "1px solid #e5e7eb",
          color: "#9ca3af",
          minWidth: "40px",
        },
        ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px", fontSize: "12px" },
        ".cm-line": { padding: "0 16px" },
        ".cm-activeLine": { backgroundColor: "#f0f4ff" },
        ".cm-scroller": { overflow: "auto" },
        "&.cm-focused": { outline: "none" },
        ".cm-cursor": { borderLeftColor: "#3b82f6" },
      }),
    ];

    if (langDef.ext) {
      extensions.push(langDef.ext());
    }

    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const state = EditorState.create({
      doc: code,
      extensions,
    });

    viewRef.current = new EditorView({
      state,
      parent: editorRef.current,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [langId]);

  const currentLang = getLangDef(langId);

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <div className="relative" ref={langMenuRef}>
          <button
            onClick={() => setShowLangMenu(!showLangMenu)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium
                       text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <Code2 className="h-3.5 w-3.5 text-blue-500" />
            {currentLang.label}
            <ChevronDown className="h-3 w-3 text-gray-400" />
          </button>

          {showLangMenu && (
            <div className="absolute left-0 top-full mt-1 w-44 bg-white border border-gray-200
                            rounded-lg shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-1 duration-100">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.id}
                  onClick={() => handleLangChange(lang.id as LangId)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-[13px]
                             transition-colors cursor-pointer
                             ${lang.id === langId
                               ? "bg-blue-50 text-blue-600 font-medium"
                               : "text-gray-600 hover:bg-gray-50"
                             }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium
                     text-gray-500 hover:bg-gray-100 transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-500" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>

      <div ref={editorRef} className="overflow-auto max-h-[500px] [&_.cm-editor]:outline-none" />
    </div>
  );
}
