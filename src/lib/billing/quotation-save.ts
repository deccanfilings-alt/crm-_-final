// ============================================================
// New quotation form -> what billing_save_quotation() stores.
// Pure: validates the request and computes every total with the
// billing engine (calc.ts), so the database just persists numbers the
// tests have checked.
// ============================================================

import { calculateBilling, type DiscountType } from "./calc";
import { canonicalState, resolveState } from "./states";

export interface Party {
  name: string;
  contact_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  pan?: string | null;
  cin?: string | null;
  website?: string | null;
  logo_url?: string | null;
}

export interface FormItem {
  particular_id: string | null;
  title: string;
  description: string | null;
  service_name: string | null;
  sac_code: string | null;
  quantity: number;
  unit_price: number;
  discount_value: number;
  discount_type: DiscountType;
  gst_rate: number;
  linked_task_ids: string[];
}

export interface FormLedger {
  ledger_id: string | null;
  ledger_name: string;
  amount: number;
}

export interface QuotationFormInput {
  status: "draft" | "final";
  series_id: string | null;
  running_no: number | null;
  issue_date: string;
  valid_until: string | null;
  contact_id: string | null;
  deal_id: string | null;
  conversation_id: string | null;
  title: string;
  billed_from: Party;
  billed_to: Party;
  items: FormItem[];
  ledgers: FormLedger[];
  doc_discount: number;
  round_off: number | null;
  notes: string | null;
  terms: string | null;
  signature_url: string | null;
  stamp_url: string | null;
  save_client_details: boolean;
  revision_reason: string | null;
}

export interface FirmForCalc {
  id: string | null;
  tax_type: "GST" | "NONE";
  state: string | null;
  gstin: string | null;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const s = (v: unknown, max = 500): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
};
const n = (v: unknown, fallback = 0): number => {
  const x = Number(typeof v === "string" ? v.replace(/,/g, "") : v);
  return Number.isFinite(x) ? x : fallback;
};
const id = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

function party(v: unknown, required: string): Result<Party> {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const name = s(o.name, 200);
  if (!name) return { ok: false, error: required };
  const gstin = s(o.gstin, 15)?.toUpperCase() ?? null;
  if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) return { ok: false, error: `GSTIN "${gstin}" should be 15 letters/digits` };
  const pan = s(o.pan, 10)?.toUpperCase() ?? null;
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return { ok: false, error: `PAN "${pan}" doesn't look right` };
  const email = s(o.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: `Email "${email}" doesn't look right` };
  return {
    ok: true,
    value: {
      name,
      contact_name: s(o.contact_name, 200),
      address: s(o.address, 500),
      city: s(o.city, 100),
      state: canonicalState(s(o.state, 100)) ?? s(o.state, 100),
      pincode: s(o.pincode, 10),
      phone: s(o.phone, 30),
      email,
      gstin,
      pan,
      cin: s(o.cin, 21)?.toUpperCase() ?? null,
      website: s(o.website, 200),
      logo_url: s(o.logo_url, 1000),
    },
  };
}

