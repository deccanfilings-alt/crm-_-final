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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, ArrowRight, FileText, CheckCircle2 } from "lucide-react";
import type { Quotation, Invoice } from "@/types";

interface ConvertQuoteModalProps {
  quote: Quotation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted: (invoice: Invoice) => void;
}

export function ConvertQuoteModal({
  quote,
  open,
  onOpenChange,
  onConverted,
}: ConvertQuoteModalProps) {
  const [loading, setLoading] = useState(false);
  const [invoiceType, setInvoiceType] = useState<"proforma" | "tax_invoice">("proforma");

  if (!quote) return null;

  const handleConvert = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/quotations/${quote.id}/convert-to-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_type: invoiceType,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to convert quotation");

      toast.success(
        invoiceType === "proforma"
          ? `Proforma Invoice ${data.invoice.invoice_number} created!`
          : `Tax Invoice ${data.invoice.invoice_number} generated!`
      );
      onConverted(data.invoice);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to convert");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="h-5 w-5 text-primary" />
            Convert Quotation to Invoice
          </DialogTitle>
          <DialogDescription>
            Convert {quote.quote_number} for {quote.client_company || quote.client_name}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <RadioGroup
            value={invoiceType}
            onValueChange={(val) => setInvoiceType(val as "proforma" | "tax_invoice")}
            className="space-y-3"
          >
            <div className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-slate-50 cursor-pointer">
              <RadioGroupItem value="proforma" id="proforma" className="mt-1" />
              <div className="space-y-0.5">
                <Label htmlFor="proforma" className="font-semibold text-sm cursor-pointer flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-amber-600" />
                  Proforma Invoice (Pre-Payment)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Official payment request with Bank Details & Dynamic UPI QR code. Sent to client to initiate payment.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-slate-50 cursor-pointer">
              <RadioGroupItem value="tax_invoice" id="tax_invoice" className="mt-1" />
              <div className="space-y-0.5">
                <Label htmlFor="tax_invoice" className="font-semibold text-sm cursor-pointer flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Tax Invoice (Post-Payment / Final)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Final statutory GST invoice marked with a green PAID stamp. Issued when payment has already been received.
                </p>
              </div>
            </div>
          </RadioGroup>
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
            type="button"
            size="sm"
            disabled={loading}
            onClick={handleConvert}
            className="gap-1.5"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Generate {invoiceType === "proforma" ? "Proforma Invoice" : "Tax Invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
