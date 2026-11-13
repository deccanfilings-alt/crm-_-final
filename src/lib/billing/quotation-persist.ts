// Shared by POST /api/billing/quotations and PUT /api/billing/quotations/:id:
// validate -> compute totals -> one transactional save -> optionally
// copy the Billed To details back to the client.
import { NextResponse } from "next/server";
import type { AccountContext } from "@/lib/auth/account";
import { dbErrorResponse } from "./api";
import { buildQuotationSave, validateQuotationInput, type QuotationFormInput } from "./quotation-save";

export async function persistQuotation(
  ctx: AccountContext,
  quotationId: string | null,
  body: Record<string, unknown>,
): Promise<NextResponse | { id: string; quote_number: string; status: string; total_amount: number; input: QuotationFormInput }> {
  const v = validateQuotationInput(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const input = v.value;

  const { data: firm, error: firmErr } = await ctx.supabase
    .from("billing_firms")
    .select("id, tax_type, state, gstin")
    .eq("account_id", ctx.accountId)
    .eq("is_default", true)
    .maybeSingle();
  if (firmErr) return dbErrorResponse(firmErr, "save the quotation");
  if (!firm) {
    return NextResponse.json({ error: "Set up your company first: Settings → Billing → Company & Bank." }, { status: 409 });
  }

  const { doc, items, ledgers } = buildQuotationSave(input, {
    id: firm.id,
    tax_type: firm.tax_type === "NONE" ? "NONE" : "GST",
    state: firm.state,
    gstin: firm.gstin,
  });

  const { data, error } = await ctx.supabase.rpc("billing_save_quotation", {
    p_id: quotationId,
    p_doc: doc,
    p_items: items,
    p_ledgers: ledgers,
    p_running_no: input.running_no,
  });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: error.message || "That quotation number is already used" }, { status: 409 });
    if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 409 });
    if (error.code === "P0002") return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    return dbErrorResponse(error, "save the quotation");
  }
  const saved = data as { id: string; quote_number: string; status: string };

  // Remember the client's billing details for next time (only fills
  // what the user entered; never blanks existing values).
  if (input.save_client_details && input.contact_id) {
    const to = input.billed_to;
    const patch: Record<string, string> = {};
    const put = (k: string, val: string | null | undefined) => {
      if (val) patch[k] = val;
    };
    put("address", to.address);
    put("city", to.city);
    put("state", to.state);
    put("pincode", to.pincode);
    put("gstin", to.gstin);
    put("pan", to.pan);
    put("cin", to.cin);
    put("email", to.email);
    if (to.contact_name && to.contact_name !== to.name) put("company", to.name);
    if (Object.keys(patch).length) {
      const { error: cErr } = await ctx.supabase
        .from("contacts")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", input.contact_id)
        .eq("account_id", ctx.accountId);
      if (cErr) console.warn("[billing/quotations] client details not saved:", cErr.message);
    }
  }

  return { ...saved, total_amount: doc.total_amount, input };
}
