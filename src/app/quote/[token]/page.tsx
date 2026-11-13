"use client";

import { useEffect, useState, use } from "react";
import { toast } from "sonner";
import {
  Printer,
  CheckCircle2,
  MessageCircle,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Quotation, QuotationSettings } from "@/types";

export default function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<Quotation | null>(null);
  const [settings, setSettings] = useState<QuotationSettings | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [frameHeight, setFrameHeight] = useState(1100);

  useEffect(() => {
    async function loadQuote() {
      try {
        const res = await fetch(`/api/quotations/public/${token}`);
        if (!res.ok) throw new Error("Quotation not found");
        const data = await res.json();
        setQuote(data.quotation);
        setSettings(data.settings);
      } catch (err: any) {
        console.error("Failed to load quote:", err);
      } finally {
        setLoading(false);
      }
    }
    loadQuote();
  }, [token]);

  const handleAccept = async () => {
    if (!quote) return;
    setAccepting(true);
    try {
      const res = await fetch(`/api/quotations/public/${token}/accept`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to accept quotation");
      toast.success("Quotation accepted! Our team has been notified and will be in touch shortly.");
      setQuote(data.quotation);
    } catch (err: any) {
      toast.error(err.message || "Failed to accept");
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!quote || !settings) {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-white p-8 text-center shadow-sm">
        <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
        <h2 className="mt-4 text-xl font-bold text-slate-900">Quotation Not Found</h2>
        <p className="mt-2 text-sm text-slate-500">
          This quotation link may have expired or is invalid. Please contact the sender for assistance.
        </p>
      </div>
    );
  }

  const whatsappPhone = settings.company_phone?.replace(/[^0-9]/g, "") || "";
  const whatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(`Hi, I am reviewing quotation ${quote.quote_number} for ${quote.title}. I have a question:`)}`;

  return (
    <div className="mx-auto max-w-[850px] px-4">
      {/* Client Action Header Bar */}
      <div className="mb-6 flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between no-print">
        <div className="flex items-center gap-3">
          <Badge
            className={
              quote.accepted_at || quote.status === "invoiced"
                ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 font-semibold"
                : "bg-sky-500/15 text-sky-700 border-sky-500/30 font-semibold"
            }
          >
            {quote.accepted_at || quote.status === "invoiced"
              ? "ACCEPTED"
              : quote.status === "cancelled"
                ? "CANCELLED"
                : "QUOTATION"}
          </Badge>
          <span className="text-sm font-semibold text-slate-700">
            {quote.quote_number}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs font-semibold"
            onClick={() => window.open(`/api/quotations/public/${token}/document?print=1`, "_blank")}
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

          {!quote.accepted_at && (quote.status === "final" || quote.status === "draft") && (
            <Button
              size="sm"
              className="gap-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={accepting}
              onClick={handleAccept}
            >
              {accepting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Accept Quotation
            </Button>
          )}
        </div>
      </div>

      {/* The document itself: same renderer as the staff PDF. */}
      <iframe
        src={`/api/quotations/public/${token}/document`}
        title={`Quotation ${quote.quote_number}`}
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
