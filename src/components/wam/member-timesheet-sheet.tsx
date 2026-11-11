"use client";

// Day-by-day timesheet for one person over the selected range.
// Absent days are shown too (Sundays marked as weekend).

import { useMemo } from "react";
import { Download } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  eachDay,
  fmtHM,
  fmtISTTime,
  isLate,
  isShort,
  isWeekend,
  perHour,
  summarizeMember,
  timesheetCsv,
  type WamDailyRow,
  type WamProductivityRow,
  type WamSettings,
} from "@/lib/wam/report";
import { downloadCsv, initials, memberName, type WamMember } from "./attendance-types";

interface Props {
  member: WamMember | null;
  rows: WamDailyRow[];
  productivity?: WamProductivityRow;
  range: { from: string; to: string };
  today: string;
  settings: WamSettings;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MemberTimesheetSheet({ member, rows, productivity, range, today, settings, open, onOpenChange }: Props) {
  const name = memberName(member);
  const byDay = useMemo(() => new Map(rows.map((r) => [r.day, r])), [rows]);
  // Newest first; don't list future dates.
  const days = useMemo(() => eachDay(range.from, range.to < today ? range.to : today).reverse(), [range, today]);
  const s = useMemo(() => summarizeMember(rows, settings), [rows, settings]);
  const workdays = days.filter((d) => !isWeekend(d)).length;

  const tiles = [
    { label: "Days present", value: `${s.daysPresent}${workdays ? ` / ${workdays}` : ""}` },
    { label: "Hours worked", value: fmtHM(s.workedMinutes) },
    { label: "Avg per day", value: fmtHM(s.avgMinutesPerDay) },
    { label: "Late days", value: s.lateDays, tone: s.lateDays ? "text-amber-600 dark:text-amber-400" : "" },
    { label: "Short days", value: s.shortDays, tone: s.shortDays ? "text-destructive" : "" },
    { label: "Replies sent", value: productivity?.messages_sent ?? 0 },
    { label: "Tasks done", value: productivity?.tasks_completed ?? 0 },
    { label: "Replies / hour", value: perHour(productivity?.messages_sent ?? 0, s.workedMinutes) ?? "—" },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b p-4 pr-12">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              {member?.avatar_url && <AvatarImage src={member.avatar_url} />}
              <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <SheetTitle className="truncate">{name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-1.5 text-xs">
                {member?.team && <Badge variant="secondary" className="text-[10px] capitalize">{member.team}</Badge>}
                <span>
                  Timesheet · {range.from === range.to ? range.from : `${range.from} → ${range.to}`}
                </span>
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-4 p-4">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadCsv(
                  `timesheet_${name.replace(/[^\w-]+/g, "_")}_${range.from}_${range.to}.csv`,
                  timesheetCsv([...days].reverse(), byDay, settings),
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-lg border bg-card p-3">
                <div className="text-[11px] text-muted-foreground">{t.label}</div>
                <div className={cn("text-lg font-semibold tabular-nums", t.tone)}>{t.value}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">In</th>
                  <th className="px-3 py-2 text-left font-medium">Out</th>
                  <th className="px-3 py-2 text-right font-medium">Worked</th>
                  <th className="px-3 py-2 text-right font-medium">Break</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const r = byDay.get(d);
                  const label = new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  });
                  if (!r) {
                    return (
                      <tr key={d} className="border-t text-muted-foreground">
                        <td className="px-3 py-2 whitespace-nowrap">{label}</td>
                        <td className="px-3 py-2" colSpan={4}>—</td>
                        <td className="px-3 py-2">
                          {isWeekend(d) ? (
                            <span className="text-xs">Weekend</span>
                          ) : d === today ? (
                            <span className="text-xs">Not clocked in</span>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-destructive">Absent</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  }
                  const late = isLate(r, settings);
                  const short = isShort(r, settings);
                  return (
                    <tr key={d} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">{label}</td>
                      <td className={cn("px-3 py-2 whitespace-nowrap tabular-nums", late && "text-amber-600 dark:text-amber-400")}>
                        {fmtISTTime(r.first_in)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.is_open ? "—" : fmtISTTime(r.last_out)}</td>
                      <td className={cn("px-3 py-2 text-right whitespace-nowrap tabular-nums", short && "text-destructive")}>
                        {fmtHM(r.worked_minutes)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-muted-foreground">{fmtHM(r.break_minutes)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.is_open && <Badge className="bg-emerald-600 text-[10px] text-white">Working</Badge>}
                          {late && <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-400">Late</Badge>}
                          {short && <Badge variant="outline" className="text-[10px] text-destructive">Short</Badge>}
                          {!r.is_open && !late && !short && <span className="text-xs text-muted-foreground">On time</span>}
                          {r.shifts > 1 && <span className="text-[10px] text-muted-foreground">{r.shifts} shifts</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
