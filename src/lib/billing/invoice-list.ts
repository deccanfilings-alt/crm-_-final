// Invoice list filters (pure; shared by the API and tests).

export const INVOICE_STATUSES = ["draft", "unpaid", "partially_paid", "paid", "cancelled"] as const;
export type InvoiceListStatus = (typeof INVOICE_STATUSES)[number] | "all";

export interface InvoiceListFilters {
  type: "proforma" | "tax_invoice";
  status: InvoiceListStatus;
  q: string | null;
  clientId: string | null;
  groupId: string | null;
  from: string | null;
  to: string | null;
  dueFrom: string | null;
  dueTo: string | null;
  overdue: boolean;
  page: number;
  pageSize: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseInvoiceListFilters(sp: URLSearchParams): InvoiceListFilters {
  const date = (k: string) => {
    const v = sp.get(k);
    return v && DATE.test(v) ? v : null;
  };
  const id = (k: string) => {
    const v = sp.get(k);
    return v && UUID.test(v) ? v : null;
  };
  const status = sp.get("status");
  const size = Math.floor(Number(sp.get("page_size")) || 25);
  return {
    type: sp.get("type") === "tax_invoice" ? "tax_invoice" : "proforma",
    status: (INVOICE_STATUSES as readonly string[]).includes(status ?? "") ? (status as InvoiceListStatus) : "all",
    q: (sp.get("q") ?? "").replace(/[%,()*]/g, "").trim().slice(0, 100) || null,
    clientId: id("client"),
    groupId: id("group"),
    from: date("from"),
    to: date("to"),
    dueFrom: date("due_from"),
    dueTo: date("due_to"),
    overdue: sp.get("overdue") === "1",
    page: Math.max(1, Math.floor(Number(sp.get("page")) || 1)),
    pageSize: [10, 25, 50, 100].includes(size) ? size : 25,
  };
}

export function invoiceSearchExpr(q: string): string {
  const digits = q.replace(/\D/g, "");
  const parts = [`invoice_number.ilike.%${q}%`, `client_name.ilike.%${q}%`, `client_company.ilike.%${q}%`, `title.ilike.%${q}%`, `payment_reference.ilike.%${q}%`];
  if (digits.length >= 3) parts.push(`client_phone.ilike.%${digits}%`);
  return parts.join(",");
}
