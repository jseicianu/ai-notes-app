"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Terminal,
  Calendar,
  Clock,
  Globe,
  FileText,
} from "lucide-react";
import type { Command, Page, Notebook, Schedule } from "@/lib/models/types";
import type { SourceReference } from "@/services/source-service";

type Frequency = "daily" | "weekly" | "monthly" | "custom";
interface ScheduleModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  command?: Command;
  commandId?: string;
  commandName?: string;
  commandSlug?: string;
  commandDescription?: string | null;
  pages: Page[];
  notebooks: Notebook[];
  currentPageId?: string;
  inputValues?: Record<string, unknown>;
  sourceRefs?: SourceReference[];
  editSchedule?: Schedule;
  onCreated?: (schedule: Schedule) => void;
}

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Australia/Sydney",
  "UTC",
];

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const h = i % 12 || 12;
  const ampm = i < 12 ? "AM" : "PM";
  return { value: i, label: `${h}:00 ${ampm}` };
});

function buildCron(
  frequency: Frequency,
  hour: number,
  subOption: string,
  customCron: string,
  monthDay: number
): string {
  if (frequency === "custom") return customCron;

  const minute = 0;

  switch (frequency) {
    case "daily":
      if (subOption === "every-weekday") return `${minute} ${hour} * * 1-5`;
      return `${minute} ${hour} * * *`;
    case "weekly":
      if (subOption === "every-weekday") return `${minute} ${hour} * * 1-5`;
      if (subOption === "every-friday") return `${minute} ${hour} * * 5`;
      return `${minute} ${hour} * * 1`;
    case "monthly":
      return `${minute} ${hour} ${monthDay} * *`;
    default:
      return `${minute} ${hour} * * *`;
  }
}

function describeCron(cron: string, timezone: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [, hour, dom, , dow] = parts;
  const h = parseInt(hour);
  const hourLabel = HOURS.find((x) => x.value === h)?.label ?? `${hour}:00`;
  const tz = timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone;

  if (dow === "*" && dom === "*") return `Runs every day at ${hourLabel} ${tz}`;
  if (dow === "1-5" && dom === "*") return `Runs every weekday at ${hourLabel} ${tz}`;
  if (dow === "1" && dom === "*") return `Runs every Monday at ${hourLabel} ${tz}`;
  if (dow === "5" && dom === "*") return `Runs every Friday at ${hourLabel} ${tz}`;
  if (dom !== "*" && dow === "*") return `Runs on day ${dom} of each month at ${hourLabel} ${tz}`;

  return `Runs on cron "${cron}" ${tz}`;
}

export function ScheduleModal({
  open,
  onClose,
  workspaceId,
  command,
  commandId,
  commandName,
  commandSlug,
  commandDescription,
  pages,
  notebooks,
  currentPageId,
  inputValues = {},
  sourceRefs = [],
  editSchedule,
  onCreated,
}: ScheduleModalProps) {
  const resolvedId = command?.id ?? commandId ?? "";
  const resolvedName = command?.name ?? commandName ?? "";
  const resolvedSlug = command?.slug ?? commandSlug ?? "";
  const resolvedDesc = command?.description ?? commandDescription ?? null;

  const [formKey, setFormKey] = useState(0);
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setFormKey((k) => k + 1);
    }
    prevOpenRef.current = open;
  }, [open]);

  if (!open) return null;

  return (
    <ScheduleModalInner
      key={formKey}
      onClose={onClose}
      workspaceId={workspaceId}
      resolvedId={resolvedId}
      resolvedName={resolvedName}
      resolvedSlug={resolvedSlug}
      resolvedDesc={resolvedDesc}
      editSchedule={editSchedule}
      currentPageId={currentPageId}
      pages={pages}
      notebooks={notebooks}
      inputValues={inputValues}
      sourceRefs={sourceRefs}
      onCreated={onCreated}
    />
  );
}

