"use client";

import { useState } from "react";
import {
  Play,
  ChevronDown,
  Sparkles,
  Settings2,
  Copy,
  MoreHorizontal,
  CornerDownRight,
  Clock,
  Zap,
} from "lucide-react";
import { Anthropic, OpenAI, Google, Ollama, Meta, Mistral, DeepSeek } from "@lobehub/icons";

export default function DesignLabPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-8 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Design Lab</h1>
        <p className="text-sm text-gray-400 mb-10">
          Comparing 3 block design options — each shows an AI cell and a dropdown input
        </p>

        <div className="flex flex-col gap-16">
          <OptionA />
          <hr className="border-gray-100" />
          <OptionB />
          <hr className="border-gray-100" />
          <OptionC />
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   OPTION A — Left accent line, top-left label
   ════════════════════════════════════════════════════════ */

function OptionA() {
  const [dropdownVal, setDropdownVal] = useState("Executive");

  return (
    <section>
      <div className="mb-6">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400 bg-gray-100 px-2 py-0.5">
          Option A
        </span>
        <h2 className="text-lg font-semibold text-gray-900 mt-2">Left accent line + top label</h2>
        <p className="text-sm text-gray-400">Minimal, clean. Accent color marks the cell type.</p>
      </div>

      <div className="flex flex-col gap-4">
        {/* AI Cell */}
        <div className="relative border-l-2 border-teal-500 bg-white">
          <div className="flex items-center justify-between px-4 pt-2 pb-1">
            <span className="text-[11px] font-medium text-gray-400">AI Cell 1</span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-sm">
                claude-sonnet
              </span>
              <div className="flex items-center gap-0.5 ml-1">
                <button className="relative h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 transition-colors cursor-pointer">
                  <Play className="h-3 w-3 text-teal-500 fill-teal-500/30" />
                </button>
                <button className="h-6 w-6 flex items-center justify-center rounded text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors cursor-pointer">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
          <div className="px-4 pb-3">
            <div className="bg-gray-50 rounded px-3 py-2 text-[13px] text-gray-700 font-mono">
              Summarize the selected sources for {"{{audience}}"} audience. Include a confidence score for each claim.
            </div>
          </div>
        </div>

        {/* Dropdown Input */}
        <div className="relative border-l-2 border-indigo-400 bg-white">
          <div className="flex items-center justify-between px-4 pt-2 pb-1">
            <span className="text-[11px] font-medium text-gray-400">Input 2</span>
            <div className="flex items-center gap-0.5">
              <button className="h-6 w-6 flex items-center justify-center rounded text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors cursor-pointer">
                <Settings2 className="h-3 w-3" />
              </button>
              <button className="h-6 w-6 flex items-center justify-center rounded text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors cursor-pointer">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="px-4 pb-3">
            <select
              value={dropdownVal}
              onChange={(e) => setDropdownVal(e.target.value)}
              className="px-3 py-1.5 text-[13px] text-gray-800 border border-gray-200 rounded bg-white
                         outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/20
                         transition-colors cursor-pointer"
            >
              <option>Executive</option>
              <option>Technical</option>
              <option>General</option>
            </select>
            <div className="flex items-center gap-1 mt-1.5">
              <CornerDownRight className="h-2.5 w-2.5 text-gray-300" />
              <span className="text-[10px] font-mono text-indigo-400">audience</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════
   OPTION B — Hex-inspired, light border + pastel pills
   ════════════════════════════════════════════════════════ */

function OptionB() {
  const [dropdownVal, setDropdownVal] = useState("Executive");

  return (
    <section>
      <div className="mb-6">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400 bg-gray-100 px-2 py-0.5">
          Option B
        </span>
        <h2 className="text-lg font-semibold text-gray-900 mt-2">Hex-inspired — light border, pastel pills</h2>
        <p className="text-sm text-gray-400">Soft, refined. Border appears on hover. Pastel badges for type and actions.</p>
      </div>

      <div className="flex flex-col gap-3">
        {/* AI Cell */}
        <div className="group relative rounded-[4px] border border-gray-100 hover:border-gray-300
                        transition-all duration-200 bg-white">
          {/* Header bar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-teal-50 text-teal-700 px-2 py-0.5 rounded-[3px]">
                <Sparkles className="h-3 w-3" />
                <span className="text-[11px] font-medium">AI Cell</span>
              </div>
              <span className="text-[11px] text-gray-400">cell_1</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="flex items-center gap-1 bg-gray-50 text-gray-500 px-2 py-0.5 rounded-[3px]">
                <span className="text-[10px]">claude-sonnet</span>
                <ChevronDown className="h-2.5 w-2.5" />
              </div>
              {/* Dual-color play button */}
              <button className="relative h-7 w-7 flex items-center justify-center rounded-[3px]
                                 bg-teal-50 hover:bg-teal-100 transition-colors cursor-pointer group/play">
                <div className="relative">
                  <Play className="h-3.5 w-3.5 text-teal-600 fill-teal-200" />
                </div>
              </button>
              <button className="h-7 w-7 flex items-center justify-center rounded-[3px]
                                 text-gray-300 hover:text-gray-500 hover:bg-gray-50
                                 transition-colors cursor-pointer">
                <Copy className="h-3 w-3" />
              </button>
              <button className="h-7 w-7 flex items-center justify-center rounded-[3px]
                                 text-gray-300 hover:text-gray-500 hover:bg-gray-50
                                 transition-colors cursor-pointer">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {/* Content */}
          <div className="px-4 py-3">
            <div className="text-[13px] text-gray-700 font-mono leading-relaxed">
              Summarize the selected sources for {"{{"}
              <span className="text-indigo-500 bg-indigo-50 px-0.5 rounded-sm">audience</span>
              {"}}"}. Include a confidence score for each claim.
            </div>
          </div>
        </div>

        {/* Dropdown Input */}
        <div className="group relative rounded-[4px] border border-gray-100 hover:border-gray-300
                        transition-all duration-200 bg-white">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-[3px]">
                <ChevronDown className="h-3 w-3" />
                <span className="text-[11px] font-medium">Dropdown</span>
              </div>
              <span className="text-[11px] text-gray-400">input_2</span>
            </div>
            <div className="flex items-center gap-1">
              <button className="h-7 w-7 flex items-center justify-center rounded-[3px]
                                 text-gray-300 hover:text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer">
                <Settings2 className="h-3 w-3" />
              </button>
              <button className="h-7 w-7 flex items-center justify-center rounded-[3px]
                                 text-gray-300 hover:text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center gap-3">
              <select
                value={dropdownVal}
                onChange={(e) => setDropdownVal(e.target.value)}
                className="px-3 py-1.5 text-[13px] text-gray-800 border border-gray-200 rounded-[3px] bg-white
                           outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/20
                           transition-colors cursor-pointer"
              >
                <option>Executive</option>
                <option>Technical</option>
                <option>General</option>
              </select>
              <div className="flex items-center gap-1">
                <CornerDownRight className="h-2.5 w-2.5 text-gray-300" />
                <span className="text-[10px] font-mono text-indigo-400">audience</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════
   OPTION C — Monochrome tab, type dropdown, refined
   ════════════════════════════════════════════════════════ */

function OptionC() {
  const [dropdownVal, setDropdownVal] = useState("Executive");
  const [showTypePickerAI, setShowTypePickerAI] = useState(false);
  const [showTypePickerInput, setShowTypePickerInput] = useState(false);
  const [cellName, setCellName] = useState("cell_1");
  const [editingCellName, setEditingCellName] = useState(false);
  const [showOutputMenu, setShowOutputMenu] = useState(false);

  return (
    <section>
      <div className="mb-6">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400 bg-gray-100 px-2 py-0.5">
          Option C — Refined
        </span>
        <h2 className="text-lg font-semibold text-gray-900 mt-2">Monochrome tab + type dropdown</h2>
        <p className="text-sm text-gray-400">Neutral tab, type is a clickable dropdown. Clean, cohesive, ours.</p>
      </div>

      <div className="flex flex-col gap-5">
        {/* AI Cell */}
        <div className="relative group/cell">
          {/* Tab */}
          <div className="inline-flex items-center">
            <div className="relative">
              <button
                onClick={() => setShowTypePickerAI(!showTypePickerAI)}
                className="inline-flex items-center gap-1 bg-gray-800 text-gray-300
                           px-2.5 py-1.5 text-[11px] font-medium tracking-wide
                           hover:bg-gray-700 transition-colors cursor-pointer"
              >
                <span className="text-gray-100">AI Cell</span>
                <ChevronDown className="h-2.5 w-2.5 text-gray-500" />
              </button>
              {showTypePickerAI && (
                <div className="absolute left-0 top-[26px] w-40 bg-gray-800 border border-gray-700 shadow-xl z-50 py-1
                                animate-in fade-in slide-in-from-top-1 duration-100"
                     onMouseLeave={() => setShowTypePickerAI(false)}>
                  {["AI Cell", "Text", "Dropdown", "Checkbox", "Table", "JSON"].map((t) => (
                    <button key={t} className="flex w-full px-3 py-1.5 text-[12px] text-gray-300 hover:bg-gray-700 hover:text-white cursor-pointer transition-colors">
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {editingCellName ? (
              <input
                type="text"
                value={cellName}
                onChange={(e) => setCellName(e.target.value.replace(/\s+/g, "_").toLowerCase())}
                onBlur={() => setEditingCellName(false)}
                onKeyDown={(e) => e.key === "Enter" && setEditingCellName(false)}
                autoFocus
                className="bg-gray-600 text-gray-200 px-2.5 py-1.5
                           text-[11px] font-mono border-l border-gray-600 outline-none"
                style={{ width: `${Math.max(cellName.length, 4) * 7 + 24}px` }}
              />
            ) : (
              <button
                onClick={() => setEditingCellName(true)}
                className="bg-gray-700 text-gray-400 px-2.5 py-1.5
                           text-[11px] font-mono border-l border-gray-600
                           hover:text-gray-200 hover:bg-gray-600 transition-colors cursor-text"
              >
                {cellName}
              </button>
            )}
          </div>

          {/* Body */}
          <div className="border border-gray-200 border-t-0 bg-white
                          group-hover/cell:border-gray-300 transition-colors duration-200">
            {/* Toolbar — white */}
            <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-100">
              <ModelSelector />

              <div className="flex items-center gap-0.5">
                {/* Run button */}
                <button
                  className="h-7 px-2.5 flex items-center gap-1.5 hover:opacity-80 transition-all cursor-pointer"
                  style={{ backgroundColor: "#374151" }}
                >
                  <Play className="h-3 w-3 text-white fill-white" />
                  <span className="text-[10px] text-white font-medium">Run</span>
                </button>
                <button className="h-7 w-7 flex items-center justify-center
                                   text-gray-300 hover:text-gray-500 hover:bg-gray-50
                                   transition-colors cursor-pointer">
                  <Copy className="h-3 w-3" />
                </button>
                <button className="h-7 w-7 flex items-center justify-center
                                   text-gray-300 hover:text-gray-500 hover:bg-gray-50
                                   transition-colors cursor-pointer">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {/* Prompt — pastel blue-gray background */}
            <div className="px-4 py-3" style={{ backgroundColor: "#f0f4f8" }}>
              <div className="text-[13px] text-gray-700 font-mono leading-relaxed">
                Summarize the selected sources for {"{{"}
                <span className="text-teal-600 bg-teal-50/80 px-0.5 rounded-sm">audience</span>
                {"}}"}. Include a confidence score for each claim.
              </div>
            </div>

            {/* ── Output zone — white background ── */}
            <div className="border-t border-gray-200 bg-white">
              {/* Output context bar — clean, inline */}
              <div className="flex items-center justify-between px-4 py-2">
                {/* Left — referenced input pills with arrows */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <CornerDownRight className="h-3 w-3 text-gray-300" />
                    <span className="text-[11px] text-gray-500 font-medium bg-gray-100 border border-gray-200 rounded-md px-2.5 py-0.5">
                      audience
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CornerDownRight className="h-3 w-3 text-gray-300" />
                    <span className="text-[11px] text-gray-500 font-medium bg-gray-100 border border-gray-200 rounded-md px-2.5 py-0.5">
                      include_table
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CornerDownRight className="h-3 w-3 text-gray-300" />
                    <span className="text-[11px] text-gray-500 font-medium bg-gray-100 border border-gray-200 rounded-md px-2.5 py-0.5">
                      notes_1
                    </span>
                  </div>
                </div>
                {/* Right — stats + action menu, only visible on hover */}
                <div className="relative flex items-center gap-3 text-[11px] text-gray-400 opacity-0 group-hover/cell:opacity-100 transition-opacity duration-200">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>2.1s</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Zap className="h-3 w-3" />
                    <span>847</span>
                  </div>
                  <button
                    onClick={() => setShowOutputMenu(!showOutputMenu)}
                    className="flex items-center gap-0.5 hover:text-gray-600 transition-colors cursor-pointer"
                  >
                    <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${showOutputMenu ? "rotate-180" : ""}`} />
                  </button>

                  {showOutputMenu && (
                    <div
                      className="absolute right-0 top-full mt-1 w-44 bg-gray-800 border border-gray-700 shadow-xl z-50 py-1
                                 animate-in fade-in slide-in-from-top-1 duration-100"
                      onMouseLeave={() => setShowOutputMenu(false)}
                    >
                      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-gray-700 hover:text-white cursor-pointer transition-colors">
                        <Copy className="h-3 w-3" />
                        Copy output
                      </button>
                      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-gray-700 hover:text-white cursor-pointer transition-colors">
                        <Play className="h-3 w-3" />
                        Regenerate
                      </button>
                      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-gray-700 hover:text-white cursor-pointer transition-colors">
                        <Sparkles className="h-3 w-3" />
                        Make Reusable
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Text output */}
              <div className="px-4 py-3 text-[13px] text-gray-700 leading-relaxed">
                <p className="mb-3">
                  Based on the selected sources, here is an executive summary of key findings:
                </p>
                <p className="mb-3">
                  <strong>Market Position:</strong> The company maintains a strong position in the enterprise AI market,
                  with 34% year-over-year revenue growth. Three independent analysts rate the competitive moat as
                  &ldquo;strong&rdquo; with high confidence (0.89).
                </p>
                <p>
                  <strong>Key Risk:</strong> Regulatory uncertainty in the EU remains the primary downside factor.
                  Two sources flag this with moderate confidence (0.72), noting that timeline and scope remain unclear.
                </p>
              </div>

              {/* Table output */}
              <div className="px-4 pb-4">
                <table className="w-full text-[12px] border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-3 py-2 font-semibold text-gray-600 border-b border-r border-gray-200">Claim</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-600 border-b border-r border-gray-200">Sources</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-600 border-b border-gray-200">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-100">
                      <td className="px-3 py-2 text-gray-700 border-r border-gray-200">34% YoY revenue growth</td>
                      <td className="px-3 py-2 text-gray-500 border-r border-gray-200">Earnings report, Analyst note</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800 tabular-nums">0.95</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="px-3 py-2 text-gray-700 border-r border-gray-200">Strong competitive moat</td>
                      <td className="px-3 py-2 text-gray-500 border-r border-gray-200">3 analyst reports</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800 tabular-nums">0.89</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="px-3 py-2 text-gray-700 border-r border-gray-200">EU regulatory risk</td>
                      <td className="px-3 py-2 text-gray-500 border-r border-gray-200">News article, Policy brief</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800 tabular-nums">0.72</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-700 border-r border-gray-200">Enterprise AI market leader</td>
                      <td className="px-3 py-2 text-gray-500 border-r border-gray-200">Gartner report</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800 tabular-nums">0.84</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Dropdown Input */}
        <div className="relative group">
          {/* Tab */}
          <div className="inline-flex items-center">
            <div className="relative">
              <button
                onClick={() => setShowTypePickerInput(!showTypePickerInput)}
                className="inline-flex items-center gap-1 bg-gray-800 text-gray-300
                           px-2.5 py-1.5 text-[11px] font-medium tracking-wide
                           hover:bg-gray-700 transition-colors cursor-pointer"
              >
                <span className="text-gray-100">Dropdown</span>
                <ChevronDown className="h-2.5 w-2.5 text-gray-500" />
              </button>
              {showTypePickerInput && (
                <div className="absolute left-0 top-[26px] w-40 bg-gray-800 border border-gray-700 shadow-xl z-50 py-1
                                animate-in fade-in slide-in-from-top-1 duration-100"
                     onMouseLeave={() => setShowTypePickerInput(false)}>
                  {["AI Cell", "Text", "Dropdown", "Checkbox", "Table", "JSON"].map((t) => (
                    <button key={t} className="flex w-full px-3 py-1.5 text-[12px] text-gray-300 hover:bg-gray-700 hover:text-white cursor-pointer transition-colors">
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-gray-700 text-gray-400 px-2.5 py-1.5
                            text-[11px] font-mono border-l border-gray-600">
              audience
            </div>
          </div>

          {/* Body */}
          <div className="border border-gray-200 border-t-0 bg-white">
            <div className="px-4 py-3">
              <select
                value={dropdownVal}
                onChange={(e) => setDropdownVal(e.target.value)}
                className="px-3 py-1.5 text-[13px] text-gray-800 border border-gray-200 bg-white
                           outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200
                           transition-colors cursor-pointer"
              >
                <option>Executive</option>
                <option>Technical</option>
                <option>General</option>
              </select>
            </div>
          </div>
        </div>

        {/* Checkbox Input */}
        <div className="relative group">
          {/* Tab */}
          <div className="inline-flex items-center">
            <div className="relative">
              <button className="inline-flex items-center gap-1 bg-gray-800 text-gray-300
                                 px-2.5 py-1.5 text-[11px] font-medium tracking-wide
                                 hover:bg-gray-700 transition-colors cursor-pointer">
                <span className="text-gray-100">Checkbox</span>
                <ChevronDown className="h-2.5 w-2.5 text-gray-500" />
              </button>
            </div>
            <div className="bg-gray-700 text-gray-400 px-2.5 py-1.5
                            text-[11px] font-mono border-l border-gray-600">
              include_table
            </div>
          </div>

          {/* Body */}
          <div className="border border-gray-200 border-t-0 bg-white">
            <div className="px-4 py-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <div className="flex h-[18px] w-[18px] items-center justify-center border-[1.5px]
                                border-gray-800 bg-gray-800 text-white transition-all duration-200">
                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-[13px] text-gray-700">Include source table</span>
              </label>
            </div>
          </div>
        </div>

        {/* Slider Input */}
        <div className="relative group">
          <div className="inline-flex items-center">
            <div className="relative">
              <button className="inline-flex items-center gap-1 bg-gray-800 text-gray-300
                                 px-2.5 py-1.5 text-[11px] font-medium tracking-wide
                                 hover:bg-gray-700 transition-colors cursor-pointer">
                <span className="text-gray-100">Slider</span>
                <ChevronDown className="h-2.5 w-2.5 text-gray-500" />
              </button>
            </div>
            <div className="bg-gray-700 text-gray-400 px-2.5 py-1.5
                            text-[11px] font-mono border-l border-gray-600">
              confidence
            </div>
          </div>

          <div className="border border-gray-200 border-t-0 bg-white">
            <div className="px-4 py-3 flex items-center gap-3">
              <input
                type="range"
                defaultValue={80}
                min={0}
                max={100}
                className="flex-1 h-1 appearance-none bg-gray-200 cursor-pointer accent-gray-800 max-w-[200px]"
              />
              <span className="text-[13px] font-medium text-gray-800 tabular-nums w-8 text-right">80</span>
              <span className="text-[11px] text-gray-400">%</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════
   Model Selector Dropdown
   ════════════════════════════════════════════════════════ */

const MODELS = [
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", Icon: Anthropic },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic", Icon: Anthropic },
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", Icon: OpenAI },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", Icon: OpenAI },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google", Icon: Google },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "deepseek", Icon: DeepSeek },
  { id: "mistral-large", name: "Mistral Large", provider: "mistral", Icon: Mistral },
  { id: "llama-3.3-70b", name: "Llama 3.3 70B", provider: "meta", Icon: Meta },
  { id: "local-ollama", name: "Local (Ollama)", provider: "ollama", Icon: Ollama },
];

type Model = typeof MODELS[number];

function ModelSelector() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Model>(MODELS[0]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1 text-[12px] text-gray-600
                   hover:bg-gray-50 transition-colors cursor-pointer"
      >
        <selected.Icon size={16} />
        <span className="font-medium">{selected.name}</span>
        <ChevronDown className="h-2.5 w-2.5 text-gray-400" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-64 bg-white border border-gray-200 shadow-lg z-50
                     animate-in fade-in slide-in-from-top-1 duration-100"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="py-1">
            {MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => { setSelected(model); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-[12px] transition-colors cursor-pointer
                  ${selected.id === model.id
                    ? "bg-gray-50 text-gray-900"
                    : "text-gray-600 hover:bg-gray-50"
                  }`}
              >
                <model.Icon size={18} />
                <span className="font-medium">{model.name}</span>
                {selected.id === model.id && (
                  <span className="ml-auto text-teal-500 text-[10px]">●</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
