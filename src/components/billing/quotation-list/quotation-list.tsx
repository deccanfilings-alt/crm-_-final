"use client";

// ============================================================
// Quotation list — WebLedger style.
//   Title dropdown: All / Draft / Final / Invoiced / Cancelled (counts)
//   Toolbar: filter · search · columns · + Quotation
//   Columns: ☐ · QUO NO ✓✓ · INVOICE NO · CLIENT · CLIENT NO · FIRM ·
//            DATE · AMOUNT · STATUS (dropdown pill) · ⋯
//   Bulk: Convert To Invoice. Pagination via ?page=N.
// Filters live in the URL so a filtered view can be bookmarked/shared.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
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
  XCircle,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { StatusPill } from "./status-pill";
import { ConvertDialog } from "./convert-dialog";
import { FilterDrawer } from "./filter-drawer";
import { EmailDialog } from "./email-dialog";
import {
  clientLabel,
  clientPhone,
  COLUMNS,
  fmtDate,
  fmtINR,
  STATUS_META,
  type ColumnId,
  type ListFilters,
  type QStatus,
  type QuotationRow,
} from "./types";

const COLS_KEY = "billing:quotation-columns";
const STATUSES: Array<QStatus | "all"> = ["all", "draft", "final", "invoiced", "cancelled"];

function readFilters(sp: URLSearchParams): ListFilters {
  const status = sp.get("status") as QStatus | null;
  return {
    status: status && ["draft", "final", "invoiced", "cancelled"].includes(status) ? status : "all",
    q: sp.get("q") ?? "",
    client: sp.get("client") ? { id: sp.get("client")!, label: sp.get("client_name") ?? "Client" } : null,
    group: sp.get("group") ?? "",
    from: sp.get("from") ?? "",
    to: sp.get("to") ?? "",
    page: Math.max(1, Number(sp.get("page")) || 1),
  };
}