function ScheduleModalInner({
  onClose,
  workspaceId,
  resolvedId,
  resolvedName,
  resolvedSlug,
  resolvedDesc,
  editSchedule,
  currentPageId,
  pages,
  notebooks,
  inputValues,
  sourceRefs,
  onCreated,
}: {
  onClose: () => void;
  workspaceId: string;
  resolvedId: string;
  resolvedName: string;
  resolvedSlug: string;
  resolvedDesc: string | null;
  editSchedule?: Schedule;
  currentPageId?: string;
  pages: Page[];
  notebooks: Notebook[];
  inputValues: Record<string, unknown>;
  sourceRefs: SourceReference[];
  onCreated?: (schedule: Schedule) => void;
}) {
  const [frequency, setFrequency] = useState<Frequency>(editSchedule ? "custom" : "weekly");
  const [subOption, setSubOption] = useState("every-weekday");
  const [hour, setHour] = useState(9);
  const [timezone, setTimezone] = useState(
    editSchedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [targetPageId, setTargetPageId] = useState(editSchedule?.target_page_id ?? currentPageId ?? "");
  const [outputMode, setOutputMode] = useState<"append" | "replace">(
    editSchedule?.output_mode === "replace" ? "replace" : "append"
  );
  const [customCron, setCustomCron] = useState(editSchedule?.cron_expression ?? "0 9 * * 1-5");
  const [monthDay, setMonthDay] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cronExpression = useMemo(
    () => buildCron(frequency, hour, subOption, customCron, monthDay),
    [frequency, hour, subOption, customCron, monthDay]
  );

  const cronDescription = useMemo(
    () => describeCron(cronExpression, timezone),
    [cronExpression, timezone]
  );

  const allPages = useMemo(() => {
    const flat: Array<Page & { notebookName?: string }> = [];
    for (const nb of notebooks) {
      const nbPages = pages.filter(
        (p) => p.notebook_id === nb.id && !p.is_archived
      );
      for (const p of nbPages) {
        flat.push({ ...p, notebookName: nb.name });
      }
    }
    return flat;
  }, [pages, notebooks]);

  const handleCreate = useCallback(async () => {
    if (!resolvedId) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        workspaceId,
        commandId: resolvedId,
        name: `${resolvedName} — ${cronDescription}`,
        cronExpression,
        timezone,
        inputValues,
        sourceRefs,
        outputMode,
      };
      if (targetPageId) body.targetPageId = targetPageId;

      const url = editSchedule
        ? `/api/schedules/${editSchedule.id}`
        : "/api/schedules";
      const method = editSchedule ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editSchedule
            ? {
                cronExpression,
                timezone,
                targetPageId: targetPageId || null,
                name: `${resolvedName} — ${cronDescription}`,
                inputValues,
                sourceRefs,
                outputMode,
              }
            : body
        ),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create schedule");
      }

      const schedule = await res.json();
      onCreated?.(schedule);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }, [
    resolvedId,
    resolvedName,
    workspaceId,
    cronExpression,
    cronDescription,
    timezone,
    targetPageId,
    inputValues,
    sourceRefs,
    outputMode,
    editSchedule,
    onCreated,
    onClose,
  ]);

  const FREQ_OPTIONS: Array<{ value: Frequency; label: string }> = [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
    { value: "custom", label: "Custom" },
  ];

  const SUB_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
    daily: [
      { value: "every-morning", label: "Every morning" },
      { value: "every-weekday", label: "Every weekday" },
      { value: "every-evening", label: "End of day" },
    ],
    weekly: [
      { value: "every-weekday", label: "Every weekday" },
      { value: "every-monday", label: "Every Monday" },
      { value: "every-friday", label: "Every Friday" },
    ],
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />

      <div
        className="relative w-full max-w-[540px] rounded-xl bg-white shadow-2xl border border-gray-200
                   overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <h2 className="text-[17px] font-semibold text-gray-900">
            Schedule Command
          </h2>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-md
                       text-gray-400 hover:text-gray-600 hover:bg-gray-100
                       transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Command info */}
        <div className="mx-6 mb-5 flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
          <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
            <Terminal className="h-4 w-4 text-blue-600" />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-gray-900 truncate">
              /{resolvedSlug}
            </div>
            {resolvedDesc && (
              <div className="text-[12px] text-gray-500 truncate">
                {resolvedDesc}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 pb-5 space-y-5 max-h-[55vh] overflow-y-auto">
          {/* Frequency */}
          <div>
            <label className="block text-[13px] font-medium text-gray-700 mb-2">
              Frequency
            </label>
            <div className="flex gap-2">
              {FREQ_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setFrequency(opt.value);
                    if (opt.value === "daily") setSubOption("every-morning");
                    if (opt.value === "weekly") setSubOption("every-weekday");
                  }}
                  className={`flex-1 h-9 rounded-md text-[13px] font-medium border transition-all cursor-pointer
                    ${
                      frequency === opt.value
                        ? "bg-blue-500 text-white border-blue-500"
                        : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {SUB_OPTIONS[frequency] && (
              <div className="flex gap-2 mt-2.5">
                {SUB_OPTIONS[frequency].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSubOption(opt.value)}
                    className={`h-8 px-4 rounded-md text-[13px] font-medium border transition-all cursor-pointer
                      ${
                        subOption === opt.value
                          ? "bg-white text-blue-600 border-blue-300"
                          : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {frequency === "monthly" && (
              <div className="mt-2">
                <label className="text-[12px] text-gray-500 mb-1 block">
                  Day of month
                </label>
                <select
                  value={monthDay}
                  onChange={(e) => setMonthDay(parseInt(e.target.value))}
                  className="w-24 h-9 rounded-md border border-gray-200 bg-white px-3 text-[13px]
                             text-gray-700 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {frequency === "custom" && (
              <div className="mt-2">
                <label className="text-[12px] text-gray-500 mb-1 block">
                  Cron expression
                </label>
                <input
                  type="text"
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  placeholder="0 9 * * 1-5"
                  className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-[13px]
                             font-mono text-gray-700 outline-none
                             focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
                />
              </div>
            )}
          </div>

          {/* Time + Timezone */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-[13px] font-medium text-gray-700 mb-2">
                <Clock className="h-3.5 w-3.5 text-gray-400" />
                Time
              </label>
              <select
                value={hour}
                onChange={(e) => setHour(parseInt(e.target.value))}
                className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-[13px]
                           text-gray-700 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
              >
                {HOURS.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-[13px] font-medium text-gray-700 mb-2">
                <Globe className="h-3.5 w-3.5 text-gray-400" />
                Timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-[13px]
                           text-gray-700 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Target page */}
          <div>
            <label className="flex items-center gap-1.5 text-[13px] font-medium text-gray-700 mb-2">
              <FileText className="h-3.5 w-3.5 text-gray-400" />
              Target page
            </label>
            <select
              value={targetPageId}
              onChange={(e) => setTargetPageId(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-[13px]
                         text-gray-700 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
            >
              {currentPageId && <option value={currentPageId}>Current page</option>}
              {allPages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                  {p.notebookName ? ` — ${p.notebookName}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Output behavior */}
          <div>
            <label className="block text-[13px] font-medium text-gray-700 mb-2">
              Output behavior
            </label>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {(
                [
                  {
                    value: "append",
                    label: "Append new output",
                    desc: "Adds results below the latest output",
                  },
                  {
                    value: "replace",
                    label: "Replace previous output",
                    desc: "Replaces the latest output block",
                  },
                ] as const
              ).map((opt, i) => (
                <button
                  key={opt.value}
                  onClick={() => setOutputMode(opt.value)}
                  className={`flex-1 flex items-start gap-2.5 p-3 text-left transition-all cursor-pointer
                    ${i > 0 ? "border-l border-gray-200" : ""}
                    ${outputMode === opt.value ? "bg-blue-50/50" : "bg-white hover:bg-gray-50"}`}
                >
                  <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center
                    ${outputMode === opt.value ? "border-blue-500" : "border-gray-300"}`}
                  >
                    {outputMode === opt.value && (
                      <div className="h-2 w-2 rounded-full bg-blue-500" />
                    )}
                  </div>
                  <div>
                    <div className={`text-[13px] font-medium ${
                      outputMode === opt.value ? "text-blue-700" : "text-gray-700"
                    }`}>
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {opt.desc}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 border border-blue-100">
            <Calendar className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[13px] text-blue-800 leading-relaxed">
              {cronDescription}
              {targetPageId
                ? ` and ${outputMode === "append" ? "appends" : "replaces"} results to ${allPages.find((p) => p.id === targetPageId)?.title ?? "target page"}.`
                : ` and outputs to the current page.`}
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-100 text-[13px] text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-md text-[13px] font-medium text-gray-600
                       border border-gray-200 hover:bg-gray-50
                       transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !resolvedId || !targetPageId}
            className="h-9 px-5 rounded-md text-[13px] font-semibold text-white
                       bg-blue-500 hover:bg-blue-600
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors cursor-pointer"
          >
            {saving
              ? "Saving..."
              : editSchedule
                ? "Update Schedule"
                : "Create Schedule"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
