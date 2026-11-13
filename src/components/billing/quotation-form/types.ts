import type { DiscountType } from "@/lib/billing/calc";
import type { Party } from "@/lib/billing/quotation-save";

export type { Party };

/** A line in the Bill Details table. Numbers are kept as strings while typing. */
export interface ItemRow {
  key: string;
  particular_id: string | null;
  title: string;
  description: string;
  service_name: string;
  sac_code: string;
  quantity: string;
  unit_price: string;
  discount_value: string;
  discount_type: DiscountType;
  gst_rate: string;
  linked_task_ids: string[];
}

export interface LedgerRow {
  key: string;
  ledger_id: string | null;
  ledger_name: string;
  amount: string;
}

export interface Client {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  pan: string | null;
  cin: string | null;
  proprietor_name: string | null;
}

export interface Firm {
  id: string;
  name: string;
  tax_type: "GST" | "NONE";
  gstin: string | null;
  pan: string | null;
  cin: string | null;
  state: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_url: string | null;
  signature_url: string | null;
  stamp_url: string | null;
  terms_and_conditions: string | null;
  credit_period_days: number;
  default_gst_rate: number;
}

export interface SeriesOption {
  id: string;
  name: string;
  is_default: boolean;
  preview: { number: string | null; running_no: number | null; prefix: string | null; suffix: string | null } | null;
}

export interface LedgerOption {
  id: string;
  name: string;
  ledger_group: string;
}

let seq = 0;
export const newKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

export function blankItem(gstRate = 18): ItemRow {
  return {
    key: newKey(),
    particular_id: null,
    title: "",
    description: "",
    service_name: "",
    sac_code: "",
    quantity: "1",
    unit_price: "",
    discount_value: "",
    discount_type: "INR",
    gst_rate: String(gstRate),
    linked_task_ids: [],
  };
}

export function partyFromFirm(f: Firm): Party {
  return {
    name: f.name,
    address: [f.address_line1, f.address_line2].filter(Boolean).join(", ") || null,
    city: f.city,
    state: f.state,
    pincode: f.pincode,
    phone: f.phone,
    email: f.email,
    website: f.website,
    gstin: f.gstin,
    pan: f.pan,
    cin: f.cin,
    logo_url: f.logo_url,
  };
}

export function partyFromClient(c: Client): Party {
  const person = c.name?.trim() || null;
  const company = c.company?.trim() || null;
  return {
    name: company ?? person ?? c.phone ?? "Client",
    contact_name: company && person ? person : null,
    address: c.address,
    city: c.city,
    state: c.state,
    pincode: c.pincode,
    phone: c.phone,
    email: c.email,
    gstin: c.gstin,
    pan: c.pan,
    cin: c.cin,
  };
}

/** "+91 96184 95888" style for "Name (M:+91 …)". */
export function displayPhone(p: string | null | undefined): string {
  const d = (p ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return p ?? "";
}

export const inr = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
