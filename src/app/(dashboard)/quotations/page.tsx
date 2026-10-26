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
  XCircle,
  Copy,
  Trash2,
  Edit,
  TrendingUp,
  FileCheck,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QuotationBuilderModal } from "@/components/quotations/quotation-builder-modal";
import type { Quotation } from "@/types";

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [builderOpen, setBuilderOpen] = useState(false);
  const [quoteToEdit, setQuoteToEdit] = useState<Quotation | null>(null);

  const fetchQuotations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/quotations?${params.toString()}`);
      const data = await res.json();
      if (res.ok && data.quotations) {
        setQuotations(data.quotations);
      }
    } catch (err) {
      console.error("Failed to load quotations:", err);
      toast.error("Could not fetch quotations");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    fetchQuotations();
  }, [fetchQuotations]);

  // Summary Metrics
  const metrics = useMemo(() => {
    const totalCount = quotations.length;
    let totalValue = 0;
    let acceptedValue = 0;
    let acceptedCount = 0;

    for (const q of quotations) {
      const amt = Number(q.total_amount) || 0;
      totalValue += amt;
      if (q.status === "accepted") {
        acceptedValue += amt;
        acceptedCount += 1;
      }
    }

    const rate = totalCount > 0 ? Math.round((acceptedCount / totalCount) * 100) : 0;

    return {
      totalCount,
      totalValue,
      acceptedValue,
      rate,
    };
  }, [quotations]);

  const handleSendWhatsApp = async (quote: Quotation) => {
    toast.info(`Sending ${quote.quote_number} via WhatsApp...`);
    try {
      const res = await fetch(`/api/quotations/${quote.id}/send-whatsapp`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      toast.success(`Quotation ${quote.quote_number} dispatched on WhatsApp!`);
      fetchQuotations();
    } catch (err: any) {
      toast.error(err.message || "Failed to send on WhatsApp");
    }
  };

  const handleUpdateStatus = async (quote: Quotation, newStatus: string) => {
    try {
      const res = await fetch(`/api/quotations/${quote.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update status");
      }
      toast.success(`Quotation marked as ${newStatus}`);
      fetchQuotations();
    } catch (err: any) {
      toast.error(err.message || "Status update failed");
    }
  };

  const handleDelete = async (quote: Quotation) => {
    if (!confirm(`Delete quotation ${quote.quote_number}?`)) return;
    try {
      const res = await fetch(`/api/quotations/${quote.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Quotation deleted");
      fetchQuotations();
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    }
  };

  const handleCopyLink = (token: string) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/quote/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Public quote link copied to clipboard!");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "accepted":
        return <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 border-emerald-500/30">Accepted</Badge>;
      case "sent":
        return <Badge className="bg-sky-500/15 text-sky-600 hover:bg-sky-500/25 border-sky-500/30">Sent</Badge>;
      case "rejected":
        return <Badge className="bg-rose-500/15 text-rose-600 hover:bg-rose-500/25 border-rose-500/30">Rejected</Badge>;
      case "expired":
        return <Badge className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 border-amber-500/30">Expired</Badge>;
      default:
        return <Badge variant="secondary">Draft</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Receipt className="h-6 w-6 text-primary" />
            Quotations & Invoicing
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Create, track, and dispatch formal compliance quotations and invoices with instant WhatsApp delivery.
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
            <Receipt className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">{metrics.totalCount}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Generated to date</p>
        </Card>

        <Card className="p-4 bg-card/60 backdrop-blur-sm">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Total Pipeline Value</span>
            <TrendingUp className="h-4 w-4 text-sky-500" />
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">
            ₹{metrics.totalValue.toLocaleString("en-IN")}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Sum of all active quotations</p>
        </Card>

        <Card className="p-4 bg-card/60 backdrop-blur-sm">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Accepted Revenue</span>
            <FileCheck className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-600 mt-2">
            ₹{metrics.acceptedValue.toLocaleString("en-IN")}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Closed & confirmed business</p>
        </Card>

        <Card className="p-4 bg-card/60 backdrop-blur-sm">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Acceptance Rate</span>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-foreground mt-2">{metrics.rate}%</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Quote-to-win conversion</p>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {["all", "draft", "sent", "accepted", "rejected", "expired"].map((st) => (
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
            placeholder="Search quote #, client, title..."
            className="h-8 pl-8 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Quotations Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : quotations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-6">
            <Receipt className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <h3 className="font-semibold text-foreground text-base">No quotations found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mt-1">
              {search || statusFilter !== "all"
                ? "No quotes match your current search or status filter."
                : "Create your first client quotation to begin sending itemized compliance proposals over WhatsApp."}
            </p>
            {!search && statusFilter === "all" && (
              <Button
                size="sm"
                className="mt-4 gap-1.5 text-xs"
                onClick={() => {
                  setQuoteToEdit(null);
                  setBuilderOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                New Quotation
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 border-b font-medium text-muted-foreground">
                <tr>
                  <th className="p-3 text-left w-32">Quote #</th>
                  <th className="p-3 text-left">Title / Scope</th>
                  <th className="p-3 text-left">Client</th>
                  <th className="p-3 text-left">Date & Validity</th>
                  <th className="p-3 text-right">Amount (₹)</th>
                  <th className="p-3 text-center w-28">Status</th>
                  <th className="p-3 text-right w-16">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {quotations.map((q) => (
                  <tr key={q.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-semibold text-primary">{q.quote_number}</td>
                    <td className="p-3 font-medium text-foreground max-w-xs truncate">
                      {q.title}
                      {q.client_company && (
                        <div className="text-[11px] text-muted-foreground font-normal">
                          {q.client_company}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-foreground">{q.client_name}</div>
                      {q.client_phone && (
                        <div className="text-[11px] text-muted-foreground">{q.client_phone}</div>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      <div>{new Date(q.issue_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
                      {q.valid_until && (
                        <div className="text-[10px]">
                          Due: {new Date(q.valid_until).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-right font-bold text-foreground">
                      ₹{q.total_amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3 text-center">{getStatusBadge(q.status)}</td>
                    <td className="p-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon" className="h-8 w-8" />
                          }
                        >
                          <MoreVertical className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 text-xs">
                          <DropdownMenuItem
                            onClick={() => window.open(`/api/quotations/${q.id}/pdf`, "_blank")}
                            className="gap-2 cursor-pointer"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            View / Print PDF
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={() => handleSendWhatsApp(q)}
                            className="gap-2 cursor-pointer text-sky-600 focus:text-sky-600"
                          >
                            <Send className="h-3.5 w-3.5" />
                            Send via WhatsApp
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={() => handleCopyLink(q.public_token)}
                            className="gap-2 cursor-pointer"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy Public Link
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={() => window.open(`/quote/${q.public_token}`, "_blank")}
                            className="gap-2 cursor-pointer"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open Client View
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <DropdownMenuItem
                            onClick={() => {
                              setQuoteToEdit(q);
                              setBuilderOpen(true);
                            }}
                            className="gap-2 cursor-pointer"
                          >
                            <Edit className="h-3.5 w-3.5" />
                            Edit Quotation
                          </DropdownMenuItem>

                          {q.status !== "accepted" && (
                            <DropdownMenuItem
                              onClick={() => handleUpdateStatus(q, "accepted")}
                              className="gap-2 cursor-pointer text-emerald-600 focus:text-emerald-600"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Mark as Accepted
                            </DropdownMenuItem>
                          )}

                          {q.status !== "rejected" && (
                            <DropdownMenuItem
                              onClick={() => handleUpdateStatus(q, "rejected")}
                              className="gap-2 cursor-pointer text-rose-600 focus:text-rose-600"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Mark as Rejected
                            </DropdownMenuItem>
                          )}

                          <DropdownMenuSeparator />

                          <DropdownMenuItem
                            onClick={() => handleDelete(q)}
                            className="gap-2 cursor-pointer text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Builder Modal */}
      <QuotationBuilderModal
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        quotationToEdit={quoteToEdit}
        onSuccess={() => fetchQuotations()}
      />
    </div>
  );
}
