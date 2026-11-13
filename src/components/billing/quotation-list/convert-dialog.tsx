"use client";

// "Convert to Invoice — N of M selected": invoice type, invoice date and
// due days. One invoice per quotation.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ids: string[];
  total: number;
  onDone: () => void;
}

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export function ConvertDialog({ open, onOpenChange, ids, total, onDone }: Props) {
  const [type, setType] = useState<"proforma" | "tax_invoice">("proforma");
  const [date, setDate] = useState(todayIST());
  const [dueDays, setDueDays] = useState("7");
  const [paid, setPaid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setDate(todayIST());
      setFailures([]);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setFailures([]);
    try {
      const res = await fetch("/api/billing/quotations/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, invoice_type: type, invoice_date: date, due_days: dueDays === "" ? null : Number(dueDays), payment_received: paid }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not convert");
        return;
      }
      const label = type === "proforma" ? "proforma invoice" : "tax invoice";
      if (json.converted) {
        const nums = (json.results as Array<{ ok: boolean; invoice_number?: string }>).filter((r) => r.ok).map((r) => r.invoice_number);
        toast.success(json.converted === 1 ? `Created ${label} ${nums[0]}` : `Created ${json.converted} ${label}s`);
      }
      const errs = (json.results as Array<{ ok: boolean; error?: string }>).filter((r) => !r.ok).map((r) => r.error ?? "Failed");
      onDone();
      if (errs.length) setFailures(errs);
      else onOpenChange(false);
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert to Invoice</DialogTitle>
          <DialogDescription>
            {ids.length} of {total} selected · one invoice per quotation
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["proforma", "Proforma Invoice", "Asks for payment (bank + UPI QR)"],
              ["tax_invoice", "Tax Invoice", "Final GST invoice"],
            ] as const
          ).map(([v, title, desc]) => (
            <button
              key={v}
              type="button"
              onClick={() => setType(v)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors cursor-pointer",
                type === v ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
              )}
              aria-pressed={type === v}
            >
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-[11px] text-muted-foreground">{desc}</div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="cv-date">Invoice Date</Label>
            <Input id="cv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cv-due">Due Days</Label>
            <Input
              id="cv-due"
              type="number"
              min={0}
              value={dueDays}
              disabled={type === "tax_invoice" && paid}
              onChange={(e) => setDueDays(e.target.value)}
            />
          </div>
        </div>

        {type === "tax_invoice" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            Payment already received (mark PAID)
          </label>
        )}

        {failures.length > 0 && (
          <ul className="max-h-32 list-disc space-y-0.5 overflow-y-auto rounded-md border border-amber-500/30 bg-amber-500/10 py-2 pl-6 pr-2 text-xs">
            {failures.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {failures.length ? "Close" : "Cancel"}
          </Button>
          <Button onClick={submit} disabled={busy || !ids.length}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
