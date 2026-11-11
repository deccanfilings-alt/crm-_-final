import { describe, expect, it } from "vitest";
import {
  allowedActions,
  breakMs,
  currentBreakMs,
  formatHMS,
  formatMinutes,
  istDayStart,
  isWamAction,
  wamStateOf,
  workedMs,
  type WamBreak,
} from "./time";

const T0 = Date.parse("2026-11-11T09:00:00Z");
const iso = (minutesAfter: number) => new Date(T0 + minutesAfter * 60_000).toISOString();
const brk = (start: number, end: number | null): WamBreak => ({
  id: `b${start}`,
  shift_id: "s1",
  started_at: iso(start),
  ended_at: end === null ? null : iso(end),
});

describe("state machine", () => {
  it("maps shift status to widget state", () => {
    expect(wamStateOf(null)).toBe("clocked_out");
    expect(wamStateOf({ status: "completed" })).toBe("clocked_out");
    expect(wamStateOf({ status: "active" })).toBe("working");
    expect(wamStateOf({ status: "paused" })).toBe("on_break");
  });
  it("only offers valid actions", () => {
    expect(allowedActions("clocked_out")).toEqual(["clock_in"]);
    expect(allowedActions("working")).toEqual(["start_break", "clock_out"]);
    expect(allowedActions("on_break")).toEqual(["resume", "clock_out"]);
  });
  it("validates action names", () => {
    expect(isWamAction("clock_in")).toBe(true);
    expect(isWamAction("delete")).toBe(false);
    expect(isWamAction(undefined)).toBe(false);
  });
});

describe("time math", () => {
  const shift = { clock_in: iso(0), clock_out: null };
  const now = T0 + 120 * 60_000; // 2h after clock-in

  it("excludes finished and open breaks from worked time", () => {
    const breaks = [brk(30, 45), brk(100, null)]; // 15m done + 20m running
    expect(breakMs(breaks, now)).toBe(35 * 60_000);
    expect(workedMs(shift, breaks, now)).toBe(85 * 60_000);
    expect(currentBreakMs(breaks, now)).toBe(20 * 60_000);
  });
  it("freezes at clock-out", () => {
    const done = { clock_in: iso(0), clock_out: iso(60) };
    expect(workedMs(done, [brk(10, 20)], now)).toBe(50 * 60_000);
  });
  it("never goes negative (client clock behind server)", () => {
    expect(workedMs(shift, [], T0 - 5000)).toBe(0);
    expect(currentBreakMs([brk(0, null)], T0 - 5000)).toBe(0);
  });
  it("formats", () => {
    expect(formatHMS(3_725_000)).toBe("01:02:05");
    expect(formatHMS(26 * 3600_000)).toBe("26:00:00");
    expect(formatHMS(-1)).toBe("00:00:00");
    expect(formatMinutes(125)).toBe("2h 5m");
    expect(formatMinutes(9)).toBe("9m");
    expect(formatMinutes(null)).toBe("0m");
  });
});

describe("istDayStart", () => {
  it("returns India midnight in UTC", () => {
    // 11 Nov 02:00 IST = 10 Nov 20:30 UTC -> day starts 10 Nov 18:30 UTC
    expect(istDayStart(new Date("2026-11-10T20:30:00Z"))).toBe("2026-11-10T18:30:00.000Z");
    // 11 Nov 23:00 IST
    expect(istDayStart(new Date("2026-11-11T17:30:00Z"))).toBe("2026-11-10T18:30:00.000Z");
  });
});
