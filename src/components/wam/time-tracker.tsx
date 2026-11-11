"use client";

// ============================================================
// TimeTracker — WAM clock-in / break / clock-out widget.
//
//   <TimeTracker />          full card (dashboard, sidebar panel)
//   <TimeTrackerHeaderPill/> compact pill for the top header that
//                            opens the card in a popover
//
// Time is always computed from server timestamps (clock_in,
// break start) + a measured clock offset, never by incrementing a
// counter, so the timer can't drift and survives reloads, sleeping
// laptops and multiple tabs. All writes go through
// POST /api/wam/shift → wam_transition() (server-stamped).
// ============================================================

import { useCallback, useEffect, useState, useTransition } from "react";
import { Clock, Coffee, LogIn, LogOut, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  currentBreakMs,
  formatHMS,
  formatMinutes,
  wamStateOf,
  workedMs,
  type WamAction,
  type WamBreak,
  type WamShift,
  type WamState,
} from "@/lib/wam/time";

interface WamPayload {
  shift: WamShift | null;
  breaks: WamBreak[];
  today_minutes: number;
  server_now: string;
}

// ------------------------------------------------------------
// Data hook — shared by the card and the header pill.
// ------------------------------------------------------------
function useWamShift() {
  const [data, setData] = useState<WamPayload | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<WamAction | null>(null);
  const [offset, setOffset] = useState(0); // server time − browser time, ms

  const apply = useCallback((p: WamPayload) => {
    setOffset(new Date(p.server_now).getTime() - Date.now());
    setData(p);
    setUnavailable(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/wam/shift", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setUnavailable(body.error ?? "Time tracking unavailable");
        return;
      }
      apply(body);
    } catch {
      // network blip — keep showing last known state
    }
  }, [apply]);

  useEffect(() => {
    refresh();
    // Re-sync when the tab regains focus (another tab/device may have changed it).
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const run = useCallback(
    (action: WamAction) => {
      setPendingAction(action);
      startTransition(async () => {
        try {
          const res = await fetch("/api/wam/shift", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          });
          const body = await res.json();
          if (!res.ok) {
            toast.error(body.error ?? "Could not update your shift");
            await refresh(); // state may have changed elsewhere
            return;
          }
          apply(body);
          if (action === "clock_out" && body.today_minutes != null) {
            toast.success(`Clocked out — ${formatMinutes(body.today_minutes)} worked today`);
          }
        } catch {
          toast.error("Network error — please try again");
        }
      });
    },
    [apply, refresh],
  );

  return { data, unavailable, isPending, pendingAction, run, offset };
}

/** Re-renders every second while `enabled`; returns server-corrected now. */
function useNow(enabled: boolean, offset: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Timer callbacks only — tick immediately, then every second.
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = enabled ? window.setInterval(tick, 1000) : undefined;
    return () => {
      window.clearTimeout(first);
      if (id) window.clearInterval(id);
    };
  }, [enabled]);
  return now + offset;
}

