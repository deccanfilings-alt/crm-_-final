/**
 * Shared status badge config for broadcasts + recipients.
 *
 * One source of truth for broadcast and recipient status display config.
 */

import type { BroadcastStatus, RecipientStatus } from "@/types";

export interface StatusDisplay {
  label: string;
  classes: string;
  /**
   * Set true for statuses that should pulse in the UI to convey
   * "live / in-flight" — currently only `sending`.
   */
  pulse?: boolean;
}

export const broadcastStatusConfig: Record<BroadcastStatus, StatusDisplay> = {
  draft: {
    label: "Draft",
    classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20",
  },
  scheduled: {
    label: "Scheduled",
    classes: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  sending: {
    label: "Sending",
    classes: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    pulse: true,
  },
  sent: {
    label: "Sent",
    classes: "bg-primary/10 text-primary border-primary/20",
  },
  failed: {
    label: "Failed",
    classes: "bg-red-500/10 text-red-400 border-red-500/20",
  },
  halted: {
    label: "Halted",
    classes: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  },
  interrupted: {
    label: "Interrupted",
    classes: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  },
  paused: {
    label: "Paused",
    classes: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
};

export const recipientStatusConfig: Record<RecipientStatus, StatusDisplay> = {
  pending: {
    label: "Pending",
    classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20",
  },
  queued: {
    label: "Queued",
    classes: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  },
  retrying: {
    label: "Retrying",
    classes: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    pulse: true,
  },
  sent: {
    label: "Sent",
    classes: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  delivered: {
    label: "Delivered",
    classes: "bg-primary/10 text-primary border-primary/20",
  },
  read: {
    label: "Read",
    classes: "bg-primary/10 text-primary border-primary/20",
  },
  replied: {
    label: "Replied",
    classes: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  },
  failed: {
    label: "Failed",
    classes: "bg-red-500/10 text-red-400 border-red-500/20",
  },
  deferred: {
    label: "Deferred",
    classes: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  },
  quarantined: {
    label: "Quarantined",
    classes: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  },
};

/**
 * Tolerant lookup — callers often have a generic string status
 * coming from Supabase. Falls back to the "draft" / "pending"
 * entry so the UI never crashes on an unknown value.
 */
export function getBroadcastStatus(status: string): StatusDisplay {
  return (
    broadcastStatusConfig[status as BroadcastStatus] ??
    broadcastStatusConfig.draft
  );
}

export function getRecipientStatus(status: string): StatusDisplay {
  return (
    recipientStatusConfig[status as RecipientStatus] ??
    recipientStatusConfig.pending
  );
}
