"use client";

// ============================================================
// Create / Update Quotation, Proforma or Tax Invoice — WebLedger-style
// full-page form (one form for all three; `kind` picks labels, series,
// due date vs valid until, and the payment block for tax invoices).
//
//   header   < Create Quotation · Cancel · Save ▾ (Draft / Final)
//   left     Quotation details (firm, series, date, number, valid until)
//            Client details (search / new client)
//   right    Issued By · Billed To (editable for this document)
//   middle   Bill Details (particulars, SAC, qty, amount, discount, GST)
//   bottom   Notes & Terms | Totals (CGST/SGST/IGST, ledgers, round off)
//
// Totals preview uses the same engine as the server (lib/billing/calc).
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronLeft, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { calculateBilling } from "@/lib/billing/calc";
import { ParticularDialog, type Particular } from "@/components/settings/billing/particular-dialog";
import { ClientPicker } from "./client-picker";
import { PartyCard } from "./party-card";
import { BillDetailsTable } from "./bill-details-table";
import { TotalsPanel } from "./totals-panel";
import { AttachTasksDialog } from "./attach-tasks-dialog";
import {
  blankItem,
  newKey,
  partyFromClient,
  partyFromFirm,
  type Client,
  type Firm,
  type ItemRow,
  type LedgerOption,
  type LedgerRow,
  type Party,
  type SeriesOption,
} from "./types";

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Split "DF-QT-1026" / "TOR/26-27/QU103" into prefix + running number + suffix. */
function splitNumber(number: string, running: number | null): { prefix: string; running: string; suffix: string } {
  if (running != null) {
    const r = String(running);
    const i = number.lastIndexOf(r);
    if (i >= 0) return { prefix: number.slice(0, i), running: r, suffix: number.slice(i + r.length) };
  }
  const m = /^(.*?)(\d+)(\D*)$/.exec(number);
  return m ? { prefix: m[1], running: m[2], suffix: m[3] } : { prefix: number, running: "", suffix: "" };
}

export type DocKind = "quotation" | "proforma" | "tax_invoice";

const DOC: Record<DocKind, { name: string; short: string; api: string }> = {
  quotation: { name: "Quotation", short: "Quo.", api: "/api/billing/quotations" },
  proforma: { name: "Proforma Invoice", short: "Inv.", api: "/api/billing/invoices" },
  tax_invoice: { name: "Tax Invoice", short: "Inv.", api: "/api/billing/invoices" },
};

const PAYMENT_METHODS = [
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
];

interface Props {
  /** quotation (default), proforma or tax_invoice — same form, same engine. */
  kind?: DocKind;
  quotationId?: string;
  invoiceId?: string;
  initialContactId?: string | null;
  conversationId?: string | null;
  dealId?: string | null;
}

