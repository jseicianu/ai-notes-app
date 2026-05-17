"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Clock,
  Play,
  Pause,
  Trash2,
  CheckCircle2,
  XCircle,
  Calendar,
  MoreHorizontal,
  Terminal,
} from "lucide-react";
import type { Schedule } from "@/lib/models/types";

interface SchedulesListProps {
  workspaceId: string;
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 0) {
    const futureMins = Math.abs(mins);
    if (futureMins < 60) return `in ${futureMins}m`;
    const hours = Math.floor(futureMins / 60);
    if (hours < 24) return `in ${hours}h`;
    const days = Math.floor(hours / 24);
    return `in ${days}d`;
  }
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function describeCronShort(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [, , dom, , dow] = parts;
  if (dow === "*" && dom === "*") return "Daily";
  if (dow === "1-5") return "Weekdays";
  if (dow === "1") return "Weekly (Mon)";
  if (dow === "5") return "Weekly (Fri)";
  if (dom !== "*") return "Monthly";
  return cron;
}

export function SchedulesList({ workspaceId }: SchedulesListProps) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/schedules?workspaceId=${workspaceId}`
      );
      if (res.ok) {
        const data = await res.json();
        setSchedules(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void fetchSchedules();
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSchedules]);

  const toggleActive = useCallback(
    async (schedule: Schedule) => {
      const newActive = !schedule.is_active;
      setSchedules((prev) =>
        prev.map((s) =>
          s.id === schedule.id ? { ...s, is_active: newActive } : s
        )
      );
      const res = await fetch(`/api/schedules/${schedule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: newActive }),
      });
      if (!res.ok) {
        setSchedules((prev) =>
          prev.map((s) =>
            s.id === schedule.id ? { ...s, is_active: schedule.is_active } : s
          )
        );
      }
    },
    []
  );

  const deleteSchedule = useCallback(
    async (id: string) => {
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      setMenuOpenId(null);
      const previous = schedules;
      const res = await fetch(`/api/schedules/${id}`, { method: "DELETE" });
      if (!res.ok) setSchedules(previous);
    },
    [schedules]
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[13px] text-gray-400">Loading schedules...</p>
      </div>
    );
  }

  if (schedules.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center mb-3">
          <Clock className="h-6 w-6 text-blue-400" />
        </div>
        <p className="text-[14px] font-medium text-gray-700 mb-1">
          No schedules yet
        </p>
        <p className="text-[13px] text-gray-400 text-center max-w-[240px]">
          Schedule a command from any AI cell or command block to run it automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-3 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Active Schedules
        </span>
      </div>

      <div className="px-2 space-y-1">
        {schedules.map((schedule) => {
          const isActive = schedule.is_active;
          const lastStatus = schedule.last_run_status;

          return (
            <div
              key={schedule.id}
              className={`relative px-3 py-2.5 rounded-lg border transition-all
                ${
                  isActive
                    ? "border-gray-200 bg-white"
                    : "border-gray-100 bg-gray-50 opacity-60"
                }`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0 mt-0.5
                    ${isActive ? "bg-blue-50" : "bg-gray-100"}`}
                >
                  <Terminal
                    className={`h-3.5 w-3.5 ${
                      isActive ? "text-blue-500" : "text-gray-400"
                    }`}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-gray-900 truncate">
                      {schedule.name.split(" — ")[0]}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0
                        ${
                          isActive
                            ? "bg-green-50 text-green-600"
                            : "bg-gray-100 text-gray-400"
                        }`}
                    >
                      {isActive ? "Active" : "Paused"}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-[11px] text-gray-400">
                      <Calendar className="h-3 w-3" />
                      {describeCronShort(schedule.cron_expression)}
                    </span>
                    {schedule.next_run_at && isActive && (
                      <span className="flex items-center gap-1 text-[11px] text-gray-400">
                        <Clock className="h-3 w-3" />
                        Next: {relativeTime(schedule.next_run_at)}
                      </span>
                    )}
                  </div>

                  {schedule.last_run_at && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {lastStatus === "completed" ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                      ) : lastStatus === "failed" ? (
                        <XCircle className="h-3 w-3 text-red-500" />
                      ) : null}
                      <span className="text-[11px] text-gray-400">
                        Last run {relativeTime(schedule.last_run_at)}
                        {lastStatus ? ` · ${lastStatus}` : ""}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => toggleActive(schedule)}
                    className="h-7 w-7 flex items-center justify-center rounded-md
                               text-gray-400 hover:text-gray-600 hover:bg-gray-100
                               transition-colors cursor-pointer"
                    title={isActive ? "Pause" : "Resume"}
                  >
                    {isActive ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <div className="relative">
                    <button
                      onClick={() =>
                        setMenuOpenId(
                          menuOpenId === schedule.id ? null : schedule.id
                        )
                      }
                      className="h-7 w-7 flex items-center justify-center rounded-md
                                 text-gray-400 hover:text-gray-600 hover:bg-gray-100
                                 transition-colors cursor-pointer"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                    {menuOpenId === schedule.id && (
                      <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-gray-200
                                      rounded-md shadow-lg py-1 z-50">
                        <button
                          onClick={() => deleteSchedule(schedule.id)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px]
                                     text-red-500 hover:bg-red-50 cursor-pointer transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