export function QuotationList() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const filters = useMemo(() => readFilters(new URLSearchParams(sp.toString())), [sp]);

  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(filters.q);
  const [filterOpen, setFilterOpen] = useState(false);
  const [convertIds, setConvertIds] = useState<string[] | null>(null);
  const [emailFor, setEmailFor] = useState<QuotationRow | null>(null);
  const [hidden, setHidden] = useState<Set<ColumnId>>(new Set());
  // Per-browser column choice (read after mount so server and browser match).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLS_KEY) ?? "[]");
      if (Array.isArray(saved) && saved.length) setHidden(new Set(saved));
    } catch {
      // storage unavailable: show all columns
    }
  }, []);
  const pageSize = 25;

  const setParams = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (resetPage && !("page" in patch)) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filters.status !== "all") qs.set("status", filters.status);
      if (filters.q) qs.set("q", filters.q);
      if (filters.client) qs.set("client", filters.client.id);
      if (filters.group) qs.set("group", filters.group);
      if (filters.from) qs.set("from", filters.from);
      if (filters.to) qs.set("to", filters.to);
      qs.set("page", String(filters.page));
      qs.set("page_size", String(pageSize));
      const res = await fetch(`/api/billing/quotations?${qs}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not load quotations");
        return;
      }
      setError(null);
      setRows(json.rows ?? []);
      setTotal(json.total ?? 0);
      setCounts(json.counts ?? {});
      setSelected(new Set());
    } catch {
      setError("Network error — please refresh");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced search -> URL
  useEffect(() => {
    if (search === filters.q) return;
    const t = window.setTimeout(() => setParams({ q: search.trim() || null }), 350);
    return () => window.clearTimeout(t);
  }, [search, filters.q, setParams]);

  const toggleCol = (id: ColumnId) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(COLS_KEY, JSON.stringify([...next]));
      } catch {
        // per-browser preference only
      }
      return next;
    });
  const show = (id: ColumnId) => !hidden.has(id);

  const convertible = rows.filter((r) => r.status === "draft" || r.status === "final");
  const allSelected = convertible.length > 0 && convertible.every((r) => selected.has(r.id));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const activeFilters = [filters.client, filters.group, filters.from, filters.to].filter(Boolean).length;

  // ---------------- row actions ----------------
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const publicLink = (r: QuotationRow) => `${origin}/quote/${r.public_token}`;

  const sendWhatsApp = async (r: QuotationRow) => {
    toast.info(`Sending ${r.quote_number} on WhatsApp…`);
    const res = await fetch(`/api/quotations/${r.id}/send-whatsapp`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "WhatsApp send failed");
      return;
    }
    toast.success(`${r.quote_number} sent on WhatsApp`);
    void load();
  };

  const shareWhatsApp = (r: QuotationRow) => {
    const digits = (r.billed_to?.phone || r.client_phone || "").replace(/\D/g, "");
    const phone = digits.length === 10 ? `91${digits}` : digits;
    const text = `Dear ${r.billed_to?.contact_name || r.client_name || "Sir/Madam"},\n\nPlease find our quotation ${r.quote_number} for ${fmtINR(Number(r.total_amount))}:\n${publicLink(r)}\n\nThank you.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  const cancelQuote = async (r: QuotationRow) => {
    if (!window.confirm(`Cancel ${r.quote_number}? It can't be edited or converted while cancelled.`)) return;
    const res = await fetch(`/api/quotations/${r.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Could not cancel");
      return;
    }
    toast.success(`${r.quote_number} cancelled`);
    void load();
  };

  const deleteQuote = async (r: QuotationRow) => {
    if (!window.confirm(`Delete ${r.quote_number}? It will be removed from the list.`)) return;
    const res = await fetch(`/api/billing/quotations/${r.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Could not delete");
      return;
    }
    toast.success(`${r.quote_number} deleted`);
    void load();
  };

  // ---------------- render ----------------
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <nav className="flex gap-1 border-b text-sm" aria-label="Billing documents">
        <span className="-mb-px border-b-2 border-primary px-3 py-2 font-medium">Quotations</span>
        <Link href="/quotations?tab=proforma" className="-mb-px border-b-2 border-transparent px-3 py-2 text-muted-foreground hover:text-foreground">
          Proforma Invoices
        </Link>
        <Link href="/quotations?tab=tax_invoice" className="-mb-px border-b-2 border-transparent px-3 py-2 text-muted-foreground hover:text-foreground">
          Tax Invoices
        </Link>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Status view (title dropdown) */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md text-xl font-semibold tracking-tight hover:text-primary focus:outline-none cursor-pointer">
            {filters.status === "all" ? "All Quotations" : `${STATUS_META[filters.status].label} Quotations`}
            <span className="text-base font-normal text-muted-foreground">({counts[filters.status] ?? 0})</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {STATUSES.map((s) => (
              <DropdownMenuItem key={s} onClick={() => setParams({ status: s === "all" ? null : s })} className="flex justify-between cursor-pointer">
                {s === "all" ? "All" : STATUS_META[s].label}
                <span className="text-xs tabular-nums text-muted-foreground">{counts[s] ?? 0}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setConvertIds([...selected])}>
              <ArrowRight className="mr-1 h-4 w-4" /> Convert To Invoice ({selected.size})
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setFilterOpen(true)} aria-label="Filters">
            <Filter className="h-4 w-4" />
            {activeFilters > 0 && <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{activeFilters}</span>}
          </Button>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search quo no., client, mobile" className="h-9 pl-8" />
          </div>
          <Link href="/billing/quotations/new" className={buttonVariants({ size: "sm" })}>
            <Plus className="mr-1 h-4 w-4" /> Quotation
          </Link>
        </div>
      </div>

      {activeFilters > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {filters.client && <Chip label={`Client: ${filters.client.label}`} onClear={() => setParams({ client: null, client_name: null })} />}
          {filters.group && <Chip label="Client group" onClear={() => setParams({ group: null })} />}
          {filters.from && <Chip label={`From ${fmtDate(filters.from)}`} onClear={() => setParams({ from: null })} />}
          {filters.to && <Chip label={`To ${fmtDate(filters.to)}`} onClear={() => setParams({ to: null })} />}
        </div>
      )}

      {error && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">{error}</div>}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <div className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={allSelected}
                    disabled={!convertible.length}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(convertible.map((r) => r.id)))}
                    aria-label="Select all convertible quotations on this page"
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger className="rounded p-0.5 hover:bg-muted cursor-pointer" aria-label="Choose columns">
                      <Columns3 className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-44">
                      {COLUMNS.map((c) => (
                        <DropdownMenuCheckboxItem key={c.id} checked={show(c.id)} onCheckedChange={() => toggleCol(c.id)}>
                          {c.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </th>
              {show("quote_no") && <th className="px-3 py-2 text-left font-medium">Quo No.</th>}
              {show("invoice_no") && <th className="px-3 py-2 text-left font-medium">Invoice No.</th>}
              {show("client") && <th className="px-3 py-2 text-left font-medium">Client Name</th>}
              {show("client_no") && <th className="px-3 py-2 text-left font-medium">Client No.</th>}
              {show("firm") && <th className="px-3 py-2 text-left font-medium">Firm Name</th>}
              {show("date") && <th className="px-3 py-2 text-left font-medium">Quo. Date</th>}
              {show("amount") && <th className="px-3 py-2 text-right font-medium">Quo. Amount</th>}
              {show("status") && <th className="px-3 py-2 text-left font-medium">Status</th>}
              <th className="w-12 px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length ? (
              <tr>
                <td colSpan={10} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                  {filters.q || activeFilters || filters.status !== "all" ? "No quotations match." : "No quotations yet."}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const editable = r.status === "draft" || r.status === "final";
                const sent = !!(r.sent_whatsapp_at || r.sent_at || r.sent_email_at);
                return (
                  <tr key={r.id} className={cn("border-t hover:bg-muted/30", loading && "opacity-60", r.status === "cancelled" && "text-muted-foreground")}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        disabled={!editable}
                        checked={selected.has(r.id)}
                        onChange={() =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (n.has(r.id)) n.delete(r.id);
                            else n.add(r.id);
                            return n;
                          })
                        }
                        aria-label={`Select ${r.quote_number}`}
                      />
                    </td>
                    {show("quote_no") && (
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link href={editable ? `/billing/quotations/${r.id}/edit` : `/quote/${r.public_token}`} target={editable ? undefined : "_blank"} className="font-mono text-xs font-semibold text-primary hover:underline">
                          {r.quote_number}
                        </Link>
                        {sent && <CheckCheck className="ml-1 inline h-3.5 w-3.5 text-sky-500" aria-label="Sent to client" />}
                        {(r.revision ?? 0) > 0 && <span className="ml-1 text-[10px] text-muted-foreground">Rev {r.revision}</span>}
                      </td>
                    )}
                    {show("invoice_no") && <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.converted_invoice?.invoice_number ?? "—"}</td>}
                    {show("client") && (
                      <td className="max-w-[220px] px-3 py-2">
                        <div className="truncate font-medium">{clientLabel(r)}</div>
                        {r.accepted_at && r.status === "final" && <div className="text-[10px] text-emerald-600">Accepted by client</div>}
                      </td>
                    )}
                    {show("client_no") && <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{clientPhone(r)}</td>}
                    {show("firm") && <td className="max-w-[160px] truncate px-3 py-2 text-muted-foreground">{r.firm?.name ?? "—"}</td>}
                    {show("date") && <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(r.issue_date)}</td>}
                    {show("amount") && <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{fmtINR(Number(r.total_amount))}</td>}
                    {show("status") && (
                      <td className="px-3 py-2">
                        <StatusPill row={r} onChanged={load} />
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Actions for ${r.quote_number}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="w-52 text-xs">
                          <DropdownMenuItem onClick={() => window.open(`/api/quotations/${r.id}/pdf`, "_blank")}>
                            <Download className="mr-2 h-3.5 w-3.5" /> Download
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => window.open(`/quote/${r.public_token}`, "_blank")}>
                            <ExternalLink className="mr-2 h-3.5 w-3.5" /> View
                          </DropdownMenuItem>
                          {r.status !== "cancelled" && (
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
                          {editable && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setConvertIds([r.id])}>
                                <ArrowRight className="mr-2 h-3.5 w-3.5" /> Convert to Invoice
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => router.push(`/billing/quotations/${r.id}/edit`)}>
                                <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => cancelQuote(r)}>
                                <XCircle className="mr-2 h-3.5 w-3.5" /> Cancel Quotation
                              </DropdownMenuItem>
                            </>
                          )}
                          {r.status !== "invoiced" && (
                            <DropdownMenuItem onClick={() => deleteQuote(r)} className="text-destructive">
                              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete Quotation
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

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {total ? `${(filters.page - 1) * pageSize + 1}–${Math.min(filters.page * pageSize, total)} of ${total}` : "0 quotations"}
        </span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" disabled={filters.page <= 1} onClick={() => setParams({ page: String(filters.page - 1) }, false)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-2 tabular-nums">
            Page {filters.page} of {pages}
          </span>
          <Button size="sm" variant="outline" disabled={filters.page >= pages} onClick={() => setParams({ page: String(filters.page + 1) }, false)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <FilterDrawer
        open={filterOpen}
        onOpenChange={setFilterOpen}
        value={filters}
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
      <EmailDialog quotation={emailFor} onOpenChange={(o) => !o && setEmailFor(null)} onSent={load} />
      <ConvertDialog open={!!convertIds} onOpenChange={(o) => !o && setConvertIds(null)} ids={convertIds ?? []} total={total} onDone={load} />
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5">
      {label}
      <button type="button" onClick={onClear} className="rounded-full text-muted-foreground hover:text-foreground cursor-pointer" aria-label={`Clear ${label}`}>
        <XCircle className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
