"use client";

// Status badge that is also a dropdown: Unpaid / Partially paid / Paid.
// Quick manual correction — Record Payment is still the way to log a
// payment with UTR details and generate the tax invoice.

import { useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { PaymentStatus } from "@/lib/billing/payment-status";
import type { Invoice } from "@/types";

const STYLES: Record<PaymentStatus, { label: string; cls: string; dot: string }> = {
  unpaid: { label: "Unpaid", cls: "border-amber-500/30 bg-amber-500/15 text-amber-600", dot: "bg-amber-500" },
  partially_paid: { label: "Partially Paid", cls: "border-sky-500/30 bg-sky-500/15 text-sky-600", dot: "bg-sky-500" },
  paid: { label: "Paid", cls: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600", dot: "bg-emerald-500" },
};

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

interface Props {
  invoice: Invoice;
  /** Called with the updated invoice. */
  onChanged: (inv: Invoice) => void;
  /** Proforma has a tax invoice: offer "Move back to Proforma" on it instead. */
  onNeedsRevert?: (taxInvoiceId: string) => void;
  /** Show "Paid" in bold capitals (tax invoices). */
  emphasizePaid?: boolean;
}

export function PaymentStatusMenu({ invoice, onChanged, onNeedsRevert, emphasizePaid }: Props) {
  const [busy, setBusy] = useState(false);
  const [partialOpen, setPartialOpen] = useState(false);
  const [amount, setAmount] = useState("");

  const current = (["unpaid", "partially_paid", "paid"] as const).includes(invoice.status as PaymentStatus)
    ? (invoice.status as PaymentStatus)
    : "unpaid";
  const style = STYLES[current];

  const apply = async (status: PaymentStatus, paidAmount?: number) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/payment-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, paid_amount: paidAmount ?? null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.code === "has_tax_invoice" && json.tax_invoice_id && onNeedsRevert) {
          toast.info(json.error);
          onNeedsRevert(json.tax_invoice_id);
          return false;
        }
        toast.error(json.error ?? "Could not update the status");
        return false;
      }
      toast.success(`${invoice.invoice_number} marked ${STYLES[status].label.toLowerCase()}`);
      onChanged(json.invoice as Invoice);
      return true;
    } catch {
      toast.error("Network error — please try again");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const choose = (status: PaymentStatus) => {
    if (status === current && status !== "partially_paid") return;
    if (status === "partially_paid") {
      setAmount(current === "partially_paid" ? String(invoice.paid_amount ?? "") : "");
      setPartialOpen(true);
      return;
    }
    void apply(status);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer disabled:opacity-60",
            style.cls,
            emphasizePaid && current === "paid" && "font-bold uppercase",
          )}
          aria-label={`Payment status: ${style.label}. Click to change`}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {style.label}
          <ChevronDown className="h-3 w-3 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48 text-xs">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Payment status</div>
          {(Object.keys(STYLES) as PaymentStatus[]).map((s) => (
            <DropdownMenuItem key={s} onClick={() => choose(s)} className="flex items-center justify-between cursor-pointer">
              <span className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", STYLES[s].dot)} />
                {STYLES[s].label}
                {s === "partially_paid" && "…"}
              </span>
              {s === current && <Check className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <div className="px-2 py-1 text-[10px] leading-snug text-muted-foreground">
            Total {inr(Number(invoice.total_amount))}
            {Number(invoice.paid_amount) > 0 && ` · paid ${inr(Number(invoice.paid_amount))}`}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={partialOpen} onOpenChange={(o) => !busy && setPartialOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Partially paid — {invoice.invoice_number}</DialogTitle>
            <DialogDescription>Total {inr(Number(invoice.total_amount))}. How much has the client paid so far?</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`partial-${invoice.id}`}>Amount received (₹)</Label>
            <Input
              id={`partial-${invoice.id}`}
              type="number"
              min={0}
              step="0.01"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {Number(amount) > 0 && Number(amount) < Number(invoice.total_amount) && (
              <p className="text-xs text-muted-foreground">Balance due: {inr(Number(invoice.total_amount) - Number(amount))}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartialOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await apply("partially_paid", Number(amount))) setPartialOpen(false);
              }}
            >
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
