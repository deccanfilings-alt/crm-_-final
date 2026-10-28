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

  const currencyCode = invoice.currency || "INR";
  const currencySymbol = currencyCode === "INR" ? "INR" : currencyCode;
  const items = invoice.items || [];

  const cgstAmount = Math.round(((invoice.tax_amount || 0) / 2 + Number.EPSILON) * 100) / 100;
  const sgstAmount = Math.round(((invoice.tax_amount || 0) - cgstAmount + Number.EPSILON) * 100) / 100;

  const effectiveCompanyName = invoice.company_name || settings.company_name || "Company";
  const effectiveCompanyLogo = invoice.company_logo_url || settings.company_logo_url;
  const effectiveCompanyAddress = invoice.company_address || settings.company_address;
  const effectiveCompanyPhone = invoice.company_phone || settings.company_phone;
  const effectiveCompanyEmail = invoice.company_email || settings.company_email;
  const effectiveGstin = invoice.gstin || settings.gstin;
  const effectivePan = invoice.pan || settings.pan;
  const effectiveStamp = invoice.stamp_url || settings.stamp_url;
  const effectiveSignature = invoice.signature_url || settings.signature_url;

  const upiId = invoice.upi_id || settings.upi_id || "";
  const upiQr = invoice.upi_qr_url || settings.upi_qr_url || (upiId && !isPaid ? `https://quickchart.io/qr?text=${encodeURIComponent(`upi://pay?pa=${upiId}&pn=${effectiveCompanyName}&am=${invoice.balance_amount || invoice.total_amount}&cu=${currencyCode}`)}&size=130` : null);

  function formatDateDMY(dStr?: string | null): string {
    if (!dStr) return "";
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  }

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
        </div>
      </div>

      {/* Invoice Document replica */}
      <div className="rounded-xl border bg-white p-6 sm:p-10 shadow-md">
        {/* Top Header */}
        <div className="flex items-start justify-between pb-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-wider text-slate-900 uppercase">
                {docTitle}
              </h1>
              {isPaid && (
                <span className="border-2 border-emerald-600 bg-emerald-50 px-2.5 py-0.5 text-xs font-extrabold tracking-widest text-emerald-700 uppercase rounded">
                  PAID
                </span>
              )}
            </div>
            <div className="mt-3 text-xs space-y-1">
              <div>
                <span className="font-semibold text-slate-700 inline-block w-24">Invoice No:</span>
                <span className="font-bold text-slate-900">{invoice.invoice_number}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-700 inline-block w-24">Invoice Date:</span>
                <span className="text-slate-900">{formatDateDMY(invoice.issue_date)}</span>
              </div>
              {invoice.due_date && (
                <div>
                  <span className="font-semibold text-slate-700 inline-block w-24">Due Date:</span>
                  <span className="text-slate-900">{formatDateDMY(invoice.due_date)}</span>
                </div>
              )}
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
              <div><strong className="text-slate-900 inline-block w-20">Billed To :</strong> <span className="font-semibold text-slate-900">{invoice.client_company || invoice.client_name}</span></div>
              {invoice.client_phone && (
                <div><strong className="text-slate-700 inline-block w-20">Phone:</strong> <span className="text-slate-600">{invoice.client_phone}</span></div>
              )}
              {invoice.client_email && (
                <div><strong className="text-slate-700 inline-block w-20">Email:</strong> <span className="text-slate-600">{invoice.client_email}</span></div>
              )}
              {invoice.client_address && (
                <div><strong className="text-slate-700 inline-block w-20 align-top">Address:</strong> <span className="text-slate-600">{invoice.client_address}</span></div>
              )}
              {invoice.client_gstin && (
                <div><strong className="text-slate-900 inline-block w-20">GST IN :</strong> <span className="font-semibold text-slate-900">{invoice.client_gstin}</span></div>
              )}
            </div>
          </div>
        </div>

        {/* Line Items Table */}
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
                    {invoice.tax_type === "none" ? "0 %" : `${it.tax_rate || invoice.tax_rate || 18} %`}
                  </td>
                  <td className="p-2.5 text-right font-bold text-slate-900">
                    {currencySymbol} {it.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bottom Section: Payment / Receipt on Left & Totals on Right */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 my-6 items-start">
          {/* Left: Payment Box or Receipt Box */}
          <div className="sm:col-span-7">
            {isPaid ? (
              <div className="p-4 border rounded border-emerald-300 bg-emerald-50/70 text-xs space-y-2">
                <div className="flex items-center justify-between border-b border-emerald-200 pb-2">
                  <span className="font-bold text-emerald-900 uppercase">Payment Receipt</span>
                  <span className="bg-emerald-600 text-white font-extrabold text-[10px] px-2 py-0.5 rounded">
                    100% PAID
                  </span>
                </div>
                <div className="space-y-1.5 pt-1 text-slate-800">
                  {invoice.payment_reference && (
                    <div><strong className="text-emerald-900 inline-block w-28">UTR / Ref No :</strong> <span className="font-mono font-semibold">{invoice.payment_reference}</span></div>
                  )}
                  {invoice.payment_method && (
                    <div><strong className="text-emerald-900 inline-block w-28">Payment Mode :</strong> <span className="uppercase font-medium">{invoice.payment_method.replace('_', ' ')}</span></div>
                  )}
                  {invoice.paid_at && (
                    <div><strong className="text-emerald-900 inline-block w-28">Date Paid :</strong> <span>{formatDateDMY(invoice.paid_at)}</span></div>
                  )}
                  <div><strong className="text-emerald-900 inline-block w-28">Amount Received:</strong> <span className="font-bold text-emerald-950">{currencySymbol} {(invoice.paid_amount || invoice.total_amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>
                  <div><strong className="text-emerald-900 inline-block w-28">Balance Due :</strong> <span className="font-bold text-slate-900">{currencySymbol} 0.00</span></div>
                </div>
              </div>
            ) : (
              <div className="flex gap-4 p-3 border rounded border-slate-200 bg-slate-50/50">
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
                  <div className="font-bold text-slate-900">
                    Name : {invoice.bank_beneficiary_name || settings.bank_beneficiary_name || effectiveCompanyName}
                  </div>
                  {(invoice.bank_name || settings.bank_name) && <div><strong className="text-slate-900">Bank Name :</strong> {invoice.bank_name || settings.bank_name},</div>}
                  {(invoice.bank_account_no || settings.bank_account_no) && <div><strong className="text-slate-900">Bank Account No :</strong> {invoice.bank_account_no || settings.bank_account_no}</div>}
                  {(invoice.bank_ifsc || settings.bank_ifsc) && <div><strong className="text-slate-900">Bank/IFSC Code :</strong> {invoice.bank_ifsc || settings.bank_ifsc}</div>}
                </div>
              </div>
            )}
          </div>

          {/* Right: Totals Box */}
          <div className="sm:col-span-5 rounded border border-slate-200 bg-slate-50 p-4 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-600 font-medium">Sub-Total :</span>
              <span className="font-semibold text-slate-900">{currencySymbol} {invoice.subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            </div>
            {invoice.tax_amount > 0 && (
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
              <span className="text-slate-800">{currencySymbol} {(invoice.discount_amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Round Off :</span>
              <span className="text-slate-800">{currencySymbol} 0.00</span>
            </div>
            <div className="border-t border-slate-300 pt-2 flex justify-between items-baseline">
              <span className="text-sm font-bold text-slate-900">Grand Total :</span>
              <span className="text-base font-extrabold text-black">
                {currencySymbol} {invoice.total_amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
            {isPaid && (
              <div className="border-t border-dashed border-slate-300 pt-1.5 flex justify-between items-baseline text-emerald-700">
                <span className="text-xs font-bold">Paid :</span>
                <span className="text-xs font-extrabold">
                  {currencySymbol} {(invoice.paid_amount || invoice.total_amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Declaration */}
        <div className="text-[11px] text-slate-500 border-t border-slate-200 pt-3 my-4">
          {isTaxInvoice ? (
            <p>
              <strong>Declaration:</strong> Certified that the particulars given above are true and correct and the amount indicated represents the price actually charged. This is an authentic Tax Invoice for Input Tax Credit (ITC).
            </p>
          ) : (
            <p>
              <strong>Terms:</strong> This Proforma Invoice is issued for advance payment processing. Official Tax Invoice with payment receipt will be issued upon payment confirmation.
            </p>
          )}
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
