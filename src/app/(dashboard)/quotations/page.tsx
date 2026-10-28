"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import {
  Plus,
  Receipt,
  Search,
  Loader2,
  ExternalLink,
  Send,
  MoreVertical,
  Printer,
  CheckCircle2,
  Copy,
  Trash2,
  Edit,
  TrendingUp,
  Clock,
  ArrowRight,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QuotationBuilderModal } from "@/components/quotations/quotation-builder-modal";
import { RecordPaymentModal } from "@/components/invoices/record-payment-modal";
import { ConvertQuoteModal } from "@/components/invoices/convert-quote-modal";
import type { Quotation, Invoice } from "@/types";

export default function QuotationsPage() {
  const [activeTab, setActiveTab] = useState<"quotations" | "proforma" | "tax_invoice">("quotations");

  // Quotations state
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Modals state
  const [builderOpen, setBuilderOpen] = useState(false);
  const [quoteToEdit, setQuoteToEdit] = useState<Quotation | null>(null);

  const [convertModalOpen, setConvertModalOpen] = useState(false);
  const [quoteToConvert, setQuoteToConvert] = useState<Quotation | null>(null);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [invoiceToPay, setInvoiceToPay] = useState<Invoice | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qParams = new URLSearchParams();
      if (search.trim()) qParams.set("search", search.trim());
      if (statusFilter !== "all") qParams.set("status", statusFilter);

      const [qRes, iRes] = await Promise.all([
        fetch(`/api/quotations?${qParams.toString()}`),
        fetch(`/api/invoices?${qParams.toString()}`),
      ]);

      const qData = await qRes.json();
      const iData = await iRes.json();

      if (qRes.ok && qData.quotations) setQuotations(qData.quotations);
      if (iRes.ok && iData.invoices) setInvoices(iData.invoices);
    } catch (err) {
      console.error("Failed to load billing data:", err);
      toast.error("Could not fetch data");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Derived Invoices
  const proformaInvoices = useMemo(
    () => invoices.filter((i) => i.invoice_type === "proforma"),
    [invoices]
  );

  const taxInvoices = useMemo(
    () => invoices.filter((i) => i.invoice_type === "tax_invoice"),
    [invoices]
  );

  // Summary Metrics
  const metrics = useMemo(() => {
    const totalQuotesCount = quotations.length;
    let totalQuotesValue = 0;
    let acceptedQuotesValue = 0;
    let acceptedQuotesCount = 0;

    for (const q of quotations) {
      const amt = Number(q.total_amount) || 0;
      totalQuotesValue += amt;
      if (q.status === "accepted") {
        acceptedQuotesValue += amt;
        acceptedQuotesCount += 1;
      }
    }

    let totalCollectedRevenue = 0;
    for (const ti of taxInvoices) {
      totalCollectedRevenue += Number(ti.paid_amount || ti.total_amount) || 0;
    }

    const conversionRate = totalQuotesCount > 0 ? Math.round((acceptedQuotesCount / totalQuotesCount) * 100) : 0;

    return {
      totalQuotesCount,
      totalQuotesValue,
      acceptedQuotesValue,
      totalCollectedRevenue,
      conversionRate,
    };
  }, [quotations, taxInvoices]);

  // Quotation Handlers
  const handleSendQuoteWhatsApp = async (quote: Quotation) => {
    toast.info(`Sending ${quote.quote_number} via WhatsApp...`);
    try {
      const res = await fetch(`/api/quotations/${quote.id}/send-whatsapp`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");

      if (data.phone) {
        const waLink = `https://wa.me/${data.phone}?text=${encodeURIComponent(data.whatsappMessage)}`;
        window.open(waLink, "_blank");
      }
      toast.success(`Quotation ${quote.quote_number} link prepared!`);
    } catch (err: any) {
      toast.error(err.message || "Could not send WhatsApp");
    }
  };

  const handleCopyQuoteLink = (quote: Quotation) => {
    const url = `${window.location.origin}/quote/${quote.public_token}`;
    navigator.clipboard.writeText(url);
    toast.success("Public quotation link copied to clipboard");
  };

  const handleDeleteQuote = async (quote: Quotation) => {
    if (!confirm(`Are you sure you want to delete draft ${quote.quote_number}?`)) return;
    try {
      const res = await fetch(`/api/quotations/${quote.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Quotation deleted");
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Could not delete");
    }
  };

  // Invoice Handlers
  const handleSendInvoiceWhatsApp = async (invoice: Invoice) => {
    toast.info(`Sending ${invoice.invoice_number} via WhatsApp...`);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/send-whatsapp`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");

      if (data.phone) {
        const waLink = `https://wa.me/${data.phone}?text=${encodeURIComponent(data.whatsappMessage)}`;
        window.open(waLink, "_blank");
      }
      toast.success(`Invoice ${invoice.invoice_number} link prepared!`);
    } catch (err: any) {
      toast.error(err.message || "Could not send WhatsApp");
    }
  };

  const handleCopyInvoiceLink = (invoice: Invoice) => {
    const url = `${window.location.origin}/invoice/${invoice.public_token}`;
    navigator.clipboard.writeText(url);
    toast.success("Public invoice link copied to clipboard");
  };

  const statusBadge = (st: string) => {
    switch (st) {
      case "paid":
        return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">Paid</Badge>;
      case "accepted":
        return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">Accepted</Badge>;
      case "sent":
        return <Badge className="bg-sky-500/15 text-sky-600 border-sky-500/30">Sent</Badge>;
      case "partially_paid":
        return <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30">Partially Paid</Badge>;
      case "unpaid":
        return <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30">Unpaid</Badge>;
      case "rejected":
        return <Badge className="bg-rose-500/15 text-rose-600 border-rose-500/30">Rejected</Badge>;
      case "expired":
        return <Badge className="bg-slate-500/15 text-slate-600 border-slate-500/30">Expired</Badge>;
      default:
        return <Badge variant="outline" className="text-muted-foreground">Draft</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Receipt className="h-6 w-6 text-primary" />
            Quotations & Invoicing Hub
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            2-Stage Billing: Quotation &rarr; Proforma Invoice (Pre-Payment) &rarr; Tax Invoice (Post-Payment / Receipt).
          </p>
        </div>

        <Button
          onClick={() => {
            setQuoteToEdit(null);
            setBuilderOpen(true);
          }}
          className="gap-2 shrink-0"
        >
          <Plus className="h-4 w-4" />
          Create Quotation
        </Button>
      </div>

      {/* Metrics Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 bg-card/60 backdrop-blur-sm">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Total Quotations</span>
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">{metrics.totalQuotesCount}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">₹{metrics.totalQuotesValue.toLocaleString("en-IN")} pipeline</p>
        </Card>

        <Card className="p-4 bg-card/60 backdrop-blur-sm">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Proforma (Pre-Payment)</span>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-amber-600 mt-2">{proformaInvoices.length}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Pending client payments</p>
        </Card>

        <Card className="p-4 bg-card/60 backdrop-blur-sm">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Collected Revenue (Tax Invoices)</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-600 mt-2">
            ₹{metrics.totalCollectedRevenue.toLocaleString("en-IN")}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{taxInvoices.length} paid tax invoices</p>
        </Card>

        <Card className="p-4 bg-card/60 backdrop-blur-sm">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Quote Conversion Rate</span>
            <TrendingUp className="h-4 w-4 text-sky-500" />
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">{metrics.conversionRate}%</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Quote-to-win conversion</p>
        </Card>
      </div>

      {/* Primary Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-1">
        <button
          onClick={() => setActiveTab("quotations")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-t-lg text-xs font-semibold border-b-2 transition-all ${
            activeTab === "quotations"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          Quotations (DF-QT)
          <span className="ml-1 rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-bold text-muted-foreground">
            {quotations.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("proforma")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-t-lg text-xs font-semibold border-b-2 transition-all ${
            activeTab === "proforma"
              ? "border-amber-600 text-amber-600 bg-amber-50/40"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Clock className="h-3.5 w-3.5" />
          Proforma Invoices (Pre-Payment)
          <span className="ml-1 rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.2 text-[10px] font-bold">
            {proformaInvoices.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("tax_invoice")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-t-lg text-xs font-semibold border-b-2 transition-all ${
            activeTab === "tax_invoice"
              ? "border-emerald-600 text-emerald-600 bg-emerald-50/40"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Tax Invoices (Post-Payment / Paid)
          <span className="ml-1 rounded-full bg-emerald-100 text-emerald-800 px-1.5 py-0.2 text-[10px] font-bold">
            {taxInvoices.length}
          </span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {["all", "draft", "unpaid", "paid", "accepted", "sent"].map((st) => (
            <Button
              key={st}
              size="sm"
              variant={statusFilter === st ? "default" : "outline"}
              className="h-8 capitalize text-xs"
              onClick={() => setStatusFilter(st)}
            >
              {st}
            </Button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search #, client, title, UTR..."
            className="h-8 pl-8 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* TAB CONTENT */}
      {loading ? (
        <div className="flex min-h-[300px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : activeTab === "quotations" ? (
        /* 1. QUOTATIONS TABLE */
        quotations.length === 0 ? (
          <div className="rounded-xl border border-dashed p-12 text-center">
            <Receipt className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">No Quotations Found</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Create your first proposal to send compliance quotes via WhatsApp.
            </p>
            <Button size="sm" onClick={() => setBuilderOpen(true)} className="mt-4 gap-1.5">
              <Plus className="h-4 w-4" /> Create Quotation
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-left font-semibold text-muted-foreground">
                  <th className="p-3">Quote #</th>
                  <th className="p-3">Title & Client</th>
                  <th className="p-3">Total Amount</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Date</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {quotations.map((q) => (
                  <tr key={q.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-mono font-bold text-foreground">
                      {q.quote_number}
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-foreground">{q.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {q.client_company || q.client_name} {q.client_phone && `(${q.client_phone})`}
                      </div>
                    </td>
                    <td className="p-3 font-semibold text-foreground">
                      ₹{Number(q.total_amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3">{statusBadge(q.status)}</td>
                    <td className="p-3 text-muted-foreground">
                      {new Date(q.issue_date).toLocaleDateString("en-IN")}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* 1-Click Convert to Invoice Button */}
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-[11px] gap-1 font-semibold text-primary hover:text-primary"
                          onClick={() => {
                            setQuoteToConvert(q);
                            setConvertModalOpen(true);
                          }}
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                          Convert to Invoice
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] gap-1 text-emerald-600 hover:text-emerald-700"
                          onClick={() => handleSendQuoteWhatsApp(q)}
                        >
                          <Send className="h-3 w-3" /> WhatsApp
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="text-xs">
                            <DropdownMenuItem onClick={() => window.open(`/quote/${q.public_token}`, "_blank")}>
                              <ExternalLink className="mr-2 h-3.5 w-3.5" /> View Web View
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => window.open(`/api/quotations/${q.id}/pdf`, "_blank")}>
                              <Printer className="mr-2 h-3.5 w-3.5" /> Print / Save PDF
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCopyQuoteLink(q)}>
                              <Copy className="mr-2 h-3.5 w-3.5" /> Copy Client Link
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => {
                                setQuoteToEdit(q);
                                setBuilderOpen(true);
                              }}
                            >
                              <Edit className="mr-2 h-3.5 w-3.5" /> Edit Quotation
                            </DropdownMenuItem>
                            {q.status === "draft" && (
                              <DropdownMenuItem
                                onClick={() => handleDeleteQuote(q)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete Draft
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : activeTab === "proforma" ? (
        /* 2. PROFORMA INVOICES (PRE-PAYMENT) TABLE */
        proformaInvoices.length === 0 ? (
          <div className="rounded-xl border border-dashed p-12 text-center">
            <Clock className="mx-auto h-10 w-10 text-amber-500/40" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">No Proforma Invoices</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              When a quotation is accepted, convert it to a Proforma Invoice with bank details & UPI QR to collect payment.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-left font-semibold text-muted-foreground">
                  <th className="p-3">Proforma #</th>
                  <th className="p-3">Client & Title</th>
                  <th className="p-3">Payable Amount</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Issued Date</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {proformaInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-mono font-bold text-amber-700">
                      {inv.invoice_number}
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-foreground">{inv.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {inv.client_company || inv.client_name}
                      </div>
                    </td>
                    <td className="p-3 font-semibold text-foreground">
                      ₹{Number(inv.total_amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3">{statusBadge(inv.status)}</td>
                    <td className="p-3 text-muted-foreground">
                      {new Date(inv.issue_date).toLocaleDateString("en-IN")}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {inv.status !== "paid" && (
                          <Button
                            size="sm"
                            className="h-7 text-[11px] gap-1 font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => {
                              setInvoiceToPay(inv);
                              setPaymentModalOpen(true);
                            }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Record Payment
                          </Button>
                        )}

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] gap-1 text-emerald-600 hover:text-emerald-700"
                          onClick={() => handleSendInvoiceWhatsApp(inv)}
                        >
                          <Send className="h-3 w-3" /> WhatsApp
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="text-xs">
                            <DropdownMenuItem onClick={() => window.open(`/invoice/${inv.public_token}`, "_blank")}>
                              <ExternalLink className="mr-2 h-3.5 w-3.5" /> View Web View
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => window.open(`/api/invoices/${inv.id}/pdf`, "_blank")}>
                              <Printer className="mr-2 h-3.5 w-3.5" /> Print / Save PDF
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCopyInvoiceLink(inv)}>
                              <Copy className="mr-2 h-3.5 w-3.5" /> Copy Client Link
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        /* 3. TAX INVOICES (POST-PAYMENT / PAID) TABLE */
        taxInvoices.length === 0 ? (
          <div className="rounded-xl border border-dashed p-12 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500/40" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">No Tax Invoices Yet</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Once payments are received and recorded, official Tax Invoices with green PAID stamps and UTR numbers appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-left font-semibold text-muted-foreground">
                  <th className="p-3">Tax Invoice #</th>
                  <th className="p-3">Client & Service</th>
                  <th className="p-3">Paid Amount</th>
                  <th className="p-3">Payment Info & UTR</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Paid Date</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {taxInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-mono font-bold text-emerald-700">
                      {inv.invoice_number}
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-foreground">{inv.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {inv.client_company || inv.client_name}
                      </div>
                    </td>
                    <td className="p-3 font-bold text-foreground">
                      ₹{Number(inv.paid_amount || inv.total_amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3">
                      {inv.payment_reference ? (
                        <div className="font-mono text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded inline-block">
                          UTR: {inv.payment_reference}
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic text-[11px]">Direct Receipt</span>
                      )}
                      {inv.payment_method && (
                        <div className="text-[10px] text-muted-foreground uppercase mt-0.5">
                          via {inv.payment_method.replace('_', ' ')}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 font-bold">
                        PAID
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {inv.paid_at ? new Date(inv.paid_at).toLocaleDateString("en-IN") : new Date(inv.issue_date).toLocaleDateString("en-IN")}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] gap-1 text-emerald-600 hover:text-emerald-700"
                          onClick={() => handleSendInvoiceWhatsApp(inv)}
                        >
                          <Send className="h-3 w-3" /> WhatsApp Receipt
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="text-xs">
                            <DropdownMenuItem onClick={() => window.open(`/invoice/${inv.public_token}`, "_blank")}>
                              <ExternalLink className="mr-2 h-3.5 w-3.5" /> View Tax Invoice
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => window.open(`/api/invoices/${inv.id}/pdf`, "_blank")}>
                              <Printer className="mr-2 h-3.5 w-3.5" /> Print / Save PDF
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCopyInvoiceLink(inv)}>
                              <Copy className="mr-2 h-3.5 w-3.5" /> Copy Receipt Link
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* MODALS */}
      <QuotationBuilderModal
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        quotationToEdit={quoteToEdit}
        onSuccess={() => {
          fetchData();
          setQuoteToEdit(null);
        }}
      />

      <ConvertQuoteModal
        quote={quoteToConvert}
        open={convertModalOpen}
        onOpenChange={setConvertModalOpen}
        onConverted={(newInv) => {
          fetchData();
          setActiveTab(newInv.invoice_type);
        }}
      />

      <RecordPaymentModal
        invoice={invoiceToPay}
        open={paymentModalOpen}
        onOpenChange={setPaymentModalOpen}
        onPaymentRecorded={(taxInv) => {
          fetchData();
          if (taxInv) setActiveTab("tax_invoice");
        }}
      />
    </div>
  );
}
