import { describe, expect, it } from "vitest";
import {
  computeMemberSummary,
  istDate,
  lateness,
  memberTasksToCsv,
  sortMemberTasks,
  taskBuckets,
  weeklyCompletion,
  type MemberTask,
} from "./member-summary";

const TODAY = "2026-11-10"; // Tuesday

function task(p: Partial<MemberTask> & { id: string }): MemberTask {
  return {
    title: `Task ${p.id}`,
    status: "todo",
    priority: "normal",
    target_date: TODAY,
    created_at: "2026-11-01T04:00:00Z",
    ...p,
  };
}

describe("istDate", () => {
  it("converts to the IST calendar date", () => {
    expect(istDate("2026-11-09T20:00:00Z")).toBe("2026-11-10"); // 01:30 IST next day
    expect(istDate("2026-11-09T10:00:00Z")).toBe("2026-11-09");
  });
});

describe("buckets and lateness", () => {
  it("classifies open, overdue, due today and review", () => {
    expect(taskBuckets(task({ id: "a", target_date: "2026-11-05" }), TODAY)).toEqual(["open", "overdue"]);
    expect(taskBuckets(task({ id: "b" }), TODAY)).toEqual(["open", "due_today"]);
    expect(taskBuckets(task({ id: "c", status: "review", target_date: "2026-11-20" }), TODAY)).toEqual(["open", "review"]);
    expect(taskBuckets(task({ id: "d", status: "completed" }), TODAY)).toEqual(["completed"]);
    expect(taskBuckets(task({ id: "e", status: "cancelled", target_date: "2026-11-01" }), TODAY)).toEqual(["cancelled"]);
  });

  it("measures days late (IST) and days overdue", () => {
    // completed 12 Nov 01:00 IST for an 11 Nov target → 1 day late
    expect(lateness(task({ id: "a", status: "completed", target_date: "2026-11-11", completed_at: "2026-11-11T19:30:00Z" }), TODAY)).toBe(1);
    expect(lateness(task({ id: "b", status: "completed", target_date: "2026-11-11", completed_at: "2026-11-10T05:00:00Z" }), TODAY)).toBe(0);
    expect(lateness(task({ id: "c", target_date: "2026-11-07" }), TODAY)).toBe(3);
    expect(lateness(task({ id: "d", status: "cancelled", target_date: "2026-11-01" }), TODAY)).toBe(0);
  });
});

describe("computeMemberSummary", () => {
  it("matches the task_stats definitions", () => {
    const s = computeMemberSummary(
      [
        task({ id: "1", target_date: "2026-11-03" }), // overdue
        task({ id: "2", target_date: "2026-11-08" }), // overdue
        task({ id: "3" }), // due today
        task({ id: "4", status: "review", target_date: "2026-11-12" }),
        task({ id: "5", status: "completed", target_date: "2026-11-05", completed_at: "2026-11-05T06:00:00Z" }), // on time
        task({ id: "6", status: "completed", target_date: "2026-11-05", completed_at: "2026-11-08T06:00:00Z" }), // 3 d late
        task({ id: "7", status: "cancelled" }),
      ],
      TODAY,
    );
    expect(s).toMatchObject({
      total: 7,
      open: 4,
      overdue: 2,
      dueToday: 1,
      review: 1,
      completed: 2,
      cancelled: 1,
      completedOnTime: 1,
      onTimeRate: 50,
      avgDaysLate: 1.5,
      oldestOverdue: "2026-11-03",
    });
  });

  it("returns nulls when nothing is completed", () => {
    const s = computeMemberSummary([task({ id: "1" })], TODAY);
    expect(s.onTimeRate).toBeNull();
    expect(s.avgDaysLate).toBeNull();
  });
});

describe("weeklyCompletion", () => {
  it("buckets completions by IST week, split on time vs late", () => {
    const w = weeklyCompletion(
      [
        task({ id: "1", status: "completed", target_date: "2026-11-10", completed_at: "2026-11-09T06:00:00Z" }), // this week, on time
        task({ id: "2", status: "completed", target_date: "2026-11-02", completed_at: "2026-11-04T06:00:00Z" }), // last week, late
        task({ id: "3", status: "completed", target_date: "2026-08-01", completed_at: "2026-08-01T06:00:00Z" }), // outside window
        task({ id: "4", target_date: "2026-11-01" }), // open, ignored
      ],
      TODAY,
      8,
    );
    expect(w).toHaveLength(8);
    expect(w[7]).toMatchObject({ weekStart: "2026-11-09", onTime: 1, late: 0 });
    expect(w[6]).toMatchObject({ weekStart: "2026-11-02", onTime: 0, late: 1 });
    expect(w.reduce((n, p) => n + p.onTime + p.late, 0)).toBe(2);
  });
});

describe("sortMemberTasks", () => {
  const list = [
    task({ id: "done", status: "completed", target_date: "2026-11-09", completed_at: "2026-11-09T05:00:00Z" }),
    task({ id: "future", target_date: "2026-11-15" }),
    task({ id: "today" }),
    task({ id: "od-new", target_date: "2026-11-08" }),
    task({ id: "od-old", target_date: "2026-11-01", priority: "urgent" }),
  ];
  it("puts the most overdue first by default", () => {
    expect(sortMemberTasks(list, "attention", TODAY).map((t) => t.id)).toEqual(["od-old", "od-new", "today", "future", "done"]);
  });
  it("supports newest, oldest and priority", () => {
    expect(sortMemberTasks(list, "newest", TODAY)[0].id).toBe("future");
    expect(sortMemberTasks(list, "oldest", TODAY)[0].id).toBe("od-old");
    expect(sortMemberTasks(list, "priority", TODAY)[0].id).toBe("od-old");
  });
});

describe("memberTasksToCsv", () => {
  it("quotes fields and neutralises formulas", () => {
    const csv = memberTasksToCsv([task({ id: "1", title: '=HYPERLINK("x") "quoted"', status: "completed", completed_at: "2026-11-10T05:00:00Z" })], TODAY);
    const [header, row] = csv.split("\r\n");
    expect(header).toContain('"Title"');
    expect(row.startsWith(`"'=HYPERLINK(""x"") ""quoted"""`)).toBe(true);
    expect(row).toContain('"2026-11-10"');
  });
});
