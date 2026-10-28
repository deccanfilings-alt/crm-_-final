"use client";

import { useEffect, useState, use } from "react";
import { toast } from "sonner";
import {
  Printer,
  CheckCircle2,
  MessageCircle,
  Loader2,
  Building2,
  AlertCircle,
  Download,
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

  const currencyCode = quote.currency || "INR";
  const currencySymbol = currencyCode === "INR" ? "INR" : currencyCode;
  const items = quote.items || [];

  const cgstAmount = Math.round(((quote.tax_amount || 0) / 2 + Number.EPSILON) * 100) / 100;
  const sgstAmount = Math.round(((quote.tax_amount || 0) - cgstAmount + Number.EPSILON) * 100) / 100;

  const effectiveCompanyName = quote.company_name || settings.company_name || "Company";
  const effectiveCompanyLogo = quote.company_logo_url || settings.company_logo_url;
  const effectiveCompanyAddress = quote.company_address || settings.company_address;
  const effectiveCompanyPhone = quote.company_phone || settings.company_phone;
  const effectiveCompanyEmail = quote.company_email || settings.company_email;
  const effectiveGstin = quote.gstin || settings.gstin;
  const effectivePan = quote.pan || settings.pan;
  const effectiveStamp = quote.stamp_url || settings.stamp_url;
  const effectiveSignature = quote.signature_url || settings.signature_url;

  const upiId = settings.upi_id || "";
  const upiQr = settings.upi_qr_url || (upiId ? `https://quickchart.io/qr?text=${encodeURIComponent(`upi://pay?pa=${upiId}&pn=${effectiveCompanyName}&am=${quote.total_amount}&cu=${currencyCode}`)}&size=130` : null);

  function formatDateDMY(dStr?: string | null): string {
    if (!dStr) return "";
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
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
              quote.status === "accepted"
                ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 font-semibold"
                : "bg-sky-500/15 text-sky-700 border-sky-500/30 font-semibold"
            }
          >
            {quote.status.toUpperCase()}
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
            onClick={() => window.print()}
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

          {quote.status !== "accepted" && (
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

      {/* Quotation Document - WebLedger Exact Replica */}
      <div className="rounded-xl border bg-white p-6 sm:p-10 shadow-md">
        {/* Top Header */}
        <div className="flex items-start justify-between pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-wider text-slate-900 uppercase">
              QUOTATION
            </h1>
            <div className="mt-3 text-xs space-y-1">
              <div>
                <span className="font-semibold text-slate-700 inline-block w-20">Bill No:</span>
                <span className="font-bold text-slate-900">{quote.quote_number}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-700 inline-block w-20">Bill Date:</span>
                <span className="text-slate-900">{formatDateDMY(quote.issue_date)}</span>
              </div>
            </div>
          </div>

          <div className="text-right">
            {effectiveCompanyLogo ? (
              <img
                src={effectiveCompanyLogo}
                alt={effectiveCompanyName}
                className="max-h-14 object-contain inline-block"
              />
            ) : (
              <div>
                <div className="text-base font-extrabold uppercase text-slate-900 leading-tight">
                  {effectiveCompanyName}
                </div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">
                  One Stop For All Business Solutions
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Black Solid Divider */}
        <div className="border-t-2 border-black my-4"></div>

        {/* ISSUED BY & BILLED TO */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 my-4 text-xs">
          {/* Issued By */}
          <div>
            <div className="font-bold uppercase tracking-wider text-black border-b-2 border-black pb-1 mb-2">
              ISSUED BY
            </div>
            <div className="space-y-1 leading-relaxed">
              <div><strong className="text-slate-900 inline-block w-24">Billed From:</strong> <span className="font-semibold text-slate-900">{effectiveCompanyName}</span></div>
              {effectiveCompanyAddress && (
                <div><strong className="text-slate-700 inline-block w-24 align-top">Address:</strong> <span className="text-slate-600 inline-block max-w-[240px]">{effectiveCompanyAddress}</span></div>
              )}
              {effectiveCompanyPhone && (
                <div><strong className="text-slate-700 inline-block w-24">Phone :</strong> <span className="text-slate-600">{effectiveCompanyPhone}</span></div>
              )}
              {effectiveCompanyEmail && (
                <div><strong className="text-slate-700 inline-block w-24">Email Id :</strong> <span className="text-slate-600">{effectiveCompanyEmail}</span></div>
              )}
              {effectiveGstin && (
                <div><strong className="text-slate-900 inline-block w-24">GST IN :</strong> <span className="font-semibold text-slate-900">{effectiveGstin}</span></div>
              )}
              {effectivePan && (
                <div><strong className="text-slate-900 inline-block w-24">PAN :</strong> <span className="font-semibold text-slate-900">{effectivePan}</span></div>
              )}
            </div>
          </div>

          {/* Billed To */}
          <div>
            <div className="font-bold uppercase tracking-wider text-black border-b-2 border-black pb-1 mb-2">
              BILLED TO
            </div>
            <div className="space-y-1 leading-relaxed">
              <div><strong className="text-slate-900 inline-block w-20">Billed To :</strong> <span className="font-semibold text-slate-900">{quote.client_company || quote.client_name}</span></div>
              {quote.client_phone && (
                <div><strong className="text-slate-700 inline-block w-20">Phone:</strong> <span className="text-slate-600">{quote.client_phone}</span></div>
              )}
              {quote.client_email && (
                <div><strong className="text-slate-700 inline-block w-20">Email:</strong> <span className="text-slate-600">{quote.client_email}</span></div>
              )}
              {quote.client_address && (
                <div><strong className="text-slate-700 inline-block w-20 align-top">Address:</strong> <span className="text-slate-600">{quote.client_address}</span></div>
              )}
              {quote.client_gstin && (
                <div><strong className="text-slate-900 inline-block w-20">GST IN :</strong> <span className="font-semibold text-slate-900">{quote.client_gstin}</span></div>
              )}
            </div>
          </div>
        </div>

        {/* Particulars Table with Solid Black Header */}
        <div className="overflow-x-auto my-6 border border-slate-300 rounded">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-black text-white font-bold">
                <th className="p-2.5 text-center w-12 border-r border-slate-700">Sr. No.</th>
                <th className="p-2.5 text-left w-4/12 border-r border-slate-700">Particulars</th>
                <th className="p-2.5 text-left w-3/12 border-r border-slate-700">Description</th>
                <th className="p-2.5 text-right w-2/12 border-r border-slate-700">Amount ( {currencySymbol} )</th>
                <th className="p-2.5 text-center w-20 border-r border-slate-700">GST Rate</th>
                <th className="p-2.5 text-right w-2/12">Total ( {currencySymbol} )</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.map((it, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="p-2.5 text-center text-slate-500">{idx + 1}</td>
                  <td className="p-2.5 font-semibold text-slate-900">{it.title}</td>
                  <td className="p-2.5 text-slate-600">{it.description || "-"}</td>
                  <td className="p-2.5 text-right text-slate-800">
                    {currencySymbol} {(it.unit_price * it.quantity).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="p-2.5 text-center text-slate-700">
                    {quote.tax_type === "none" ? "0 %" : `${it.tax_rate || quote.tax_rate || 18} %`}
                  </td>
                  <td className="p-2.5 text-right font-bold text-slate-900">
                    {currencySymbol} {it.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Payment QR / Bank on Left & Totals Box on Right */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 my-6 items-start">
          {/* Left: Payment Box */}
          <div className="sm:col-span-7 flex gap-4 p-3 border rounded border-slate-200 bg-slate-50/50">
            {upiQr && (
              <div className="shrink-0 text-center">
                <img
                  src={upiQr}
                  alt="UPI QR"
                  className="h-28 w-28 rounded border border-slate-200 p-1 bg-white"
                />
                {upiId && (
                  <div className="mt-1 max-w-[120px] font-mono text-[9px] text-slate-500 break-all leading-tight">
                    {upiId}
                  </div>
                )}
              </div>
            )}
            <div className="text-xs space-y-1 text-slate-700">
              <div><strong className="text-slate-900">Name :</strong> {settings.bank_beneficiary_name || settings.company_name}</div>
              {settings.bank_name && <div><strong className="text-slate-900">Bank Name :</strong> {settings.bank_name},</div>}
              {settings.bank_account_no && <div><strong className="text-slate-900">Bank Account No :</strong> {settings.bank_account_no}</div>}
              {settings.bank_ifsc && <div><strong className="text-slate-900">Bank/IFSC Code :</strong> {settings.bank_ifsc}</div>}
            </div>
          </div>

          {/* Right: Totals Box */}
          <div className="sm:col-span-5 rounded border border-slate-200 bg-slate-50 p-4 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-600 font-medium">Sub-Total :</span>
              <span className="font-semibold text-slate-900">{currencySymbol} {quote.subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            </div>
            {quote.tax_amount > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-600">CGST :</span>
                  <span className="text-slate-800">{currencySymbol} {cgstAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">SGST :</span>
                  <span className="text-slate-800">{currencySymbol} {sgstAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-slate-600">Discount :</span>
              <span className="text-slate-800">{currencySymbol} {(quote.discount_amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Round Off :</span>
              <span className="text-slate-800">{currencySymbol} 0.00</span>
            </div>
            <div className="border-t border-slate-300 pt-2 flex justify-between items-baseline">
              <span className="text-sm font-bold text-slate-900">Grand Total :</span>
              <span className="text-base font-extrabold text-black">
                {currencySymbol} {quote.total_amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Authorized Signature Bottom Right */}
        <div className="flex justify-end mt-12">
          <div className="text-center min-w-[220px]">
            <div className="text-xs font-bold text-slate-900 uppercase">
              {effectiveCompanyName}
            </div>
            <div className="min-h-16 flex items-center justify-center my-1 gap-3">
              {effectiveStamp ? (
                <img
                  src={effectiveStamp}
                  alt="Official Seal"
                  className="max-h-16 max-w-[85px] object-contain shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full border-2 border-dashed border-slate-300 flex items-center justify-center text-[8px] text-slate-400">
                  SEAL
                </div>
              )}
              {effectiveSignature ? (
                <img
                  src={effectiveSignature}
                  alt="Authorized Signature"
                  className="max-h-14 max-w-[140px] object-contain shrink-0"
                />
              ) : (
                <div className="italic font-serif text-lg text-slate-700 -rotate-6">
                  Authorized
                </div>
              )}
            </div>
            <div className="border-t border-slate-400 pt-1 text-xs text-slate-600">
              Authorized Signature
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