// ------------------------------------------------------------
// Presentation
// ------------------------------------------------------------
const STATE_META: Record<WamState, { label: string; dot: string; text: string }> = {
  clocked_out: { label: "Clocked Out", dot: "bg-neutral-400", text: "text-muted-foreground" },
  working: { label: "Working", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  on_break: { label: "On Break", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
};

function StatusDot({ state, className }: { state: WamState; className?: string }) {
  const pulsing = state !== "clocked_out";
  return (
    <span className={cn("relative inline-flex size-2.5", className)}>
      {pulsing && (
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", STATE_META[state].dot)} />
      )}
      <span className={cn("relative inline-flex size-2.5 rounded-full", STATE_META[state].dot)} />
    </span>
  );
}

function ActionButton({
  onClick,
  disabled,
  pending,
  tone,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  pending: boolean;
  tone: "green" | "amber" | "red" | "indigo";
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const tones = {
    green: "bg-emerald-600 hover:bg-emerald-700 text-white",
    amber: "bg-amber-500 hover:bg-amber-600 text-white",
    red: "bg-red-600 hover:bg-red-700 text-white",
    indigo: "bg-indigo-600 hover:bg-indigo-700 text-white",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium shadow-xs transition-all active:scale-[0.98] cursor-pointer",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100",
        tones[tone],
      )}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
      {children}
    </button>
  );
}

function TrackerBody({ hook }: { hook: ReturnType<typeof useWamShift> }) {
  const { data, unavailable, isPending, pendingAction, run, offset } = hook;
  const spin = (a: WamAction) => isPending && pendingAction === a;
  const state = wamStateOf(data?.shift);
  const now = useNow(state !== "clocked_out", offset);

  if (unavailable) {
    return <p className="text-sm text-muted-foreground">{unavailable}</p>;
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  const worked = data.shift ? workedMs(data.shift, data.breaks, now) : 0;
  const onBreak = currentBreakMs(data.breaks, now);
  const todayMs = data.today_minutes * 60_000 + worked;
  const meta = STATE_META[state];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusDot state={state} />
          <span className={cn("text-sm font-semibold", meta.text)}>{meta.label}</span>
        </div>
        {data.shift && (
          <span className="text-xs text-muted-foreground">
            since{" "}
            {new Date(data.shift.clock_in).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Kolkata",
            })}
          </span>
        )}
      </div>

      <div className="rounded-lg bg-muted/50 px-4 py-3 text-center">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {state === "on_break" ? "Break time" : state === "working" ? "Time worked" : "Today"}
        </p>
        <p
          className={cn(
            "font-mono text-3xl font-semibold tabular-nums tracking-tight",
            state === "on_break" ? "text-amber-600 dark:text-amber-400" : "text-foreground",
          )}
          aria-live="off"
        >
          {state === "on_break" ? formatHMS(onBreak) : state === "working" ? formatHMS(worked) : formatHMS(todayMs)}
        </p>
        {state !== "clocked_out" && (
          <p className="mt-1 text-xs text-muted-foreground">
            {state === "on_break" ? `Worked ${formatHMS(worked)} this shift · ` : ""}
            Today {formatMinutes(Math.floor(todayMs / 60_000))}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        {state === "clocked_out" && (
          <ActionButton tone="green" icon={LogIn} onClick={() => run("clock_in")} disabled={isPending} pending={spin("clock_in")}>
            Clock In
          </ActionButton>
        )}
        {state === "working" && (
          <>
            <ActionButton tone="amber" icon={Coffee} onClick={() => run("start_break")} disabled={isPending} pending={spin("start_break")}>
              Take a Break
            </ActionButton>
            <ActionButton tone="red" icon={LogOut} onClick={() => run("clock_out")} disabled={isPending} pending={spin("clock_out")}>
              Clock Out
            </ActionButton>
          </>
        )}
        {state === "on_break" && (
          <>
            <ActionButton tone="indigo" icon={Play} onClick={() => run("resume")} disabled={isPending} pending={spin("resume")}>
              Resume Work
            </ActionButton>
            <ActionButton tone="red" icon={LogOut} onClick={() => run("clock_out")} disabled={isPending} pending={spin("clock_out")}>
              Clock Out
            </ActionButton>
          </>
        )}
      </div>
    </div>
  );
}

/** Full card widget. */
export function TimeTracker({ className }: { className?: string }) {
  const hook = useWamShift();
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 shadow-xs", className)}>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Clock className="size-4 text-muted-foreground" />
        Time Tracker
      </div>
      <TrackerBody hook={hook} />
    </div>
  );
}

/** Compact header pill: dot + live timer, click to open the full tracker. */
export function TimeTrackerHeaderPill() {
  const hook = useWamShift();
  const state = wamStateOf(hook.data?.shift);
  const now = useNow(state !== "clocked_out", hook.offset);

  // Hide entirely until the migration is applied, so nothing breaks.
  if (hook.unavailable) return null;

  const d = hook.data;
  const label =
    !d || state === "clocked_out"
      ? "Clock In"
      : state === "on_break"
        ? formatHMS(currentBreakMs(d.breaks, now))
        : formatHMS(workedMs(d.shift!, d.breaks, now));

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-xs transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring",
          state === "working" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          state === "on_break" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
          state === "clocked_out" && "border-border bg-muted text-muted-foreground hover:bg-muted/80",
        )}
        aria-label="Time tracker"
      >
        {state === "clocked_out" ? <Clock className="size-3.5" /> : <StatusDot state={state} className="size-2" />}
        <span className={cn(state !== "clocked_out" && "font-mono tabular-nums")}>{label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 p-4">
        <TrackerBody hook={hook} />
      </PopoverContent>
    </Popover>
  );
}
