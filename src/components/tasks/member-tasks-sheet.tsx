"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, subDays, startOfWeek, startOfMonth, endOfMonth, addDays } from "date-fns";
import { AlertTriangle, CheckCircle2, Circle, Clock, Download, Loader2, Search, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarChart } from "@/components/tremor/bar-chart";
import { cn } from "@/lib/utils";
import { todayIST } from "@/lib/dates";
import {
  computeMemberSummary,
  istDate,
  lateness,
  memberTasksToCsv,
  sortMemberTasks,
  taskBuckets,
  weeklyCompletion,
  type MemberSort,
  type TaskBucket,
} from "@/lib/tasks/member-summary";
import type { ActionItem } from "./types";

interface Member {
  user_id: string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  team: string | null;
  account_role: string | null;
}

type RangePreset = "all" | "this_week" | "this_month" | "last_30" | "last_90";

const RANGE_LABELS: Record<RangePreset, string> = {
  all: "All time",
  this_week: "This week",
  this_month: "This month",
  last_30: "Last 30 days",
  last_90: "Last 90 days",
};

const FILTERS: { id: "all" | TaskBucket; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "overdue", label: "Overdue" },
  { id: "due_today", label: "Due today" },
  { id: "review", label: "In review" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

const STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  high: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  urgent: "bg-destructive/10 text-destructive border-destructive/20",
};

const selectCls = "h-8 rounded-md border border-input bg-background px-2 text-xs";

function rangeFor(preset: RangePreset, today: string): { from?: string; to?: string } {
  const d = new Date(`${today}T00:00:00`);
  const fmt = (x: Date) => format(x, "yyyy-MM-dd");
  switch (preset) {
    case "this_week": {
      const mon = startOfWeek(d, { weekStartsOn: 1 });
      return { from: fmt(mon), to: fmt(addDays(mon, 6)) };
    }
    case "this_month":
      return { from: fmt(startOfMonth(d)), to: fmt(endOfMonth(d)) };
    case "last_30":
      return { from: fmt(subDays(d, 29)), to: today };
    case "last_90":
      return { from: fmt(subDays(d, 89)), to: today };
    default:
      return {};
  }
}

interface Props {
  userId: string | null;
  /** Fallback name shown while loading. */
  fallbackName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open a task in the page's TaskSheet. */
  onOpenTask: (task: ActionItem) => void;
  /** Bump to refetch (e.g. after a task was edited). */
  refreshKey?: number;
}

