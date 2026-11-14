// Shared by POST /api/billing/invoices and PUT /api/billing/invoices/:id:
// validate -> totals -> one transactional save -> remember client details.
import { NextResponse } from "next/server";
import type { AccountContext } from "@/lib/auth/account";
import { dbErrorResponse } from "./api";
import { buildInvoiceSave, validateInvoiceInput, type InvoiceFormInput } from "./invoice-save";

export async function persistInvoice(
  ctx: AccountContext,
  invoiceId: string | null,
  body: Record<string, unknown>,
): Promise<
  | NextResponse
  | { id: string; invoice_number: string; invoice_type: string; status: string; total_amount: number; input: InvoiceFormInput }
> {
  const v = validateInvoiceInput(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const input = v.value;

  const { data: firm, error: firmErr } = await ctx.supabase
    .from("billing_firms")
    .select("id, tax_type, state, gstin")
    .eq("account_id", ctx.accountId)
    .eq("is_default", true)
    .maybeSingle();
  if (firmErr) return dbErrorResponse(firmErr, "save the invoice");
  if (!firm) {
    return NextResponse.json({ error: "Set up your company first: Settings → Billing → Company & Bank." }, { status: 409 });
  }

  const { doc, items, ledgers } = buildInvoiceSave(input, {
    id: firm.id,
    tax_type: firm.tax_type === "NONE" ? "NONE" : "GST",
    state: firm.state,
    gstin: firm.gstin,
  });

  const { data, error } = await ctx.supabase.rpc("billing_save_invoice", {
    p_id: invoiceId,
    p_doc: doc,
    p_items: items,
    p_ledgers: ledgers,
    p_running_no: input.running_no,
  });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: error.message || "That invoice number is already used" }, { status: 409 });
    if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 409 });
    if (error.code === "P0002") return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    return dbErrorResponse(error, "save the invoice");
  }
  const saved = data as { id: string; invoice_number: string; invoice_type: string; status: string };

  if (input.save_client_details && input.contact_id) {
    const to = input.billed_to;
    const patch: Record<string, string> = {};
    for (const [k, val] of Object.entries({
      address: to.address,
      city: to.city,
      state: to.state,
      pincode: to.pincode,
      gstin: to.gstin,
      pan: to.pan,
      cin: to.cin,
      email: to.email,
    })) {
      if (val) patch[k] = val;
    }
    if (to.contact_name && to.contact_name !== to.name) patch.company = to.name;
    if (Object.keys(patch).length) {
      const { error: cErr } = await ctx.supabase
        .from("contacts")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", input.contact_id)
        .eq("account_id", ctx.accountId);
      if (cErr) console.warn("[billing/invoices] client details not saved:", cErr.message);
    }
  }

  return { ...saved, total_amount: doc.total_amount, input };
}
