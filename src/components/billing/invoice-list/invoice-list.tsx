"use client";

// ============================================================
// Proforma / Tax Invoice list — WebLedger style, same pattern as the
// quotation list. ?type=proforma|tax_invoice picks the tab.
//   Title dropdown: All / Draft / Unpaid / Partially Paid / Paid / Cancelled
//   Columns: INV NO ✓✓ · CLIENT · CLIENT NO · INV DATE · DUE DATE ·
//            AMOUNT · DUE AMOUNT · STATUS (payment dropdown) · ⋯
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Send,
  Share2,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PaymentStatusMenu } from "@/components/invoices/payment-status-menu";
import { RecordPaymentModal } from "@/components/invoices/record-payment-modal";
import { RevertStageDialog, type RevertTarget } from "@/components/invoices/revert-stage-dialog";
import { FilterDrawer } from "@/components/billing/quotation-list/filter-drawer";
import { EmailDialog } from "@/components/billing/quotation-list/email-dialog";
import type { ListFilters } from "@/components/billing/quotation-list/types";
import type { Invoice } from "@/types";

type InvType = "proforma" | "tax_invoice";
type InvStatus = "draft" | "unpaid" | "partially_paid" | "paid" | "cancelled";

interface Row extends Invoice {
  quotation: { quote_number: string } | null;
  firm: { name: string } | null;
  billed_to: { name?: string; contact_name?: string | null; phone?: string | null } | null;
  sent_whatsapp_at?: string | null;
  sent_email_at?: string | null;
}

const STATUS_LABEL: Record<InvStatus | "all", string> = {
  all: "All",
  draft: "Drafts",
  unpaid: "UnPaid",
  partially_paid: "Partially Paid",
  paid: "Paid",
  cancelled: "Cancelled",
};
const STATUSES: Array<InvStatus | "all"> = ["all", "unpaid", "partially_paid", "paid", "draft", "cancelled"];

const TYPE_LABEL: Record<InvType, string> = { proforma: "Proforma Invoices", tax_invoice: "Tax Invoices" };

