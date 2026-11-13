export type QStatus = "draft" | "final" | "invoiced" | "cancelled";

export interface QuotationRow {
  id: string;
  quote_number: string;
  title: string;
  status: QStatus;
  issue_date: string;
  valid_until: string | null;
  total_amount: number;
  client_name: string;
  client_company: string | null;
  client_phone: string | null;
  contact_id: string | null;
  billed_to: { name?: string; contact_name?: string | null; phone?: string | null } | null;
  public_token: string;
  sent_at: string | null;
  sent_whatsapp_at: string | null;
  sent_email_at: string | null;
  accepted_at: string | null;
  revision: number | null;
  converted_invoice_id: string | null;
  converted_invoice: { invoice_number: string; invoice_type: string } | null;
  firm: { name: string } | null;
}

export interface ListFilters {
  status: QStatus | "all";
  q: string;
  client: { id: string; label: string } | null;
  group: string;
  from: string;
  to: string;
  page: number;
}

export const STATUS_META: Record<QStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  final: { label: "Final", cls: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  invoiced: { label: "Invoiced", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  cancelled: { label: "Cancelled", cls: "border-rose-500/30 bg-rose-500/10 text-rose-600" },
};

export const COLUMNS = [
  { id: "quote_no", label: "Quo No." },
  { id: "invoice_no", label: "Invoice No." },
  { id: "client", label: "Client Name" },
  { id: "client_no", label: "Client No." },
  { id: "firm", label: "Firm Name" },
  { id: "date", label: "Quo. Date" },
  { id: "amount", label: "Quo. Amount" },
  { id: "status", label: "Status" },
] as const;
export type ColumnId = (typeof COLUMNS)[number]["id"];

export const fmtDate = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");
export const fmtINR = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function clientLabel(r: QuotationRow): string {
  return r.billed_to?.name || r.client_company || r.client_name || "—";
}

export function clientPhone(r: QuotationRow): string {
  const p = r.billed_to?.phone || r.client_phone || "";
  const d = p.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return p || "—";
}
