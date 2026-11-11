// ============================================================
// WAM (work attendance) — types + pure time math. No I/O, so the
// timer logic is unit-testable and shared by the API and the UI.
// ============================================================

export type WamShiftStatus = "active" | "paused" | "completed";

export interface WamShift {
  id: string;
  account_id: string;
  user_id: string;
  clock_in: string;
  clock_out: string | null;
  status: WamShiftStatus;
  /** Minutes worked, breaks excluded. Set at clock-out. */
  total_minutes: number | null;
  break_minutes: number | null;
}

export interface WamBreak {
  id: string;
  shift_id: string;
  started_at: string;
  ended_at: string | null;
}

/** What the widget shows. */
export type WamState = "clocked_out" | "working" | "on_break";

export type WamAction = "clock_in" | "start_break" | "resume" | "clock_out";

export const WAM_ACTIONS: readonly WamAction[] = ["clock_in", "start_break", "resume", "clock_out"];

export function isWamAction(v: unknown): v is WamAction {
  return typeof v === "string" && (WAM_ACTIONS as readonly string[]).includes(v);
}

export function wamStateOf(shift: Pick<WamShift, "status"> | null | undefined): WamState {
  if (!shift || shift.status === "completed") return "clocked_out";
  return shift.status === "paused" ? "on_break" : "working";
}

/** Which buttons are valid in each state — mirrors wam_transition() in SQL. */
export function allowedActions(state: WamState): WamAction[] {
  switch (state) {
    case "clocked_out":
      return ["clock_in"];
    case "working":
      return ["start_break", "clock_out"];
    case "on_break":
      return ["resume", "clock_out"];
  }
}

const ms = (iso: string) => new Date(iso).getTime();

/** Total break time in ms; an open break counts up to `nowMs`. */
export function breakMs(breaks: WamBreak[], nowMs: number): number {
  return breaks.reduce((sum, b) => {
    const end = b.ended_at ? ms(b.ended_at) : nowMs;
    return sum + Math.max(0, end - ms(b.started_at));
  }, 0);
}

/** Time worked so far (breaks excluded). */
export function workedMs(shift: Pick<WamShift, "clock_in" | "clock_out">, breaks: WamBreak[], nowMs: number): number {
  const end = shift.clock_out ? ms(shift.clock_out) : nowMs;
  return Math.max(0, end - ms(shift.clock_in) - breakMs(breaks, nowMs));
}

/** Length of the break currently in progress (0 if none). */
export function currentBreakMs(breaks: WamBreak[], nowMs: number): number {
  const open = breaks.find((b) => !b.ended_at);
  return open ? Math.max(0, nowMs - ms(open.started_at)) : 0;
}

/** 3_725_000 → "01:02:05". Hours can exceed 24. */
export function formatHMS(totalMs: number): string {
  const s = Math.max(0, Math.floor(totalMs / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 125 → "2h 5m". */
export function formatMinutes(min: number | null | undefined): string {
  const m = Math.max(0, Math.floor(min ?? 0));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

/** Midnight today in India time (IST, +05:30), as an ISO string. */
export function istDayStart(now: Date = new Date()): string {
  const IST_MS = 330 * 60_000;
  const ist = new Date(now.getTime() + IST_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_MS).toISOString();
}
