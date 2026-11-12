"use client";

// Confirm "move back a stage" for a proforma or tax invoice. Explains
// exactly what will happen before anything changes; the work itself is
// one transaction on the server (POST /api/invoices/:id/revert).

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Invoice } from "@/types";

export type RevertTarget = "quotation" | "proforma";

export interface RevertResult {
  target_type: RevertTarget;
  target_id: string;
  target_number: string;
  created: boolean;
  cancelled: string[];
  payment_removed: number;
}

interface Props {
  invoice: Invoice | null;
  to: RevertTarget;
  /** Other invoices on the page, to describe the linked proforma / tax invoice. */
  allInvoices: Invoice[];
  /** Number of the linked quotation, if known. */
  quoteNumber?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (result: RevertResult) => void;
}

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

/** Plain-language list of what the revert will do (mirrors revert_billing_document). */
export function describeRevert(inv: Invoice, to: RevertTarget, all: Invoice[], quoteNumber?: string | null): string[] {
  const active = (i: Invoice | undefined) => (i && i.status !== "cancelled" ? i : undefined);
  const isTax = inv.invoice_type === "tax_invoice";
  const proforma = isTax ? active(all.find((i) => i.id === inv.source_invoice_id)) : inv;
  const taxInvoice = isTax ? inv : active(all.find((i) => i.source_invoice_id === inv.id && i.invoice_type === "tax_invoice"));
  const lines: string[] = [];

  if (taxInvoice) lines.push(`Tax invoice ${taxInvoice.invoice_number} will be cancelled (kept for your records, not deleted).`);

  if (to === "proforma") {
    if (proforma) {
      const paid = Number(proforma.paid_amount) || 0;
      lines.push(
        `Proforma ${proforma.invoice_number} becomes unpaid again${paid > 0 ? ` — the recorded payment of ${inr(paid)} is removed` : ""}.`,
      );
    } else {
      lines.push("It was created without a proforma, so a new unpaid proforma will be created from it (new proforma number).");
    }
    lines.push("You can then edit the proforma, resend it, or record the payment again.");
    return lines;
  }

  if (proforma) {
    const paid = Number(proforma.paid_amount) || 0;
    lines.push(
      `Proforma ${proforma.invoice_number} will be cancelled${paid > 0 ? ` and its recorded payment of ${inr(paid)} no longer counts` : ""}.`,
    );
  }
  const qid = inv.quotation_id ?? proforma?.quotation_id;
  if (qid) {
    lines.push(
      `Quotation${quoteNumber ? ` ${quoteNumber}` : ""} is reopened (no longer “Accepted”) so you can edit it, resend it and convert it again.`,
    );
  } else {
    lines.push("It was created without a quotation, so a new draft quotation will be created from it (new quotation number).");
  }
  return lines;
}

export function RevertStageDialog({ invoice, to, allInvoices, quoteNumber, open, onOpenChange, onDone }: Props) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!invoice) return null;
  const label = to === "quotation" ? "Quotation" : "Proforma";
  const lines = describeRevert(invoice, to, allInvoices, quoteNumber);
  const touchesTaxInvoice =
    invoice.invoice_type === "tax_invoice" ||
    allInvoices.some((i) => i.source_invoice_id === invoice.id && i.invoice_type === "tax_invoice" && i.status !== "cancelled");

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, reason: reason.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not move it back");
        return;
      }
      const r = json.result as RevertResult;
      toast.success(
        r.created
          ? `Moved back — new ${r.target_type} ${r.target_number} created`
          : `Moved back to ${r.target_type} ${r.target_number}`,
      );
      setReason("");
      onDone(r);
      onOpenChange(false);
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-4 w-4" /> Move {invoice.invoice_number} back to {label}?
          </DialogTitle>
          <DialogDescription>This is what will happen:</DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>

        {touchesTaxInvoice && (
          <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              GST: if this tax invoice is already in a filed GST return, you should issue a credit note instead of cancelling it.
              If money was actually received, refund or adjust it with the client.
            </span>
          </div>
        )}

        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional) — e.g. Client changed the scope"
          maxLength={500}
          className="h-9 text-sm"
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep as is
          </Button>
          <Button onClick={submit} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            Move back to {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
