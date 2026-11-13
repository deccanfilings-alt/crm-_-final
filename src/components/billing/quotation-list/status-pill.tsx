"use client";

// Status pill that is also a dropdown (Draft ▾). Invoiced is set only by
// converting, so it isn't selectable and an invoiced pill is read-only.

import { useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { STATUS_META, type QStatus, type QuotationRow } from "./types";

const CHOICES: QStatus[] = ["draft", "final", "cancelled"];

export function StatusPill({ row, onChanged, readOnly }: { row: QuotationRow; onChanged: () => void; readOnly?: boolean }) {
  const [busy, setBusy] = useState(false);
  const meta = STATUS_META[row.status] ?? STATUS_META.draft;
  const pill = cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", meta.cls);

  if (row.status === "invoiced" || readOnly) return <span className={pill}>{meta.label}</span>;

  const change = async (status: QStatus) => {
    if (status === row.status) return;
    if (status === "cancelled" && !window.confirm(`Cancel ${row.quote_number}? It can't be edited or converted while cancelled.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/quotations/${row.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not change the status");
        return;
      }
      toast.success(`${row.quote_number} → ${STATUS_META[status].label}`);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={busy} className={cn(pill, "cursor-pointer hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-ring")} aria-label={`Status: ${meta.label}. Click to change`}>
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        {meta.label}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-36 text-xs">
        {CHOICES.map((s) => (
          <DropdownMenuItem key={s} onClick={() => change(s)} className="flex items-center justify-between cursor-pointer">
            {STATUS_META[s].label}
            {s === row.status && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
