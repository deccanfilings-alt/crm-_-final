// GET  /api/billing/quotations   the Quotation list (filters, counts, page)
// POST /api/billing/quotations   create from the WebLedger-style form.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse } from "@/lib/billing/api";
import { persistQuotation } from "@/lib/billing/quotation-persist";
import { parseQuotationListFilters, quotationSearchExpr, QUOTATION_STATUSES } from "@/lib/billing/quotation-list";

const LIST_FIELDS =
  "id, quote_number, title, status, issue_date, valid_until, total_amount, client_name, client_company, client_phone, " +
  "contact_id, billed_to, public_token, sent_at, sent_whatsapp_at, sent_email_at, accepted_at, revision, firm_id, " +
  "converted_invoice_id, converted_invoice:invoices!quotations_converted_invoice_id_fkey(invoice_number, invoice_type), " +
  "firm:billing_firms(name)";

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("viewer");
    const f = parseQuotationListFilters(new URL(request.url).searchParams);

    // Client group = a contact tag: filter through quotation -> contact -> tag.
    const groupJoin = f.groupId ? ", grp:contacts!inner(tags:contact_tags!inner(tag_id))" : "";

    // Same filters for the rows and for each status count.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apply = (query: any) => {
      query = query.eq("account_id", ctx.accountId).is("deleted_at", null);
      if (f.q) query = query.or(quotationSearchExpr(f.q));
      if (f.clientId) query = query.eq("contact_id", f.clientId);
      if (f.groupId) query = query.eq("grp.tags.tag_id", f.groupId);
      if (f.from) query = query.gte("issue_date", f.from);
      if (f.to) query = query.lte("issue_date", f.to);
      return query;
    };

    const start = (f.page - 1) * f.pageSize;
    let rowsQuery = apply(ctx.supabase.from("quotations").select(LIST_FIELDS + groupJoin, { count: "exact" }));
    if (f.status !== "all") rowsQuery = rowsQuery.eq("status", f.status);
    rowsQuery = rowsQuery
      .order("issue_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(start, start + f.pageSize - 1);

    const [rows, ...counts] = await Promise.all([
      rowsQuery,
      ...QUOTATION_STATUSES.map((st) =>
        apply(ctx.supabase.from("quotations").select("id" + groupJoin, { count: "exact", head: true })).eq("status", st),
      ),
    ]);
    if (rows.error) return dbErrorResponse(rows.error, "load quotations");
    const byStatus = Object.fromEntries(QUOTATION_STATUSES.map((st, i) => [st, counts[i].count ?? 0]));
    const all = Object.values(byStatus).reduce((a: number, b) => a + Number(b), 0);

    return NextResponse.json({
      rows: rows.data ?? [],
      total: rows.count ?? 0,
      counts: { all, ...byStatus },
      page: f.page,
      page_size: f.pageSize,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await persistQuotation(ctx, null, body);
    if (result instanceof NextResponse) return result;
    return NextResponse.json({ quotation: { id: result.id, quote_number: result.quote_number, status: result.status } }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
