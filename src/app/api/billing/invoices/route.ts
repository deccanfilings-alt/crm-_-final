// GET  /api/billing/invoices?type=proforma|tax_invoice  the invoice list
//      (filters, status counts, page)
// POST /api/billing/invoices  create a proforma / tax invoice from the form.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse } from "@/lib/billing/api";
import { persistInvoice } from "@/lib/billing/invoice-persist";
import { INVOICE_STATUSES, invoiceSearchExpr, parseInvoiceListFilters } from "@/lib/billing/invoice-list";

const LIST_FIELDS =
  "id, invoice_number, invoice_type, title, status, issue_date, due_date, total_amount, paid_amount, balance_amount, " +
  "client_name, client_company, client_phone, contact_id, billed_to, public_token, sent_at, sent_whatsapp_at, sent_email_at, " +
  "revision, quotation_id, source_invoice_id, cancelled_at, cancel_reason, payment_method, payment_reference, paid_at, " +
  "quotation:quotations!invoices_quotation_id_fkey(quote_number), firm:billing_firms(name)";

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("viewer");
    const f = parseInvoiceListFilters(new URL(request.url).searchParams);
    const groupJoin = f.groupId ? ", grp:contacts!inner(tags:contact_tags!inner(tag_id))" : "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apply = (query: any) => {
      query = query.eq("account_id", ctx.accountId).eq("invoice_type", f.type).is("deleted_at", null);
      if (f.q) query = query.or(invoiceSearchExpr(f.q));
      if (f.clientId) query = query.eq("contact_id", f.clientId);
      if (f.groupId) query = query.eq("grp.tags.tag_id", f.groupId);
      if (f.from) query = query.gte("issue_date", f.from);
      if (f.to) query = query.lte("issue_date", f.to);
      if (f.dueFrom) query = query.gte("due_date", f.dueFrom);
      if (f.dueTo) query = query.lte("due_date", f.dueTo);
      if (f.overdue) query = query.lt("due_date", todayIST()).in("status", ["unpaid", "partially_paid"]);
      return query;
    };

    const start = (f.page - 1) * f.pageSize;
    let rowsQuery = apply(ctx.supabase.from("invoices").select(LIST_FIELDS + groupJoin, { count: "exact" }));
    if (f.status !== "all") rowsQuery = rowsQuery.eq("status", f.status);
    rowsQuery = rowsQuery
      .order("issue_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(start, start + f.pageSize - 1);

    const [rows, ...counts] = await Promise.all([
      rowsQuery,
      ...INVOICE_STATUSES.map((st) =>
        apply(ctx.supabase.from("invoices").select("id" + groupJoin, { count: "exact", head: true })).eq("status", st),
      ),
    ]);
    if (rows.error) return dbErrorResponse(rows.error, "load invoices");
    const byStatus = Object.fromEntries(INVOICE_STATUSES.map((st, i) => [st, counts[i].count ?? 0]));
    const all = Object.values(byStatus).reduce((a: number, b) => a + Number(b), 0);

    return NextResponse.json({ rows: rows.data ?? [], total: rows.count ?? 0, counts: { all, ...byStatus }, page: f.page, page_size: f.pageSize });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await persistInvoice(ctx, null, body);
    if (result instanceof NextResponse) return result;
    return NextResponse.json(
      { invoice: { id: result.id, invoice_number: result.invoice_number, invoice_type: result.invoice_type, status: result.status } },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
