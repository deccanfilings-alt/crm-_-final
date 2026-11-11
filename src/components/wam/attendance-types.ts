import type { WamDailyRow, WamProductivityRow, WamSettings } from "@/lib/wam/report";

export interface WamMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string | null;
  team: string | null;
}

export interface WamReportPayload {
  is_admin: boolean;
  me: string;
  range: { from: string; to: string };
  today: string;
  settings: WamSettings;
  members: WamMember[];
  daily: WamDailyRow[];
  productivity: WamProductivityRow[];
  live: {
    shifts: Array<{ user_id: string; status: "active" | "paused"; clock_in: string }>;
    breaks: Array<{ user_id: string; started_at: string }>;
    today: WamDailyRow[];
  };
  server_now: string;
}

export function memberName(m: Pick<WamMember, "full_name" | "email"> | undefined | null): string {
  return m?.full_name || m?.email || "Team member";
}

export function initials(name: string): string {
  return name.split(" ").filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "U";
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
