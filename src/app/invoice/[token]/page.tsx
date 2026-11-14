"use client";

import { useEffect, useState, use } from "react";
import { toast } from "sonner";
import {
  Printer,
  MessageCircle,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Invoice, QuotationSettings } from "@/types";

export default function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [settings, setSettings] = useState<QuotationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [frameHeight, setFrameHeight] = useState(1100);

  useEffect(() => {
    async function loadInvoice() {
      try {
        const res = await fetch(`/api/invoices/public/${token}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Invoice not found");
        setInvoice(data.invoice);
        setSettings(data.settings);
      } catch (err: any) {
        toast.error(err.message || "Failed to load invoice");
      } finally {
        setLoading(false);
      }
    }
    loadInvoice();
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!invoice || !settings) {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-white p-8 text-center shadow-sm">
        <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
        <h2 className="mt-4 text-xl font-bold text-slate-900">Invoice Not Found</h2>
        <p className="mt-2 text-sm text-slate-500">
          This invoice link may have expired or is invalid. Please contact the sender for assistance.
        </p>
      </div>
    );
  }

  const isTaxInvoice = invoice.invoice_type === "tax_invoice";
  const isPaid = invoice.status === "paid";
  const docTitle = isTaxInvoice ? "TAX INVOICE" : "PROFORMA INVOICE";

  const effectiveCompanyPhone = invoice.company_phone || settings.company_phone;

  const whatsappPhone = effectiveCompanyPhone?.replace(/[^0-9]/g, "") || "";
  const whatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(`Hi, I am reviewing ${docTitle} ${invoice.invoice_number} for ${invoice.title}. I have a question:`)}`;

  return (
    <div className="mx-auto max-w-[850px] px-4 py-8">
      {/* Action Header Bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm print:hidden">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700">
            {docTitle} ({invoice.invoice_number})
          </span>
          {isPaid ? (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
              <CheckCircle2 className="h-3 w-3" /> PAID
            </span>
          ) : (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              Payment Pending
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs font-semibold"
            onClick={() => window.open(`/api/invoices/public/${token}/document?print=1`, "_blank")}
          >
            <Printer className="h-4 w-4" />
            Print / PDF
          </Button>

          {whatsappPhone && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700"
              onClick={() => window.open(whatsappUrl, "_blank")}
            >
              <MessageCircle className="h-4 w-4" />
              Chat on WhatsApp
            </Button>
          )}
        </div>
      </div>

      {/* The document itself: same renderer as the staff PDF. */}
      <iframe
        src={`/api/invoices/public/${token}/document`}
        title={`${docTitle} ${invoice.invoice_number}`}
        className="w-full rounded-xl border bg-white shadow-md"
        style={{ height: frameHeight }}
        onLoad={(e) => {
          const doc = e.currentTarget.contentDocument;
          if (doc) setFrameHeight(doc.documentElement.scrollHeight + 8);
        }}
      />
    </div>
  );
}
