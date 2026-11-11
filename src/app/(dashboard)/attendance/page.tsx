"use client";

// ============================================================
// Attendance & Productivity (WAM)
//
// Owners / Team Leaders: live board (who's working right now), team
// report for a date range (hours, late/short days, replies, chats,
// tasks, replies per hour), per-person timesheet, CSV export and the
// attendance rule.
// Everyone else: their own tracker + their own timesheet only.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Clock, Coffee, Download, Loader2, RefreshCw, Settings2, UserX, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TimeTracker } from "@/components/wam/time-tracker";
import { MemberTimesheetSheet } from "@/components/wam/member-timesheet-sheet";
import { AttendanceSettingsDialog } from "@/components/wam/attendance-settings-dialog";
import { downloadCsv, initials, memberName, type WamReportPayload } from "@/components/wam/attendance-types";
import {
  fmtHM,
  fmtISTTime,
  isLate,
  istMinuteOfDay,
  parseHHMM,
  perHour,
  summarizeMember,
  teamReportCsv,
  WAM_RANGE_LABELS,
  wamRange,
  type WamDailyRow,
  type WamRangePreset,
} from "@/lib/wam/report";

const selectCls = "h-8 rounded-md border border-input bg-background px-2 text-xs";

export default function AttendancePage() {
  const [preset, setPreset] = useState<WamRangePreset>("this_week");
  const [data, setData] = useState<WamReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async (p: WamRangePreset) => {
    const { from, to } = wamRange(p);
    setLoading(true);
    try {
      const res = await fetch(`/api/wam/report?from=${from}&to=${to}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not load attendance");
        return;
      }
      setError(null);
      setData(json);
    } catch {
      setError("Network error — please refresh");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(preset);
    // Keep the live board fresh.
    const id = window.setInterval(() => load(preset), 60_000);
    return () => window.clearInterval(id);
  }, [preset, load]);

  const rowsByUser = useMemo(() => {
    const m = new Map<string, WamDailyRow[]>();
    for (const r of data?.daily ?? []) m.set(r.user_id, [...(m.get(r.user_id) ?? []), r]);
    return m;
  }, [data]);

  const prodByUser = useMemo(() => new Map((data?.productivity ?? []).map((p) => [p.user_id, p])), [data]);

  const report = useMemo(() => {
    if (!data) return [];
    return data.members
      .map((m) => ({
        member: m,
        summary: summarizeMember(rowsByUser.get(m.user_id) ?? [], data.settings),
        productivity: prodByUser.get(m.user_id),
      }))
      .sort((a, b) => b.summary.workedMinutes - a.summary.workedMinutes || memberName(a.member).localeCompare(memberName(b.member)));
  }, [data, rowsByUser, prodByUser]);

  const selectedMember = data?.members.find((m) => m.user_id === selected) ?? null;

  const exportTeam = () => {
    if (!data) return;
    downloadCsv(
      `attendance_${data.range.from}_${data.range.to}.csv`,
      teamReportCsv(report.map((r) => ({ name: memberName(r.member), email: r.member.email, summary: r.summary, productivity: r.productivity }))),
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{data && !data.is_admin ? "My Attendance" : "Attendance & Productivity"}</h2>
          <p className="text-sm text-muted-foreground">
            {data
              ? `Office starts ${data.settings.workday_start} (+${data.settings.grace_minutes}m grace) · minimum ${fmtHM(data.settings.min_daily_minutes)} a day · India time`
              : "Clock-in hours and work output"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={selectCls} value={preset} onChange={(e) => setPreset(e.target.value as WamRangePreset)} aria-label="Date range">
            {(Object.keys(WAM_RANGE_LABELS) as WamRangePreset[]).map((p) => (
              <option key={p} value={p}>
                {WAM_RANGE_LABELS[p]}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => load(preset)} disabled={loading} aria-label="Refresh">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
          {data?.is_admin && (
            <>
              <Button size="sm" variant="outline" onClick={exportTeam} disabled={!report.length}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
                <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Rule
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">{error}</div>}

      {!data && !error && (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading attendance…
        </div>
      )}

      {data && (
        <>
          {data.is_admin ? <LiveBoard data={data} onSelect={setSelected} /> : <TimeTracker className="max-w-sm" />}

          <section className="rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-semibold">
                {data.is_admin ? "Team report" : "My report"} · {WAM_RANGE_LABELS[preset]}
              </h3>
              <span className="text-xs text-muted-foreground">
                {data.range.from === data.range.to ? data.range.from : `${data.range.from} → ${data.range.to}`}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Member</th>
                    <th className="px-3 py-2 text-right font-medium">Days</th>
                    <th className="px-3 py-2 text-right font-medium">Hours</th>
                    <th className="px-3 py-2 text-right font-medium">Avg / day</th>
                    <th className="px-3 py-2 text-right font-medium">Late</th>
                    <th className="px-3 py-2 text-right font-medium">Short</th>
                    <th className="px-3 py-2 text-right font-medium" title="WhatsApp replies sent">Replies</th>
                    <th className="px-3 py-2 text-right font-medium" title="Chats assigned in range">Chats</th>
                    <th className="px-3 py-2 text-right font-medium" title="Action items completed in range">Tasks done</th>
                    <th className="px-3 py-2 text-right font-medium" title="Action items overdue right now">Overdue</th>
                    <th className="px-3 py-2 text-right font-medium" title="Replies per clocked hour">Replies / hr</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {report.map(({ member, summary: s, productivity: p }) => {
                    const name = memberName(member);
                    const rate = perHour(p?.messages_sent ?? 0, s.workedMinutes);
                    return (
                      <tr
                        key={member.user_id}
                        className="cursor-pointer border-t transition-colors hover:bg-muted/40"
                        onClick={() => setSelected(member.user_id)}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="h-7 w-7">
                              {member.avatar_url && <AvatarImage src={member.avatar_url} />}
                              <AvatarFallback className="text-[10px]">{initials(name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="truncate font-medium">{name}</div>
                              {member.team && <div className="truncate text-[11px] capitalize text-muted-foreground">{member.team}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{s.daysPresent}</td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums whitespace-nowrap">{fmtHM(s.workedMinutes)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtHM(s.avgMinutesPerDay)}</td>
                        <td className={cn("px-3 py-2.5 text-right tabular-nums", s.lateDays > 0 && "text-amber-600 dark:text-amber-400")}>{s.lateDays}</td>
                        <td className={cn("px-3 py-2.5 text-right tabular-nums", s.shortDays > 0 && "text-destructive")}>{s.shortDays}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{p?.messages_sent ?? 0}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{p?.chats_assigned ?? 0}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{p?.tasks_completed ?? 0}</td>
                        <td className={cn("px-3 py-2.5 text-right tabular-nums", (p?.tasks_overdue ?? 0) > 0 && "text-destructive")}>{p?.tasks_overdue ?? 0}</td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums">{rate ?? "—"}</td>
                        <td className="pr-3 text-muted-foreground">
                          <ChevronRight className="h-4 w-4" />
                        </td>
                      </tr>
                    );
                  })}
                  {!report.length && (
                    <tr>
                      <td colSpan={12} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No team members found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
              Hours exclude breaks. Replies = WhatsApp messages sent by the person (internal notes excluded). Click a row for the day-by-day timesheet.
            </p>
          </section>

          <MemberTimesheetSheet
            member={selectedMember}
            rows={selected ? (rowsByUser.get(selected) ?? []) : []}
            productivity={selected ? prodByUser.get(selected) : undefined}
            range={data.range}
            today={data.today}
            settings={data.settings}
            open={!!selected}
            onOpenChange={(o) => !o && setSelected(null)}
          />

          {data.is_admin && (
            <AttendanceSettingsDialog
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              settings={data.settings}
              onSaved={(s) => setData((d) => (d ? { ...d, settings: s } : d))}
            />
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Live board — who's working right now
// ------------------------------------------------------------
function LiveBoard({ data, onSelect }: { data: WamReportPayload; onSelect: (id: string) => void }) {
  const nowMinute = istMinuteOfDay(data.server_now);
  const lateCutoff = parseHHMM(data.settings.workday_start) + data.settings.grace_minutes;
  const shiftBy = new Map(data.live.shifts.map((s) => [s.user_id, s]));
  const breakBy = new Map(data.live.breaks.map((b) => [b.user_id, b]));
  const todayBy = new Map(data.live.today.map((r) => [r.user_id, r]));
  const nowMs = new Date(data.server_now).getTime();

  const people = data.members.map((m) => {
    const shift = shiftBy.get(m.user_id);
    const today = todayBy.get(m.user_id);
    const state: "working" | "break" | "done" | "out" = shift
      ? shift.status === "paused"
        ? "break"
        : "working"
      : today
        ? "done"
        : "out";
    return { m, shift, today, state };
  });
  const count = (s: string) => people.filter((p) => p.state === s).length;
  const order = { working: 0, break: 1, done: 2, out: 3 };
  people.sort((a, b) => order[a.state] - order[b.state] || memberName(a.m).localeCompare(memberName(b.m)));

  const tiles = [
    { label: "Working now", value: count("working"), icon: Users, tone: "text-emerald-600 dark:text-emerald-400" },
    { label: "On break", value: count("break"), icon: Coffee, tone: "text-amber-600 dark:text-amber-400" },
    { label: "Done for today", value: count("done"), icon: Clock, tone: "text-foreground" },
    {
      label: nowMinute > lateCutoff ? "Not clocked in (late)" : "Not clocked in",
      value: count("out"),
      icon: UserX,
      tone: nowMinute > lateCutoff && count("out") ? "text-destructive" : "text-muted-foreground",
    },
  ];

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums", t.tone)}>{t.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {people.map(({ m, shift, today, state }) => {
          const name = memberName(m);
          const brk = breakBy.get(m.user_id);
          const late = today ? isLate(today, data.settings) : false;
          return (
            <button
              key={m.user_id}
              type="button"
              onClick={() => onSelect(m.user_id)}
              className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40 cursor-pointer"
            >
              <div className="relative">
                <Avatar className="h-9 w-9">
                  {m.avatar_url && <AvatarImage src={m.avatar_url} />}
                  <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-card",
                    state === "working" && "bg-emerald-500",
                    state === "break" && "bg-amber-500",
                    state === "done" && "bg-sky-500",
                    state === "out" && "bg-neutral-400",
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{name}</span>
                  {late && (
                    <Badge variant="outline" className="h-4 border-amber-500/40 px-1 text-[9px] text-amber-700 dark:text-amber-400">
                      Late
                    </Badge>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {state === "working" && shift && `Working since ${fmtISTTime(shift.clock_in)}`}
                  {state === "break" && brk && `On break · ${fmtHM((nowMs - new Date(brk.started_at).getTime()) / 60_000)}`}
                  {state === "done" && today && `Clocked out ${fmtISTTime(today.last_out)}`}
                  {state === "out" && "Not clocked in today"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">{today ? fmtHM(today.worked_minutes) : "—"}</div>
                <div className="text-[10px] text-muted-foreground">today</div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