export function validateQuotationInput(body: Record<string, unknown>): Result<QuotationFormInput> {
  const status = body.status === "final" ? "final" : "draft";
  const issue = s(body.issue_date, 10) ?? new Date().toISOString().slice(0, 10);
  if (!DATE.test(issue)) return { ok: false, error: "Quotation date is invalid" };
  const valid = s(body.valid_until, 10);
  if (valid && !DATE.test(valid)) return { ok: false, error: "Valid-until date is invalid" };
  if (valid && valid < issue) return { ok: false, error: "Valid-until can't be before the quotation date" };

  let running: number | null = null;
  if (body.running_no !== null && body.running_no !== undefined && body.running_no !== "") {
    running = Number(body.running_no);
    if (!Number.isInteger(running) || running < 0) return { ok: false, error: "Quotation number must be a whole number" };
  }

  const from = party(body.billed_from, "Issued By needs a name");
  if (!from.ok) return from;
  const to = party(body.billed_to, "Pick a client (Billed To needs a name)");
  if (!to.ok) return to;

  if (!Array.isArray(body.items) || body.items.length === 0) return { ok: false, error: "Add at least one line item" };
  if (body.items.length > 200) return { ok: false, error: "Too many line items" };
  const items: FormItem[] = [];
  for (const [i, raw] of body.items.entries()) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const title = s(it.title, 300);
    if (!title) return { ok: false, error: `Row ${i + 1}: pick or type a particular` };
    const qty = n(it.quantity, 1);
    const price = n(it.unit_price);
    const disc = n(it.discount_value);
    const gst = n(it.gst_rate);
    if (qty <= 0) return { ok: false, error: `Row ${i + 1}: quantity must be more than 0` };
    if (price < 0) return { ok: false, error: `Row ${i + 1}: amount can't be negative` };
    if (disc < 0) return { ok: false, error: `Row ${i + 1}: discount can't be negative` };
    if (gst < 0 || gst > 100) return { ok: false, error: `Row ${i + 1}: GST rate must be 0–100` };
    const discountType: DiscountType = it.discount_type === "PERCENT" ? "PERCENT" : "INR";
    if (discountType === "PERCENT" && disc > 100) return { ok: false, error: `Row ${i + 1}: discount can't be over 100%` };
    const sac = s(it.sac_code, 20);
    if (sac && !/^\d{4,8}$/.test(sac)) return { ok: false, error: `Row ${i + 1}: SAC code should be 4–8 digits` };
    items.push({
      particular_id: id(it.particular_id),
      title,
      description: s(it.description, 250),
      service_name: s(it.service_name, 200),
      sac_code: sac,
      quantity: qty,
      unit_price: price,
      discount_value: disc,
      discount_type: discountType,
      gst_rate: gst,
      linked_task_ids: Array.isArray(it.linked_task_ids) ? it.linked_task_ids.map(id).filter((x): x is string => !!x).slice(0, 50) : [],
    });
  }

  const ledgers: FormLedger[] = [];
  if (Array.isArray(body.ledgers)) {
    for (const raw of body.ledgers.slice(0, 50)) {
      const l = (raw ?? {}) as Record<string, unknown>;
      const name = s(l.ledger_name, 120);
      if (!name) return { ok: false, error: "Each ledger line needs a name" };
      ledgers.push({ ledger_id: id(l.ledger_id), ledger_name: name, amount: n(l.amount) });
    }
  }

  const discount = n(body.doc_discount);
  if (discount < 0) return { ok: false, error: "Discount can't be negative" };
  const roundOff = body.round_off === null || body.round_off === undefined || body.round_off === "" ? null : n(body.round_off);
  if (roundOff !== null && Math.abs(roundOff) >= 100) return { ok: false, error: "Round off looks too large" };

  return {
    ok: true,
    value: {
      status,
      series_id: id(body.series_id),
      running_no: running,
      issue_date: issue,
      valid_until: valid,
      contact_id: id(body.contact_id),
      deal_id: id(body.deal_id),
      conversation_id: id(body.conversation_id),
      title: s(body.title, 200) ?? items[0].title,
      billed_from: from.value,
      billed_to: to.value,
      items,
      ledgers,
      doc_discount: discount,
      round_off: roundOff,
      notes: s(body.notes, 2000),
      terms: s(body.terms, 5000),
      signature_url: s(body.signature_url, 1000),
      stamp_url: s(body.stamp_url, 1000),
      save_client_details: body.save_client_details !== false,
      revision_reason: s(body.revision_reason, 300),
    },
  };
}

/** Compute totals and shape the payload for billing_save_quotation(). */
export function buildQuotationSave(input: QuotationFormInput, firm: FirmForCalc) {
  const totals = calculateBilling({
    items: input.items,
    ledgers: input.ledgers,
    docDiscount: input.doc_discount,
    roundOff: input.round_off,
    firmTaxType: firm.tax_type,
    firmState: input.billed_from.state ?? firm.state,
    firmGstin: input.billed_from.gstin ?? firm.gstin,
    clientState: input.billed_to.state,
    clientGstin: input.billed_to.gstin,
  });
  const to = input.billed_to;
  const contactPerson = to.contact_name && to.contact_name !== to.name ? to.contact_name : null;

  const doc = {
    status: input.status,
    firm_id: firm.id,
    series_id: input.series_id,
    issue_date: input.issue_date,
    valid_until: input.valid_until,
    contact_id: input.contact_id,
    deal_id: input.deal_id,
    conversation_id: input.conversation_id,
    title: input.title,
    billed_from: { ...input.billed_from, state: resolveState(input.billed_from.state ?? firm.state, input.billed_from.gstin) },
    billed_to: { ...to, state: resolveState(to.state, to.gstin) },
    place_of_supply: totals.placeOfSupply,
    client_name: contactPerson ?? to.name,
    client_company: contactPerson ? to.name : null,
    client_phone: to.phone ?? null,
    client_email: to.email ?? null,
    client_address: [to.address, to.city, to.state, to.pincode].filter(Boolean).join(", ") || null,
    client_gstin: to.gstin ?? null,
    signature_url: input.signature_url,
    stamp_url: input.stamp_url,
    currency: "INR",
    subtotal: totals.netTotal,
    discount_amount: totals.docDiscount,
    tax_type: firm.tax_type === "NONE" ? "none" : "gst",
    tax_rate: Math.max(0, ...input.items.map((i) => i.gst_rate)),
    tax_amount: totals.totalTax,
    cgst_amount: totals.cgst,
    sgst_amount: totals.sgst,
    igst_amount: totals.igst,
    ledger_adjustments_total: totals.ledgerTotal,
    round_off: totals.roundOff,
    total_amount: totals.grandTotal,
    notes: input.notes,
    terms: input.terms,
  };

  const items = input.items.map((it, i) => ({
    ...it,
    gst_rate: firm.tax_type === "NONE" ? 0 : it.gst_rate,
    taxable_amount: totals.lines[i].taxable,
    tax_amount: totals.lines[i].tax,
    line_total: totals.lines[i].lineTotal,
  }));

  return { doc, items, ledgers: input.ledgers, totals };
}
