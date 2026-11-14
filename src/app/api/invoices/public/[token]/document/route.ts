// GET /api/invoices/public/:token/document[?print=1]
// The proforma / tax invoice for the client's link — same renderer as
// the staff PDF. ?print=1 adds the "Print / Save PDF" bar.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getQuotationSettings } from "@/lib/quotations/settings";
import { buildQuotationDocument, renderQuotationDocumentHtml } from "@/lib/billing/quotation-document";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!/^[0-9a-f]{16,64}$/i.test(token)) return new NextResponse("Not found", { status: 404 });
    const admin = supabaseAdmin();
    const { data: invoice, error } = await admin
      .from("invoices")
      .select("*, items:invoice_items(*), ledger_lines:invoice_ledger_lines(*)")
      .eq("public_token", token)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !invoice) return new NextResponse("Invoice not found", { status: 404 });

    const settings = await getQuotationSettings(admin, invoice.account_id);
    const print = new URL(request.url).searchParams.get("print") === "1";
    const html = renderQuotationDocumentHtml(buildQuotationDocument(invoice, settings), { printBar: print });
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "frame-ancestors 'self'",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (err) {
    console.error("[invoices/public/document] error:", err);
    return new NextResponse("Something went wrong", { status: 500 });
  }
}