export function MemberTasksSheet({ userId, fallbackName, open, onOpenChange, onOpenTask, refreshKey = 0 }: Props) {
  const today = todayIST();
  const [range, setRange] = useState<RangePreset>("all");
  const [filter, setFilter] = useState<"all" | TaskBucket>("all");
  const [sort, setSort] = useState<MemberSort>("attention");
  const [q, setQ] = useState("");
  const [member, setMember] = useState<Member | null>(null);
  const [items, setItems] = useState<ActionItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);

  // Reset view state when switching to a different member.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (userId !== shownFor) {
    setShownFor(userId);
    setFilter("all");
    setQ("");
    setMember(null);
    setItems([]);
  }

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { from, to } = rangeFor(range, todayIST());
      const sp = new URLSearchParams();
      if (from) sp.set("from", from);
      if (to) sp.set("to", to);
      const res = await fetch(`/api/action-items/member/${userId}?${sp.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not load action items");
      setMember(data.member);
      setItems(data.items ?? []);
      setTruncated(Boolean(data.truncated));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load action items");
    } finally {
      setLoading(false);
    }
  }, [userId, range]);

  useEffect(() => {
    if (open) void load();
  }, [open, load, refreshKey]);

  const summary = useMemo(() => computeMemberSummary(items, today), [items, today]);
  const weekly = useMemo(
    () =>
      weeklyCompletion(items, today, 8).map((w) => ({
        week: w.label,
        "On time": w.onTime,
        Late: w.late,
      })),
    [items, today],
  );
  const hasWeekly = weekly.some((w) => w["On time"] + w.Late > 0);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const t of items) for (const b of taskBuckets(t, today)) c[b] = (c[b] ?? 0) + 1;
    return c;
  }, [items, today]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = items.filter((t) => {
      if (filter !== "all" && !taskBuckets(t, today).includes(filter)) return false;
      if (needle && !t.title.toLowerCase().includes(needle) && !(t.description ?? "").toLowerCase().includes(needle)) return false;
      return true;
    });
    return sortMemberTasks(filtered, sort, today);
  }, [items, filter, q, sort, today]);

  const exportCsv = () => {
    const csv = memberTasksToCsv(visible, today);
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const name = (member?.full_name || fallbackName || "member").replace(/[^\w-]+/g, "_");
    a.href = url;
    a.download = `action-items_${name}_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const name = member?.full_name || fallbackName || "Team member";
  const initials = name.split(" ").filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b p-4 pr-12">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              {member?.avatar_url && <AvatarImage src={member.avatar_url} />}
              <AvatarFallback className="text-xs">{initials || "U"}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <SheetTitle className="truncate">{name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-1.5 text-xs">
                {member?.team && <Badge variant="secondary" className="capitalize text-[10px]">{member.team}</Badge>}
                {member?.account_role && <span className="capitalize">{member.account_role}</span>}
                {member?.email && <span className="truncate">· {member.email}</span>}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-4 p-4">
          {/* Range + export */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              className={selectCls}
              value={range}
              onChange={(e) => setRange(e.target.value as RangePreset)}
              aria-label="Date range"
            >
              {(Object.keys(RANGE_LABELS) as RangePreset[]).map((r) => (
                <option key={r} value={r}>
                  {RANGE_LABELS[r]} {r !== "all" ? "(by target date)" : ""}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!visible.length}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { label: "Open", value: summary.open, tone: "" },
              {
                label: "Overdue",
                value: summary.overdue,
                tone: summary.overdue > 0 ? "text-destructive" : "",
                hint: summary.oldestOverdue ? `since ${format(new Date(`${summary.oldestOverdue}T00:00:00`), "d MMM")}` : undefined,
              },
              { label: "Completed", value: summary.completed, tone: "" },
              {
                label: "On-time",
                value: summary.onTimeRate === null ? "—" : `${summary.onTimeRate}%`,
                tone:
                  summary.onTimeRate === null
                    ? ""
                    : summary.onTimeRate >= 80
                      ? "text-emerald-600"
                      : summary.onTimeRate >= 50
                        ? "text-amber-500"
                        : "text-destructive",
              },
              { label: "Avg days late", value: summary.avgDaysLate === null ? "—" : `${summary.avgDaysLate} d`, tone: "" },
            ].map((t) => (
              <div key={t.label} className="rounded-lg border bg-card p-3">
                <div className="text-[11px] text-muted-foreground">{t.label}</div>
                <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", t.tone)}>{t.value}</div>
                {"hint" in t && t.hint && <div className="text-[10px] text-muted-foreground">{t.hint}</div>}
              </div>
            ))}
          </div>

          {/* Weekly trend */}
          <div className="rounded-lg border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold">Completed per week</span>
              <span className="text-[11px] text-muted-foreground">Last 8 weeks</span>
            </div>
            {loading && !items.length ? (
              <div className="flex h-[140px] items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : hasWeekly ? (
              <BarChart
                data={weekly}
                index="week"
                categories={["On time", "Late"]}
                colors={["emerald", "amber"]}
                type="stacked"
                yAxisWidth={28}
                allowDecimals={false}
                className="h-[140px]"
              />
            ) : (
              <div className="flex h-[60px] items-center justify-center text-xs text-muted-foreground">
                No tasks completed in the last 8 weeks{range !== "all" ? " within this range" : ""}.
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    filter === f.id ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
                  )}
                >
                  {f.label} <span className="tabular-nums opacity-70">{counts[f.id] ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" className="h-8 pl-8 text-xs" />
              </div>
              <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as MemberSort)} aria-label="Sort">
                <option value="attention">Needs attention first</option>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="priority">Priority</option>
              </select>
            </div>
          </div>

          {truncated && (
            <p className="text-[11px] text-amber-600">
              Showing the latest 2,000 tasks. Pick a shorter date range to see older ones.
            </p>
          )}

          {/* List */}
          {loading && !items.length ? (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-xs text-muted-foreground">
              {items.length === 0 ? "No action items assigned in this range." : "No tasks match these filters."}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {visible.map((t) => {
                const buckets = taskBuckets(t, today);
                const late = lateness(t, today);
                const isOverdue = buckets.includes("overdue");
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(t)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg border bg-background p-2.5 text-left transition-colors hover:border-primary/50",
                        isOverdue && "border-destructive/40",
                        t.status === "completed" && "bg-muted/40",
                      )}
                    >
                      <span className="mt-0.5 shrink-0">
                        {t.status === "completed" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : t.status === "cancelled" ? (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        ) : isOverdue ? (
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                        ) : t.status === "review" ? (
                          <Clock className="h-4 w-4 text-violet-500" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-xs font-medium",
                            (t.status === "completed" || t.status === "cancelled") && "text-muted-foreground line-through",
                          )}
                        >
                          {t.title}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Badge variant="outline" className={cn("h-4 px-1 text-[9px] capitalize", PRIORITY_COLORS[t.priority])}>
                            {t.priority}
                          </Badge>
                          <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                            {STATUS_LABELS[t.status] ?? t.status}
                          </Badge>
                          <span>Due {format(new Date(`${t.target_date}T00:00:00`), "d MMM yyyy")}</span>
                          {t.status === "completed" && t.completed_at && (
                            <span>
                              · Done {format(new Date(`${istDate(t.completed_at)}T00:00:00`), "d MMM")}
                              {late > 0 ? (
                                <span className="text-amber-600"> ({late} d late)</span>
                              ) : (
                                <span className="text-emerald-600"> (on time)</span>
                              )}
                            </span>
                          )}
                          {isOverdue && <span className="font-medium text-destructive">· {late} d overdue</span>}
                          {t.status === "cancelled" && t.cancel_reason && <span className="truncate">· {t.cancel_reason}</span>}
                          {t.source && t.source !== "manual" && <span className="capitalize">· {t.source.replace(/_/g, " ")}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
