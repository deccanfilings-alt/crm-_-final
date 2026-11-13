// Indian states / UTs with GST state codes (first 2 digits of a GSTIN).
// Used for the firm/client State fields and for place of supply
// (same state -> CGST + SGST, different state -> IGST).

export const INDIAN_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const BY_NAME = new Map(INDIAN_STATES.map((s) => [norm(s.name), s.name]));
// Common alternative spellings.
const ALIASES: Record<string, string> = {
  newdelhi: "Delhi",
  nctofdelhi: "Delhi",
  orissa: "Odisha",
  pondicherry: "Puducherry",
  jk: "Jammu and Kashmir",
  ap: "Andhra Pradesh",
  ts: "Telangana",
  tn: "Tamil Nadu",
  up: "Uttar Pradesh",
  mp: "Madhya Pradesh",
  wb: "West Bengal",
};

/** Canonical state name, or null if unknown. */
export function canonicalState(input: string | null | undefined): string | null {
  if (!input) return null;
  const k = norm(input);
  if (!k) return null;
  return BY_NAME.get(k) ?? ALIASES[k] ?? null;
}

/** State from a GSTIN's first two digits ("36ABCDE1234F1Z5" -> Telangana). */
export function stateFromGstin(gstin: string | null | undefined): string | null {
  const m = /^(\d{2})[A-Z0-9]{13}$/i.exec((gstin ?? "").trim());
  if (!m) return null;
  return INDIAN_STATES.find((s) => s.code === m[1])?.name ?? null;
}

/** Best guess of a party's state: explicit state first, then GSTIN. */
export function resolveState(state?: string | null, gstin?: string | null): string | null {
  return canonicalState(state) ?? stateFromGstin(gstin);
}