export function QuotationForm({ kind = "quotation", quotationId, invoiceId, initialContactId, conversationId, dealId }: Props) {
  const router = useRouter();
  const isInvoice = kind !== "quotation";
  const docId = isInvoice ? invoiceId : quotationId;
  const isEdit = !!docId;
  const L = DOC[kind];
  const listHref = isInvoice ? `/billing/invoices?type=${kind}` : "/billing/quotations";

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // Masters
  const [firm, setFirm] = useState<Firm | null>(null);
  const [seriesList, setSeriesList] = useState<SeriesOption[]>([]);
  const [gstRates, setGstRates] = useState<number[]>([]);
  const [ledgerOptions, setLedgerOptions] = useState<LedgerOption[]>([]);
  const [particulars, setParticulars] = useState<Particular[]>([]);

  // Header
  const [seriesId, setSeriesId] = useState<string>("");
  const [issueDate, setIssueDate] = useState(todayIST());
  const [validUntil, setValidUntil] = useState(addDays(todayIST(), 15));
  const [numPrefix, setNumPrefix] = useState("");
  const [numSuffix, setNumSuffix] = useState("");
  const [runningNo, setRunningNo] = useState("");
  const [numberTouched, setNumberTouched] = useState(false);
  const [existing, setExisting] = useState<{
    status: string;
    quote_number: string;
    series_id: string | null;
    sent: boolean;
    revision: number;
    accepted: boolean;
    paid: number;
  } | null>(null);

  // New tax invoice: payment already received?
  const [paymentReceived, setPaymentReceived] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState("upi");
  const [paymentRef, setPaymentRef] = useState("");
  const [paidOn, setPaidOn] = useState(todayIST());

  // Parties
  const [client, setClient] = useState<Client | null>(null);
  const [billedFrom, setBilledFrom] = useState<Party | null>(null);
  const [billedTo, setBilledTo] = useState<Party | null>(null);
  const [saveClient, setSaveClient] = useState(true);

  // Lines + totals
  const [rows, setRows] = useState<ItemRow[]>([blankItem()]);
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [discount, setDiscount] = useState("");
  const [roundOffAuto, setRoundOffAuto] = useState(true);
  const [roundOff, setRoundOff] = useState("0");

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [revisionReason, setRevisionReason] = useState("");
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);

  // Dialogs
  const [particularFor, setParticularFor] = useState<{ rowKey: string; name: string } | null>(null);
  const [tasksFor, setTasksFor] = useState<string | null>(null);

  // ---------------- load ----------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [fdRes, pRes, qRes, cRes] = await Promise.all([
          fetch(`/api/billing/quotations/form-data?date=${todayIST()}&type=${kind}`),
          fetch("/api/billing/particulars"),
          docId ? fetch(`${L.api}/${docId}`) : Promise.resolve(null),
          !docId && initialContactId ? fetch(`/api/billing/clients?id=${initialContactId}`) : Promise.resolve(null),
        ]);
        const fd = await fdRes.json().catch(() => ({}));
        if (!fdRes.ok) throw new Error(fd.error ?? "Could not load the form");
        const pj = await pRes.json().catch(() => ({}));
        if (cancelled) return;

        const f = fd.firm as Firm;
        setFirm(f);
        setSeriesList(fd.series ?? []);
        setGstRates(fd.gst_rates ?? []);
        setLedgerOptions(fd.ledgers ?? []);
        setParticulars(pRes.ok ? (pj.particulars ?? []) : []);
        setSignatureUrl(f.signature_url);
        setStampUrl(f.stamp_url);

        if (qRes) {
          const qj = await qRes.json().catch(() => ({}));
          if (!qRes.ok) throw new Error(qj.error ?? `${L.name} not found`);
          const q = isInvoice ? qj.invoice : qj.quotation;
          if (cancelled) return;
          const number: string = isInvoice ? q.invoice_number : q.quote_number;
          const parts = splitNumber(number, q.running_no);
          setExisting({
            status: q.status,
            quote_number: number,
            series_id: q.series_id,
            sent: q.status !== "draft" || !!q.sent_at,
            revision: Number(q.revision ?? 0),
            accepted: !!q.accepted_at,
            paid: Number(q.paid_amount ?? 0),
          });
          setSeriesId(q.series_id ?? "");
          setNumPrefix(parts.prefix);
          setNumSuffix(parts.suffix);
          setRunningNo(parts.running);
          setIssueDate(q.issue_date ?? todayIST());
          setValidUntil((isInvoice ? q.due_date : q.valid_until) ?? "");
          setTitle(q.title ?? "");
          setNotes(q.notes ?? "");
          setTerms(q.terms ?? "");
          setSignatureUrl(q.signature_url ?? f.signature_url);
          setStampUrl(q.stamp_url ?? f.stamp_url);
          const from: Party = q.billed_from ?? partyFromFirm(f);
          setBilledFrom({ ...partyFromFirm(f), ...from });
          const to: Party = q.billed_to ?? {
            name: q.client_company || q.client_name,
            contact_name: q.client_company ? q.client_name : null,
            address: q.client_address,
            phone: q.client_phone,
            email: q.client_email,
            gstin: q.client_gstin,
          };
          setBilledTo(to);
          if (q.contact_id) {
            setClient({
              id: q.contact_id,
              name: to.contact_name ?? to.name,
              company: to.contact_name ? to.name : null,
              phone: to.phone ?? null,
              email: to.email ?? null,
              address: to.address ?? null,
              city: to.city ?? null,
              state: to.state ?? null,
              pincode: to.pincode ?? null,
              gstin: to.gstin ?? null,
              pan: to.pan ?? null,
              cin: to.cin ?? null,
              proprietor_name: null,
            });
          }
          setRows(
            (q.items ?? []).length
              ? q.items.map((it: Record<string, unknown>) => ({
                  key: newKey(),
                  particular_id: (it.particular_id as string) ?? null,
                  title: String(it.title ?? ""),
                  description: String(it.description ?? ""),
                  service_name: String(it.service_name ?? ""),
                  sac_code: String(it.sac_code ?? ""),
                  quantity: String(Number(it.quantity ?? 1)),
                  unit_price: String(Number(it.unit_price ?? 0)),
                  discount_value: Number(it.discount_value ?? 0) ? String(Number(it.discount_value)) : "",
                  discount_type: it.discount_type === "PERCENT" ? "PERCENT" : "INR",
                  gst_rate: String(Number(it.gst_rate ?? it.tax_rate ?? 0)),
                  linked_task_ids: (it.linked_task_ids as string[]) ?? [],
                }))
              : [blankItem(Number(f.default_gst_rate) || 18)],
          );
          setLedgers(
            (q.ledger_lines ?? []).map((l: Record<string, unknown>) => ({
              key: newKey(),
              ledger_id: (l.ledger_id as string) ?? null,
              ledger_name: String(l.ledger_name ?? ""),
              amount: String(Number(l.amount ?? 0)),
            })),
          );
          setDiscount(Number(q.discount_amount) ? String(Number(q.discount_amount)) : "");
          // A saved round off that isn't "nearest rupee" was typed by hand: keep it manual.
          const savedRound = Number(q.round_off ?? 0);
          const suggested = calculateBilling({
            items: (q.items ?? []).map((it: Record<string, unknown>) => ({
              quantity: it.quantity as number,
              unit_price: it.unit_price as number,
              discount_value: it.discount_value as number,
              discount_type: it.discount_type === "PERCENT" ? "PERCENT" : "INR",
              gst_rate: (it.gst_rate ?? it.tax_rate) as number,
            })),
            ledgers: (q.ledger_lines ?? []).map((l: Record<string, unknown>) => ({ amount: l.amount as number })),
            docDiscount: q.discount_amount,
            firmTaxType: f.tax_type,
            firmState: from.state ?? f.state,
            clientState: to.state,
            clientGstin: to.gstin,
          }).suggestedRoundOff;
          const manual = Math.abs(suggested - savedRound) > 0.001;
          setRoundOffAuto(!manual);
          setRoundOff(String(savedRound));
        } else {
          const def = (fd.series as SeriesOption[]).find((s) => s.is_default) ?? fd.series?.[0];
          setSeriesId(def?.id ?? "");
          setNumPrefix(def?.preview?.prefix ?? "");
          setNumSuffix(def?.preview?.suffix ?? "");
          setRunningNo(def?.preview?.running_no != null ? String(def.preview.running_no) : "");
          setBilledFrom(partyFromFirm(f));
          setTerms(f.terms_and_conditions ?? "");
          setRows([blankItem(Number(f.default_gst_rate) || 18)]);
          if (f.credit_period_days > 0) setValidUntil(addDays(todayIST(), f.credit_period_days));
          else if (isInvoice) setValidUntil(addDays(todayIST(), 7));
          if (cRes) {
            const cj = await cRes.json().catch(() => ({}));
            const c = (cj.clients ?? [])[0] as Client | undefined;
            if (c && !cancelled) {
              setClient(c);
              setBilledTo(partyFromClient(c));
            }
          }
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load the form");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, kind]);

  // ---------------- live totals ----------------
  const totals = useMemo(
    () =>
      calculateBilling({
        items: rows.map((r) => ({
          quantity: r.quantity === "" ? 0 : r.quantity,
          unit_price: r.unit_price,
          discount_value: r.discount_value,
          discount_type: r.discount_type,
          gst_rate: r.gst_rate,
        })),
        ledgers: ledgers.map((l) => ({ amount: l.amount })),
        docDiscount: discount,
        roundOff: roundOffAuto ? null : roundOff,
        firmTaxType: firm?.tax_type ?? "GST",
        firmState: billedFrom?.state ?? firm?.state,
        firmGstin: billedFrom?.gstin ?? firm?.gstin,
        clientState: billedTo?.state,
        clientGstin: billedTo?.gstin,
      }),
    [rows, ledgers, discount, roundOffAuto, roundOff, firm, billedFrom, billedTo],
  );

  // ---------------- number preview ----------------
  const refreshPreview = useCallback(
    async (sid: string, date: string) => {
      if (!sid) return;
      try {
        const res = await fetch(`/api/billing/series/${sid}/preview?date=${date}`);
        const json = await res.json().catch(() => ({}));
        const p = json.preview as SeriesOption["preview"];
        if (!res.ok || !p) return;
        setNumPrefix(p.prefix ?? "");
        setNumSuffix(p.suffix ?? "");
        if (!numberTouched && p.running_no != null) setRunningNo(String(p.running_no));
      } catch {
        // keep showing the last preview
      }
    },
    [numberTouched],
  );

  const numberChangesOnSave = !isEdit || numberTouched || (existing && seriesId !== (existing.series_id ?? ""));

  const onSeriesChange = (sid: string) => {
    setSeriesId(sid);
    setNumberTouched(false);
    void refreshPreview(sid, issueDate);
  };
  const onDateChange = (d: string) => {
    setIssueDate(d);
    if (!isEdit) void refreshPreview(seriesId, d);
  };

  // ---------------- client ----------------
  const onClient = (c: Client | null) => {
    setClient(c);
    setBilledTo(c ? partyFromClient(c) : null);
  };

  // ---------------- rows ----------------
  const patchRow = (key: string, patch: Partial<ItemRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // ---------------- save ----------------
  const readOnly = !!existing && (existing.status === "invoiced" || existing.status === "cancelled");

  const save = async (status: "draft" | "final") => {
    setShowErrors(true);
    if (!billedTo?.name) {
      toast.error("Pick a client first");
      return;
    }
    if (rows.some((r) => !r.title.trim())) {
      toast.error("Every row needs a particular");
      return;
    }
    if (rows.some((r) => r.unit_price === "" || Number(r.unit_price) < 0)) {
      toast.error("Every row needs a service amount");
      return;
    }
    if (!billedFrom) return;
    setSaving(true);
    try {
      const body = {
        status,
        series_id: seriesId || null,
        running_no: numberChangesOnSave && numberTouched && runningNo !== "" ? Number(runningNo) : null,
        issue_date: issueDate,
        ...(isInvoice
          ? {
              invoice_type: kind,
              due_date: kind === "tax_invoice" && !isEdit && paymentReceived ? null : validUntil || null,
              payment_received: kind === "tax_invoice" && !isEdit ? paymentReceived : false,
              payment_method: paymentMethod,
              payment_reference: paymentRef || null,
              paid_on: paidOn || null,
            }
          : { valid_until: validUntil || null }),
        contact_id: client?.id ?? null,
        conversation_id: conversationId ?? null,
        deal_id: dealId ?? null,
        title: title.trim() || rows[0].title,
        billed_from: billedFrom,
        billed_to: billedTo,
        items: rows.map((r) => ({
          particular_id: r.particular_id,
          title: r.title,
          description: r.description,
          service_name: r.service_name,
          sac_code: r.sac_code,
          quantity: r.quantity || 1,
          unit_price: r.unit_price || 0,
          discount_value: r.discount_value || 0,
          discount_type: r.discount_type,
          gst_rate: r.gst_rate || 0,
          linked_task_ids: r.linked_task_ids,
        })),
        ledgers: ledgers.map((l) => ({ ledger_id: l.ledger_id, ledger_name: l.ledger_name, amount: l.amount || 0 })),
        doc_discount: discount || 0,
        round_off: roundOffAuto ? null : roundOff,
        notes,
        terms,
        signature_url: signatureUrl,
        stamp_url: stampUrl,
        save_client_details: saveClient,
        revision_reason: revisionReason || null,
      };
      const res = await fetch(isEdit ? `${L.api}/${docId}` : L.api, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? `Could not save the ${L.name.toLowerCase()}`);
        return;
      }
      const q = isInvoice
        ? { quote_number: json.invoice.invoice_number as string, status: json.invoice.status as string }
        : (json.quotation as { quote_number: string; status: string });
      toast.success(
        isEdit
          ? json.revision
            ? `${q.quote_number} updated — now Rev ${json.revision}`
            : `${q.quote_number} updated`
          : `${L.name} ${q.quote_number} saved${q.status === "draft" ? " as Draft" : isInvoice ? "" : " as Final"}`,
      );
      if (json.reopened) toast.info("Prices changed, so the client's earlier acceptance was cleared.");
      router.push(listHref);
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  // ---------------- render ----------------
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-xl space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-sm">
        <p>{loadError}</p>
        <Link href={listHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back
        </Link>
      </div>
    );
  }

  const taxed = firm?.tax_type !== "NONE";
  const heading = isEdit ? `Update ${L.name} ${existing?.quote_number ?? ""}` : `Create ${L.name}`;

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-10">
      {/* Header bar */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={listHref} aria-label="Back" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 w-8 p-0")}>
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h2 className="truncate text-lg font-semibold">{heading}</h2>
          {existing && (
            <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
              {existing.status}
              {existing.revision > 0 ? ` · Rev ${existing.revision}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href={listHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Cancel
          </Link>
          {!readOnly &&
            (existing && existing.status !== "draft" ? (
              <Button size="sm" onClick={() => save("final")} disabled={saving}>
                {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Save
              </Button>
            ) : (
              <div className="flex">
                <Button size="sm" className="rounded-r-none" onClick={() => save("final")} disabled={saving}>
                  {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Save
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={saving}
                    render={
                      <Button size="sm" className="rounded-l-none border-l border-primary-foreground/20 px-2" aria-label="More save options">
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => save("draft")} className="cursor-pointer">
                      Save as Draft
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => save("final")} className="cursor-pointer">
                      Save as Final
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          This {L.name.toLowerCase()} is {existing?.status} and can&apos;t be edited.
        </div>
      )}

      {existing?.sent && !readOnly && (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <p>
            This {L.name.toLowerCase()} has already gone to the client. Saving creates{" "}
            <span className="font-semibold">Rev {existing.revision + 1}</span>; the previous version is kept in the history.
            {existing.accepted && " The client accepted it — changing prices clears that acceptance."}
            {existing.paid > 0 && ` ₹${existing.paid.toLocaleString("en-IN")} is already paid, so the total can't go below that.`}
          </p>
          <Input
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
            placeholder="What changed? (optional) e.g. Client asked to remove trademark filing"
            maxLength={300}
            className="h-8 text-xs"
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-4">
          <section className="rounded-xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">{L.name} details</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">Firm Name *</Label>
                <Input value={firm?.name ?? ""} disabled className="h-9" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="q-series" className="text-xs">
                  {L.name} Series *
                </Label>
                <select
                  id="q-series"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                  value={seriesId}
                  disabled={readOnly}
                  onChange={(e) => onSeriesChange(e.target.value)}
                >
                  {!seriesId && <option value="">— Legacy numbering —</option>}
                  {seriesList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.is_default ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="q-date" className="text-xs">
                  {L.short} Date *
                </Label>
                <Input id="q-date" type="date" className="h-9" value={issueDate} disabled={readOnly} onChange={(e) => onDateChange(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="q-no" className="text-xs">
                  {L.name} No.
                </Label>
                <div className="flex h-9 items-center overflow-hidden rounded-md border border-input">
                  {numPrefix && <span className="bg-muted px-2 font-mono text-xs leading-9 text-muted-foreground">{numPrefix}</span>}
                  <input
                    id="q-no"
                    inputMode="numeric"
                    className="h-full min-w-0 flex-1 bg-background px-2 font-mono text-sm outline-none disabled:opacity-60"
                    value={runningNo}
                    disabled={readOnly}
                    onChange={(e) => {
                      setRunningNo(e.target.value.replace(/\D/g, ""));
                      setNumberTouched(true);
                    }}
                  />
                  {numSuffix && <span className="bg-muted px-2 font-mono text-xs leading-9 text-muted-foreground">{numSuffix}</span>}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {numberTouched ? "You chose this number — it must not be used already." : isEdit ? "Kept on save." : "Next free number; you can change it."}
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="q-valid" className="text-xs">
                  {isInvoice ? "Due Date" : "Valid Until"}
                </Label>
                <Input
                  id="q-valid"
                  type="date"
                  className="h-9"
                  min={issueDate}
                  value={kind === "tax_invoice" && !isEdit && paymentReceived ? "" : validUntil}
                  disabled={readOnly || (kind === "tax_invoice" && !isEdit && paymentReceived)}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="q-title" className="text-xs">
                  Subject
                </Label>
                <Input id="q-title" className="h-9" value={title} disabled={readOnly} onChange={(e) => setTitle(e.target.value)} placeholder={rows[0]?.title || "e.g. GST Registration"} />
              </div>
            </div>
          </section>

          <section className="rounded-xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Client details</h3>
            <Label className="mb-1.5 block text-xs">Client *</Label>
            <ClientPicker value={client} onChange={onClient} disabled={readOnly} />
            {showErrors && !billedTo && <p className="mt-1 text-xs text-destructive">Pick a client.</p>}
          </section>

          {kind === "tax_invoice" && !isEdit && (
            <section className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={paymentReceived} onChange={(e) => setPaymentReceived(e.target.checked)} />
                Payment already received (mark PAID)
              </label>
              {paymentReceived ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="pay-method" className="text-xs">Payment method</Label>
                    <select id="pay-method" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="pay-ref" className="text-xs">UTR / reference</Label>
                    <Input id="pay-ref" className="h-9" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="pay-on" className="text-xs">Paid on</Label>
                    <Input id="pay-on" type="date" className="h-9" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Saved as Unpaid with a due date; record the payment when it arrives.</p>
              )}
            </section>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <PartyCard
            title="Issued By"
            nameLabel="Billed From"
            value={billedFrom}
            onChange={setBilledFrom}
            fields={["address", "state", "phone", "email", "gstin", "pan", "cin"]}
            emptyText="Set up your company in Settings → Billing."
            disabled={readOnly}
          />
          <PartyCard
            title="Billed To"
            nameLabel="Billed To"
            value={billedTo}
            onChange={setBilledTo}
            fields={["contact_name", "address", "city", "state", "pincode", "phone", "email", "gstin", "pan", "cin"]}
            emptyText="Pick a client to fill this in."
            disabled={readOnly}
            footer={
              client && !readOnly ? (
                <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={saveClient} onChange={(e) => setSaveClient(e.target.checked)} />
                  Also save address, state, GSTIN and PAN to this client
                </label>
              ) : null
            }
          />
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Bill Details *</h3>
        <BillDetailsTable
          rows={rows}
          totals={totals}
          particulars={particulars}
          gstRates={gstRates}
          taxed={taxed}
          disabled={readOnly}
          showErrors={showErrors}
          onChange={patchRow}
          onAdd={() => setRows((rs) => [...rs, blankItem(Number(firm?.default_gst_rate) || 18)])}
          onRemove={(key) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs))}
          onCreateParticular={(rowKey, name) => setParticularFor({ rowKey, name })}
          onAttachTasks={(rowKey) => setTasksFor(rowKey)}
          canAttachTasks={!!client}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="q-notes" className="text-xs">
              Notes
            </Label>
            <Textarea id="q-notes" rows={3} value={notes} disabled={readOnly} onChange={(e) => setNotes(e.target.value)} placeholder={`Shown on the ${L.name.toLowerCase()}`} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="q-terms" className="text-xs">
              Terms &amp; Conditions
            </Label>
            <Textarea id="q-terms" rows={5} value={terms} disabled={readOnly} onChange={(e) => setTerms(e.target.value)} />
          </div>
        </section>
        <TotalsPanel
          totals={totals}
          taxed={taxed}
          ledgerOptions={ledgerOptions}
          ledgers={ledgers}
          onLedgers={setLedgers}
          discount={discount}
          onDiscount={setDiscount}
          roundOffAuto={roundOffAuto}
          roundOff={roundOff}
          onRoundOff={(auto, v) => {
            setRoundOffAuto(auto);
            setRoundOff(auto ? String(totals.suggestedRoundOff) : v);
          }}
          disabled={readOnly}
        />
      </div>

      <ParticularDialog
        open={!!particularFor}
        onOpenChange={(o) => !o && setParticularFor(null)}
        initialName={particularFor?.name}
        gstRates={gstRates}
        onSaved={(p) => {
          setParticulars((ps) => [...ps, p].sort((a, b) => a.name.localeCompare(b.name)));
          if (particularFor) {
            patchRow(particularFor.rowKey, {
              particular_id: p.id,
              title: p.name,
              description: p.description ?? "",
              service_name: p.service_name ?? "",
              sac_code: p.sac_code ?? "",
              unit_price: p.default_amount != null ? String(Number(p.default_amount)) : "",
              gst_rate: p.gst_rate != null ? String(Number(p.gst_rate)) : "18",
            });
          }
          setParticularFor(null);
        }}
      />
      <AttachTasksDialog
        open={!!tasksFor}
        onOpenChange={(o) => !o && setTasksFor(null)}
        clientId={client?.id ?? null}
        selected={rows.find((r) => r.key === tasksFor)?.linked_task_ids ?? []}
        onSave={(ids) => tasksFor && patchRow(tasksFor, { linked_task_ids: ids })}
      />
    </div>
  );
}
