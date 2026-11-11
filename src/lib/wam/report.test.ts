import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAM_SETTINGS as S,
  eachDay,
  fmtHM,
  isLate,
  isShort,
  istDate,
  istMinuteOfDay,
  normalizeHHMM,
  perHour,
  summarizeMember,
  teamReportCsv,
  timesheetCsv,
  wamRange,
  type WamDailyRow,
} from "./report";

const row = (day: string, inIST: string, worked: number, extra: Partial<WamDailyRow> = {}): WamDailyRow => ({
  user_id: "u1",
  day,
  first_in: `${day}T${inIST}:00+05:30`,
  last_out: `${day}T19:00:00+05:30`,
  worked_minutes: worked,
  break_minutes: 30,
  shifts: 1,
  is_open: false,
  ...extra,
});

describe("India time helpers", () => {
  it("uses India dates and times", () => {
    expect(istDate(new Date("2026-11-10T19:00:00Z"))).toBe("2026-11-11"); // 00:30 IST
    expect(istMinuteOfDay("2026-11-10T04:45:00Z")).toBe(10 * 60 + 15);
    expect(normalizeHHMM("9:5")).toBe("10:00"); // invalid -> default
    expect(normalizeHHMM("09:40:00")).toBe("09:40");
  });
});

describe("late / short", () => {
  it("allows the grace period", () => {
    expect(isLate(row("2026-11-10", "10:15", 480), S)).toBe(false);
    expect(isLate(row("2026-11-10", "10:16", 480), S)).toBe(true);
    expect(isLate(row("2026-11-10", "09:00", 480), { ...S, workday_start: "09:30", grace_minutes: 0 })).toBe(false);
  });
  it("never marks a day in progress as short", () => {
    expect(isShort(row("2026-11-10", "10:00", 300), S)).toBe(true);
    expect(isShort(row("2026-11-10", "10:00", 300, { is_open: true }), S)).toBe(false);
    expect(isShort(row("2026-11-10", "10:00", 480), S)).toBe(false);
  });
});

describe("summarizeMember", () => {
  it("totals days, hours, late and short", () => {
    const s = summarizeMember([row("2026-11-09", "10:40", 260), row("2026-11-10", "09:55", 500)], S);
    expect(s).toEqual({ daysPresent: 2, workedMinutes: 760, breakMinutes: 60, avgMinutesPerDay: 380, lateDays: 1, shortDays: 1 });
  });
  it("handles no attendance", () => {
    expect(summarizeMember([], S).avgMinutesPerDay).toBeNull();
  });
});

describe("perHour", () => {
  it("divides by clocked hours", () => {
    expect(perHour(40, 480)).toBe(5);
    expect(perHour(3, 480)).toBe(0.4);
    expect(perHour(5, 10)).toBeNull();
  });
});

describe("ranges", () => {
  const now = new Date("2026-11-11T06:00:00Z"); // Wed 11 Nov IST
  it("builds India-date presets", () => {
    expect(wamRange("today", now)).toEqual({ from: "2026-11-11", to: "2026-11-11" });
    expect(wamRange("yesterday", now)).toEqual({ from: "2026-11-10", to: "2026-11-10" });
    expect(wamRange("this_week", now)).toEqual({ from: "2026-11-09", to: "2026-11-11" });
    expect(wamRange("last_7", now)).toEqual({ from: "2026-11-05", to: "2026-11-11" });
    expect(wamRange("this_month", now)).toEqual({ from: "2026-11-01", to: "2026-11-11" });
    expect(wamRange("last_month", now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(wamRange("last_month", new Date("2026-01-15T06:00:00Z"))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
  it("lists every day", () => {
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("CSV", () => {
  it("exports the team report", () => {
    const csv = teamReportCsv([
      {
        name: 'Ravi "R" Kumar',
        email: "r@x.in",
        summary: summarizeMember([row("2026-11-10", "10:00", 480)], S),
        productivity: { user_id: "u1", messages_sent: 40, chats_assigned: 6, tasks_completed: 3, tasks_overdue: 1 },
      },
    ]);
    const [head, line] = csv.split("\n");
    expect(head.startsWith("Member,Email,Days present,Hours worked")).toBe(true);
    expect(line).toBe('"Ravi ""R"" Kumar",r@x.in,1,8.00,8.00,0.50,0,0,40,6,3,1,5');
  });
  it("marks absent days and Sundays in the timesheet", () => {
    const r = row("2026-11-10", "10:30", 480);
    const csv = timesheetCsv(["2026-11-08", "2026-11-09", "2026-11-10"], new Map([[r.day, r]]), S);
    const lines = csv.split("\n");
    expect(lines[1]).toContain("Weekend");
    expect(lines[2]).toContain("Absent");
    expect(lines[3]).toMatch(/^2026-11-10,10:30 am,07:00 pm,8.00,30,Yes,,Present$/i);
    expect(fmtHM(125)).toBe("2h 05m");
  });
});