const fmtDate = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const fmtINR = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const clientLabel = (r: Row) => r.billed_to?.name || r.client_company || r.client_name || "—";
const clientPhone = (r: Row) => {
  const d = (r.billed_to?.phone || r.client_phone || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return d || "—";
};

export function InvoiceList() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const type: InvType = sp.get("type") === "tax_invoice" ? "tax_invoice" : "proforma";
  const status = (STATUSES as string[]).includes(sp.get("status") ?? "") ? (sp.get("status") as InvStatus) : "all";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const q = sp.get("q") ?? "";
  const filters: ListFilters = useMemo(
    () => ({
      status: "all",
      q,
      client: sp.get("client") ? { id: sp.get("client")!, label: sp.get("client_name") ?? "Client" } : null,
      group: sp.get("group") ?? "",
      from: sp.get("from") ?? "",
      to: sp.get("to") ?? "",
      page,
    }),
    [sp, q, page],
  );
  const overdue = sp.get("overdue") === "1";

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);
  const [filterOpen, setFilterOpen] = useState(false);
  const [payFor, setPayFor] = useState<Invoice | null>(null);
  const [revert, setRevert] = useState<{ inv: Invoice; to: RevertTarget } | null>(null);
  const [emailFor, setEmailFor] = useState<Row | null>(null);
  const pageSize = 25;

  const setParams = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (resetPage && !("page" in patch)) next.delete("page");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [sp, router, pathname],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ type, page: String(page), page_size: String(pageSize) });
      if (status !== "all") qs.set("status", status);
      for (const k of ["q", "client", "group", "from", "to", "overdue"]) {
        const v = sp.get(k);
        if (v) qs.set(k, v);
      }
      const res = await fetch(`/api/billing/invoices?${qs}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not load invoices");
        return;
      }
      setError(null);
      setRows(json.rows ?? []);
      setTotal(json.total ?? 0);
      setCounts(json.counts ?? {});
    } catch {
      setError("Network error — please refresh");
    } finally {
      setLoading(false);
    }
  }, [type, page, status, sp]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (search === q) return;
    const t = window.setTimeout(() => setParams({ q: search.trim() || null }), 350);
    return () => window.clearTimeout(t);
  }, [search, q, setParams]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const activeFilters = [filters.client, filters.group, filters.from, filters.to, overdue].filter(Boolean).length;
  const today = todayIST();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const publicLink = (r: Row) => `${origin}/invoice/${r.public_token}`;

  const sendWhatsApp = async (r: Row) => {
    toast.info(`Sending ${r.invoice_number} on WhatsApp…`);
    const res = await fetch(`/api/invoices/${r.id}/send-whatsapp`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "WhatsApp send failed");
      return;
    }
    toast.success(`${r.invoice_number} sent on WhatsApp`);
    void load();
  };

  const shareWhatsApp = (r: Row) => {
    const digits = (r.billed_to?.phone || r.client_phone || "").replace(/\D/g, "");
    const phone = digits.length === 10 ? `91${digits}` : digits;
    const what = r.invoice_type === "tax_invoice" ? "tax invoice" : "proforma invoice";
    const text = `Dear ${r.billed_to?.contact_name || r.client_name || "Sir/Madam"},\n\nPlease find our ${what} ${r.invoice_number} for ${fmtINR(Number(r.total_amount))}${
      Number(r.balance_amount) > 0 ? ` (due: ${fmtINR(Number(r.balance_amount))})` : ""
    }:\n${publicLink(r)}\n\nThank you.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  const deleteDraft = async (r: Row) => {
    if (!window.confirm(`Delete draft ${r.invoice_number}?`)) return;
    const res = await fetch(`/api/billing/invoices/${r.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Could not delete");
      return;
    }
    toast.success(`${r.invoice_number} deleted`);
    void load();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <nav className="flex gap-1 border-b text-sm" aria-label="Billing documents">
        <Link href="/billing/quotations" className="-mb-px border-b-2 border-transparent px-3 py-2 text-muted-foreground hover:text-foreground">
          Quotations
        </Link>
        {(["proforma", "tax_invoice"] as const).map((t) =>
          t === type ? (
            <span key={t} className="-mb-px border-b-2 border-primary px-3 py-2 font-medium">
              {TYPE_LABEL[t]}
            </span>
          ) : (
            <Link key={t} href={`/billing/invoices?type=${t}`} className="-mb-px border-b-2 border-transparent px-3 py-2 text-muted-foreground hover:text-foreground">
              {TYPE_LABEL[t]}
            </Link>
          ),
        )}
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md text-xl font-semibold tracking-tight hover:text-primary focus:outline-none cursor-pointer">
            {status === "all" ? `All ${TYPE_LABEL[type]}` : `${STATUS_LABEL[status]} ${TYPE_LABEL[type]}`}
            <span className="text-base font-normal text-muted-foreground">({counts[status] ?? 0})</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {STATUSES.map((s) => (
              <DropdownMenuItem key={s} onClick={() => setParams({ status: s === "all" ? null : s })} className="flex justify-between cursor-pointer">
                {STATUS_LABEL[s]}
                <span className="text-xs tabular-nums text-muted-foreground">{counts[s] ?? 0}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={overdue ? "default" : "outline"} onClick={() => setParams({ overdue: overdue ? null : "1" })}>
            Overdue
          </Button>
          <Button size="sm" variant="outline" onClick={() => setFilterOpen(true)} aria-label="Filters">
            <Filter className="h-4 w-4" />
            {activeFilters > 0 && <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{activeFilters}</span>}
          </Button>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search inv no., client, mobile, UTR" className="h-9 pl-8" />
          </div>
          <Link href={`/billing/invoices/new?type=${type}`} className={buttonVariants({ size: "sm" })}>
            <Plus className="mr-1 h-4 w-4" /> {type === "tax_invoice" ? "Tax Invoice" : "Proforma"}
          </Link>
        </div>
      </div>

      {error && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">{error}</div>}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Inv No.</th>
              <th className="px-3 py-2 text-left font-medium">To Client</th>
              <th className="px-3 py-2 text-left font-medium">Client No.</th>
              <th className="px-3 py-2 text-left font-medium">Inv. Date</th>
              <th className="px-3 py-2 text-left font-medium">Due Date</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-right font-medium">Due Amount</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="w-12 px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length ? (
              <tr>
                <td colSpan={9} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  {q || activeFilters || status !== "all" ? "No invoices match." : `No ${TYPE_LABEL[type].toLowerCase()} yet.`}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const cancelled = r.status === "cancelled";
                const isOverdue = !!r.due_date && r.due_date < today && (r.status === "unpaid" || r.status === "partially_paid");
                const sent = !!(r.sent_whatsapp_at || r.sent_at || r.sent_email_at);
                return (
                  <tr key={r.id} className={cn("border-t hover:bg-muted/30", loading && "opacity-60", cancelled && "text-muted-foreground")}>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link
                        href={cancelled ? `/invoice/${r.public_token}` : `/billing/invoices/${r.id}/edit`}
                        target={cancelled ? "_blank" : undefined}
                        className={cn("font-mono text-xs font-semibold hover:underline", cancelled ? "line-through" : "text-primary")}
                      >
                        {r.invoice_number}
                      </Link>
                      {sent && <CheckCheck className="ml-1 inline h-3.5 w-3.5 text-sky-500" aria-label="Sent to client" />}
                      {(r.revision ?? 0) > 0 && <span className="ml-1 text-[10px] text-muted-foreground">Rev {r.revision}</span>}
                      <div className="text-[10px] text-muted-foreground">{r.quotation?.quote_number ? `From ${r.quotation.quote_number}` : "Direct"}</div>
                    </td>
                    <td className="max-w-[220px] px-3 py-2">
                      <div className="truncate font-medium">{clientLabel(r)}</div>
                      {cancelled && r.cancel_reason && <div className="truncate text-[10px] text-rose-600">{r.cancel_reason}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{clientPhone(r)}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(r.issue_date)}</td>
                    <td className={cn("whitespace-nowrap px-3 py-2 tabular-nums", isOverdue && "font-semibold text-destructive")}>
                      {fmtDate(r.due_date)}
                      {isOverdue && <div className="text-[10px] font-normal">Overdue</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{fmtINR(Number(r.total_amount))}</td>
                    <td className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", Number(r.balance_amount) > 0 && !cancelled && "text-destructive")}>
                      {cancelled ? "—" : fmtINR(Number(r.balance_amount))}
                    </td>
                    <td className="px-3 py-2">
                      {cancelled ? (
                        <Badge variant="outline" className="border-rose-500/30 text-rose-600">Cancelled</Badge>
                      ) : r.status === "draft" ? (
                        <Badge variant="outline" className="text-muted-foreground">Draft</Badge>
                      ) : (
                        <PaymentStatusMenu
                          invoice={r}
                          onChanged={() => load()}
                          emphasizePaid={type === "tax_invoice"}
                          onNeedsRevert={(tiId) => {
                            const ti = rows.find((x) => x.id === tiId);
                            if (ti) setRevert({ inv: ti, to: "proforma" });
                            else toast.info("Open the Tax Invoices tab and use “Move back to Proforma” on it.");
                          }}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Actions for ${r.invoice_number}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="w-56 text-xs">
                          <DropdownMenuItem onClick={() => window.open(`/api/invoices/${r.id}/pdf`, "_blank")}>
                            <Download className="mr-2 h-3.5 w-3.5" /> Download
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => window.open(`/invoice/${r.public_token}`, "_blank")}>
                            <ExternalLink className="mr-2 h-3.5 w-3.5" /> View
                          </DropdownMenuItem>
                          {!cancelled && (r.status === "unpaid" || r.status === "partially_paid") && (
                            <DropdownMenuItem onClick={() => setPayFor(r)}>
                              <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Record Payment
                            </DropdownMenuItem>
                          )}
                          {!cancelled && (
                            <>
                              <DropdownMenuItem onClick={() => sendWhatsApp(r)}>
                                <Send className="mr-2 h-3.5 w-3.5" /> Send via WhatsApp
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => shareWhatsApp(r)}>
                                <Share2 className="mr-2 h-3.5 w-3.5" /> Share via WhatsApp
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setEmailFor(r)}>
                                <Mail className="mr-2 h-3.5 w-3.5" /> Send via Email
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuItem
                            onClick={() => {
                              void navigator.clipboard.writeText(publicLink(r));
                              toast.success("Client link copied");
                            }}
                          >
                            <Copy className="mr-2 h-3.5 w-3.5" /> Copy client link
                          </DropdownMenuItem>
                          {!cancelled && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => router.push(`/billing/invoices/${r.id}/edit`)}>
                                <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                              </DropdownMenuItem>
                              {r.status !== "draft" && type === "tax_invoice" && (
                                <DropdownMenuItem onClick={() => setRevert({ inv: r, to: "proforma" })}>
                                  <Undo2 className="mr-2 h-3.5 w-3.5" /> Move back to Proforma
                                </DropdownMenuItem>
                              )}
                              {r.status !== "draft" && (
                                <DropdownMenuItem onClick={() => setRevert({ inv: r, to: "quotation" })}>
                                  <Undo2 className="mr-2 h-3.5 w-3.5" /> Move back to Quotation
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                          {r.status === "draft" && (
                            <DropdownMenuItem onClick={() => deleteDraft(r)} className="text-destructive">
                              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete draft
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 invoices"}</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) }, false)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-2 tabular-nums">
            Page {page} of {pages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setParams({ page: String(page + 1) }, false)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {activeFilters > 0 && (
        <button type="button" onClick={() => setParams({ client: null, client_name: null, group: null, from: null, to: null, overdue: null })} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer">
          <XCircle className="h-3.5 w-3.5" /> Clear filters
        </button>
      )}

      <FilterDrawer
        open={filterOpen}
        onOpenChange={setFilterOpen}
        value={filters}
        dateLabel="Invoice Date"
        description="Narrow down the invoice list."
        onApply={(f) =>
          setParams({
            client: f.client?.id ?? null,
            client_name: f.client?.label ?? null,
            group: f.group || null,
            from: f.from || null,
            to: f.to || null,
          })
        }
      />
      <RecordPaymentModal invoice={payFor} open={!!payFor} onOpenChange={(o) => !o && setPayFor(null)} onPaymentRecorded={() => load()} />
      <RevertStageDialog
        invoice={revert?.inv ?? null}
        to={revert?.to ?? "quotation"}
        allInvoices={rows}
        quoteNumber={revert ? ((revert.inv as Row).quotation?.quote_number ?? null) : null}
        open={!!revert}
        onOpenChange={(o) => !o && setRevert(null)}
        onDone={(r) => {
          if (r.target_type === "quotation") router.push("/billing/quotations");
          else if (type !== "proforma") router.push("/billing/invoices?type=proforma");
          else void load();
        }}
      />
      <EmailDialog
        quotation={emailFor ? { id: emailFor.id, quote_number: emailFor.invoice_number } : null}
        kind="invoice"
        onOpenChange={(o) => !o && setEmailFor(null)}
        onSent={load}
      />
    </div>
  );
}
