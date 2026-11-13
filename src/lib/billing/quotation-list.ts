// Quotation list filters (pure parsing; shared by the API and tests).

export const QUOTATION_STATUSES = ["draft", "final", "invoiced", "cancelled"] as const;
export type QuotationListStatus = (typeof QUOTATION_STATUSES)[number] | "all";

export interface QuotationListFilters {
  status: QuotationListStatus;
  q: string | null;
  clientId: string | null;
  groupId: string | null;
  from: string | null;
  to: string | null;
  page: number;
  pageSize: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseQuotationListFilters(sp: URLSearchParams): QuotationListFilters {
  const status = sp.get("status");
  const page = Math.max(1, Math.floor(Number(sp.get("page")) || 1));
  const size = Math.floor(Number(sp.get("page_size")) || 25);
  const date = (k: string) => {
    const v = sp.get(k);
    return v && DATE.test(v) ? v : null;
  };
  const id = (k: string) => {
    const v = sp.get(k);
    return v && UUID.test(v) ? v : null;
  };
  // Strip characters that would break PostgREST's or() syntax.
  const q = (sp.get("q") ?? "").replace(/[%,()*]/g, "").trim().slice(0, 100) || null;
  return {
    status: (QUOTATION_STATUSES as readonly string[]).includes(status ?? "") ? (status as QuotationListStatus) : "all",
    q,
    clientId: id("client"),
    groupId: id("group"),
    from: date("from"),
    to: date("to"),
    page,
    pageSize: [10, 25, 50, 100].includes(size) ? size : 25,
  };
}

/** PostgREST or() expression for the search box. */
export function quotationSearchExpr(q: string): string {
  const digits = q.replace(/\D/g, "");
  const parts = [`quote_number.ilike.%${q}%`, `client_name.ilike.%${q}%`, `client_company.ilike.%${q}%`, `title.ilike.%${q}%`];
  if (digits.length >= 3) parts.push(`client_phone.ilike.%${digits}%`);
  return parts.join(",");
}
