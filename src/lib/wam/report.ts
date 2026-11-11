// ============================================================
// WAM attendance & productivity report — pure helpers (no I/O).
// Rows come from wam_daily() / wam_productivity() (migration 073).
// All dates are India dates (YYYY-MM-DD, Asia/Kolkata).
// ============================================================

export interface WamSettings {
  /** "HH:MM" (24h), India time. */
  workday_start: string;
  grace_minutes: number;
  min_daily_minutes: number;
}

export const DEFAULT_WAM_SETTINGS: WamSettings = {
  workday_start: "10:00",
  grace_minutes: 15,
  min_daily_minutes: 480,
};

export interface WamDailyRow {
  user_id: string;
  day: string;
  first_in: string;
  last_out: string | null;
  worked_minutes: number;
  break_minutes: number;
  shifts: number;
  is_open: boolean;
}

export interface WamProductivityRow {
  user_id: string;
  messages_sent: number;
  chats_assigned: number;
  tasks_completed: number;
  tasks_overdue: number;
}

export interface WamMemberSummary {
  daysPresent: number;
  workedMinutes: number;
  breakMinutes: number;
  /** Average over days present; null when absent all range. */
  avgMinutesPerDay: number | null;
  lateDays: number;
  /** Finished days under the minimum (a day still in progress never counts). */
  shortDays: number;
}

const IST_MS = 330 * 60_000;

/** India date (YYYY-MM-DD) for an instant. */
export function istDate(d: Date = new Date()): string {
  return new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
}

/** Minutes since India midnight for an instant (0–1439). */
export function istMinuteOfDay(iso: string): number {
  const t = new Date(new Date(iso).getTime() + IST_MS);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

/** "10:00" / "10:00:00" → 600. Invalid → default start. */
export function parseHHMM(v: string | null | undefined): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(v ?? "");
  if (!m) return parseHHMM(DEFAULT_WAM_SETTINGS.workday_start);
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

/** 9:40 → "09:40"; tolerant of the DB's "HH:MM:SS". */
export function normalizeHHMM(v: string | null | undefined): string {
  const mins = parseHHMM(v);
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

export function isLate(row: Pick<WamDailyRow, "first_in">, s: WamSettings): boolean {
  return istMinuteOfDay(row.first_in) > parseHHMM(s.workday_start) + s.grace_minutes;
}

export function isShort(row: Pick<WamDailyRow, "worked_minutes" | "is_open">, s: WamSettings): boolean {
  return !row.is_open && row.worked_minutes < s.min_daily_minutes;
}

export function summarizeMember(rows: WamDailyRow[], s: WamSettings): WamMemberSummary {
  const worked = rows.reduce((n, r) => n + r.worked_minutes, 0);
  return {
    daysPresent: rows.length,
    workedMinutes: worked,
    breakMinutes: rows.reduce((n, r) => n + r.break_minutes, 0),
    avgMinutesPerDay: rows.length ? Math.round(worked / rows.length) : null,
    lateDays: rows.filter((r) => isLate(r, s)).length,
    shortDays: rows.filter((r) => isShort(r, s)).length,
  };
}

/** Output per clocked hour, 1 decimal. null when no time logged. */
export function perHour(count: number, minutes: number): number | null {
  if (minutes < 15) return null; // too little time to be meaningful
  return Math.round((count / (minutes / 60)) * 10) / 10;
}

// ------------------------------------------------------------
// Date ranges (India dates, inclusive)
// ------------------------------------------------------------
export type WamRangePreset = "today" | "yesterday" | "this_week" | "last_7" | "this_month" | "last_month" | "last_30";

export const WAM_RANGE_LABELS: Record<WamRangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_7: "Last 7 days",
  this_month: "This month",
  last_month: "Last month",
  last_30: "Last 30 days",
};

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function wamRange(preset: WamRangePreset, now: Date = new Date()): { from: string; to: string } {
  const today = istDate(now);
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
  const [y, m] = today.split("-").map(Number);
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y1 = addDays(today, -1);
      return { from: y1, to: y1 };
    }
    case "this_week":
      return { from: addDays(today, -dow), to: today };
    case "last_7":
      return { from: addDays(today, -6), to: today };
    case "this_month":
      return { from: firstOfMonth, to: today };
    case "last_month": {
      const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
      return { from: prev, to: addDays(firstOfMonth, -1) };
    }
    case "last_30":
      return { from: addDays(today, -29), to: today };
  }
}

/** Every date from..to inclusive (for timesheets that show absent days). */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isWeekend(ymd: string): boolean {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay() === 0; // Sunday off
}

// ------------------------------------------------------------
// Formatting + CSV
// ------------------------------------------------------------
export function fmtHM(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function fmtISTTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

export interface WamReportLine {
  name: string;
  email?: string | null;
  summary: WamMemberSummary;
  productivity?: WamProductivityRow;
}

export function teamReportCsv(lines: WamReportLine[]): string {
  return toCsv(
    ["Member", "Email", "Days present", "Hours worked", "Avg per day", "Break time", "Late days", "Short days", "WhatsApp replies", "Chats assigned", "Tasks completed", "Tasks overdue", "Replies per hour"],
    lines.map(({ name, email, summary: s, productivity: p }) => [
      name,
      email ?? "",
      s.daysPresent,
      (s.workedMinutes / 60).toFixed(2),
      s.avgMinutesPerDay == null ? "" : (s.avgMinutesPerDay / 60).toFixed(2),
      (s.breakMinutes / 60).toFixed(2),
      s.lateDays,
      s.shortDays,
      p?.messages_sent ?? 0,
      p?.chats_assigned ?? 0,
      p?.tasks_completed ?? 0,
      p?.tasks_overdue ?? 0,
      perHour(p?.messages_sent ?? 0, s.workedMinutes) ?? "",
    ]),
  );
}

export function timesheetCsv(days: string[], byDay: Map<string, WamDailyRow>, s: WamSettings): string {
  return toCsv(
    ["Date", "Clock in", "Clock out", "Hours worked", "Break (min)", "Late", "Short day", "Status"],
    days.map((d) => {
      const r = byDay.get(d);
      if (!r) return [d, "", "", "0.00", 0, "", "", isWeekend(d) ? "Weekend" : "Absent"];
      return [
        d,
        fmtISTTime(r.first_in),
        r.is_open ? "" : fmtISTTime(r.last_out),
        (r.worked_minutes / 60).toFixed(2),
        r.break_minutes,
        isLate(r, s) ? "Yes" : "",
        isShort(r, s) ? "Yes" : "",
        r.is_open ? "Working" : "Present",
      ];
    }),
  );
}
