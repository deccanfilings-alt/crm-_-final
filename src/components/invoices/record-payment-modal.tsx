"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CheckCircle2, Receipt } from "lucide-react";
import type { Invoice, PaymentMethod } from "@/types";

interface RecordPaymentModalProps {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaymentRecorded: (taxInvoice?: Invoice) => void;
}

export function RecordPaymentModal({
  invoice,
  open,
  onOpenChange,
  onPaymentRecorded,
}: RecordPaymentModalProps) {
  const [loading, setLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("upi");
  const [paymentReference, setPaymentReference] = useState("");
  const [paidAmount, setPaidAmount] = useState<string>(
    invoice ? String(invoice.balance_amount || invoice.total_amount) : ""
  );
  const [paidAt, setPaidAt] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [paymentNotes, setPaymentNotes] = useState("");

  if (!invoice) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paidAmount || Number(paidAmount) <= 0) {
      toast.error("Please enter a valid payment amount");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/record-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_method: paymentMethod,
          payment_reference: paymentReference.trim(),
          paid_amount: Number(paidAmount),
          paid_at: paidAt,
          payment_notes: paymentNotes.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record payment");

      toast.success(
        invoice.invoice_type === "proforma"
          ? "Payment recorded! Tax Invoice generated with PAID stamp."
          : "Payment recorded successfully!"
      );
      onPaymentRecorded(data.taxInvoice);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to record payment");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Record Payment & Issue Tax Invoice
          </DialogTitle>
          <DialogDescription>
            Record client payment for {invoice.invoice_number}. If this is a Proforma Invoice, an official Tax Invoice (DF-TI) with a PAID stamp and UTR will be issued.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="rounded-lg border bg-slate-50 p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Client:</span>
              <span className="font-semibold text-foreground">{invoice.client_company || invoice.client_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Payable:</span>
              <span className="font-bold text-foreground">
                INR {Number(invoice.total_amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Payment Method</Label>
              <Select
                value={paymentMethod}
                onValueChange={(val) => setPaymentMethod(val as PaymentMethod)}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="upi">UPI (GPay / PhonePe / Paytm)</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer (IMPS / NEFT / RTGS)</SelectItem>
                  <SelectItem value="card">Debit / Credit Card</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Payment Date</Label>
              <Input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="h-9 text-xs"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Transaction ID / UTR Number <span className="text-muted-foreground">(Recommended)</span>
            </Label>
            <Input
              placeholder="e.g. 428910293812 or Bank Ref ID"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              className="h-9 text-xs font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Amount Received (INR)</Label>
            <Input
              type="number"
              step="0.01"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              className="h-9 text-xs font-semibold"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Payment Notes (Optional)</Label>
            <Input
              placeholder="Any remarks or bank confirmation notes"
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              className="h-9 text-xs"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
              Confirm Payment & Issue Tax Invoice
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
