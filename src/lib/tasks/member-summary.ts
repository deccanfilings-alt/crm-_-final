// ============================================================
// Per-member action-item summary for the Team Action Items drill-down.
// Pure functions (no I/O) so the numbers are unit-testable and match
// the `task_stats` SQL function's definitions:
//   - overdue  = open (not completed/cancelled) and target_date < today (IST)
//   - on time  = completed on or before target_date (IST)
//   - days late = completed date − target_date, floored at 0
// ============================================================

import { addDays, format, startOfWeek } from "date-fns";

export interface MemberTask {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "review" | "completed" | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  target_date: string; // YYYY-MM-DD
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  source?: string;
  created_at: string;
}

export type TaskBucket = "open" | "overdue" | "due_today" | "review" | "completed" | "cancelled";

export const OPEN_STATUSES = new Set(["todo", "in_progress", "review"]);

/** IST calendar date (YYYY-MM-DD) of an ISO timestamp. */
export function istDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** Days late for a completed task (0 if on time), or days overdue for an open one. */
export function lateness(task: MemberTask, today: string): number {
  if (task.status === "completed" && task.completed_at) {
    return Math.max(0, dayDiff(istDate(task.completed_at), task.target_date));
  }
  if (OPEN_STATUSES.has(task.status)) {
    return Math.max(0, dayDiff(today, task.target_date));
  }
  return 0;
}

export function taskBuckets(task: MemberTask, today: string): TaskBucket[] {
  if (task.status === "completed") return ["completed"];
  if (task.status === "cancelled") return ["cancelled"];
  const out: TaskBucket[] = ["open"];
  if (task.target_date < today) out.push("overdue");
  if (task.target_date === today) out.push("due_today");
  if (task.status === "review") out.push("review");
  return out;
}

export interface MemberSummary {
  total: number;
  open: number;
  overdue: number;
  dueToday: number;
  review: number;
  completed: number;
  cancelled: number;
  completedOnTime: number;
  /** 0-100, or null when nothing was completed. */
  onTimeRate: number | null;
  /** Average days late across completed tasks, or null. */
  avgDaysLate: number | null;
  /** Oldest target_date among overdue tasks. */
  oldestOverdue: string | null;
}

export function computeMemberSummary(tasks: MemberTask[], today: string): MemberSummary {
  const s: MemberSummary = {
    total: tasks.length,
    open: 0,
    overdue: 0,
    dueToday: 0,
    review: 0,
    completed: 0,
    cancelled: 0,
    completedOnTime: 0,
    onTimeRate: null,
    avgDaysLate: null,
    oldestOverdue: null,
  };
  let lateSum = 0;
  for (const t of tasks) {
    for (const b of taskBuckets(t, today)) {
      if (b === "open") s.open++;
      else if (b === "overdue") {
        s.overdue++;
        if (!s.oldestOverdue || t.target_date < s.oldestOverdue) s.oldestOverdue = t.target_date;
      } else if (b === "due_today") s.dueToday++;
      else if (b === "review") s.review++;
      else if (b === "completed") s.completed++;
      else if (b === "cancelled") s.cancelled++;
    }
    if (t.status === "completed" && t.completed_at) {
      const late = lateness(t, today);
      lateSum += late;
      if (late === 0) s.completedOnTime++;
    }
  }
  if (s.completed > 0) {
    s.onTimeRate = Math.round((s.completedOnTime / s.completed) * 100);
    s.avgDaysLate = Math.round((lateSum / s.completed) * 10) / 10;
  }
  return s;
}

export interface WeekPoint {
  /** Monday of the week, YYYY-MM-DD. */
  weekStart: string;
  label: string;
  onTime: number;
  late: number;
}

/** Completed tasks per week (by completion date, IST), split on time vs late. */
export function weeklyCompletion(tasks: MemberTask[], today: string, weeks = 8): WeekPoint[] {
  const thisMonday = startOfWeek(new Date(`${today}T00:00:00`), { weekStartsOn: 1 });
  const points: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const mon = addDays(thisMonday, -7 * i);
    points.push({ weekStart: format(mon, "yyyy-MM-dd"), label: format(mon, "d MMM"), onTime: 0, late: 0 });
  }
  const first = points[0].weekStart;
  for (const t of tasks) {
    if (t.status !== "completed" || !t.completed_at) continue;
    const done = istDate(t.completed_at);
    if (done < first) continue;
    const mon = format(startOfWeek(new Date(`${done}T00:00:00`), { weekStartsOn: 1 }), "yyyy-MM-dd");
    const p = points.find((x) => x.weekStart === mon);
    if (!p) continue;
    if (lateness(t, today) === 0) p.onTime++;
    else p.late++;
  }
  return points;
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export type MemberSort = "attention" | "newest" | "oldest" | "priority";

/**
 * "attention" (default): overdue first (most overdue on top), then due
 * today, then other open by date, then completed/cancelled newest first.
 */
export function sortMemberTasks<T extends MemberTask>(tasks: T[], sort: MemberSort, today: string): T[] {
  const copy = [...tasks];
  const byDateDesc = (a: T, b: T) => b.target_date.localeCompare(a.target_date) || b.created_at.localeCompare(a.created_at);
  if (sort === "newest") return copy.sort(byDateDesc);
  if (sort === "oldest") return copy.sort((a, b) => -byDateDesc(a, b));
  if (sort === "priority") {
    return copy.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) || byDateDesc(a, b));
  }
  const rank = (t: T) => {
    if (!OPEN_STATUSES.has(t.status)) return 3;
    if (t.target_date < today) return 0;
    if (t.target_date === today) return 1;
    return 2;
  };
  return copy.sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (rank(a) === 0) return a.target_date.localeCompare(b.target_date); // most overdue first
    if (rank(a) === 2) return a.target_date.localeCompare(b.target_date); // soonest first
    return byDateDesc(a, b);
  });
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function memberTasksToCsv(tasks: MemberTask[], today: string): string {
  const header = ["Title", "Status", "Priority", "Target date", "Completed on", "Days late", "Cancel reason", "Source", "Created"];
  const rows = tasks.map((t) => [
    t.title,
    t.status,
    t.priority,
    t.target_date,
    t.completed_at ? istDate(t.completed_at) : "",
    t.status === "cancelled" ? "" : lateness(t, today),
    t.cancel_reason ?? "",
    t.source ?? "",
    istDate(t.created_at),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
