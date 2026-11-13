// ============================================================
// Billing settings masters — validation for Particulars, Ledgers,
// Tax Rates and Series. Pure (no I/O) so the API routes and tests
// share the same rules.
// ============================================================

/** Tally-compatible ledger groups (WebLedger "Create Ledgers"). */
export const LEDGER_GROUPS = [
  "Purchase Accounts",
  "Direct Expenses",
  "Indirect Expenses",
  "Sales Accounts",
  "Direct Incomes",
  "Indirect Incomes",
  "Capital Account: Reserves & Surplus",
  "Loans (Liability): Bank OD A/c",
  "Loans (Liability): Bank Credit Cards",
  "Loans (Liability): Secured Loans",
  "Loans (Liability): Unsecured Loans",
  "Current Liabilities: Duties & Taxes",
  "Current Liabilities: Sundry Creditors",
  "Current Liabilities: Provisions",
  "Profit & Loss A/C",
  "Fixed Assets",
  "Investments",
  "Branch / Divisions",
  "Current Assets: Stock-in-Hand",
  "Current Assets: Loans & Advances (Asset)",
  "Current Assets: Sundry Debtors",
  "Current Assets: Cash-in-Hand",
  "Current Assets: Bank Accounts",
  "Current Assets: Deposits (Asset)",
  "Misc. Expenses (ASSET)",
  "Suspense A/c",
] as const;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (v: unknown, max = 500): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const money = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(typeof v === "string" ? v.replace(/,/g, "") : v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const rate = (v: unknown): number | null => {
  const n = money(v);
  if (n === null) return null;
  return Number.isNaN(n) || n < 0 || n > 100 ? NaN : n;
};

// ------------------------------------------------------------
// Particulars
// ------------------------------------------------------------
export interface ParticularInput {
  name: string;
  service_name: string | null;
  gst_rate: number | null;
  vat_rate: number | null;
  sac_code: string | null;
  description: string | null;
  default_amount: number | null;
}

export function validateParticular(body: Record<string, unknown>): Result<ParticularInput> {
  const name = str(body.name, 200);
  if (!name) return { ok: false, error: "Name is required" };
  const gst = rate(body.gst_rate);
  const vat = rate(body.vat_rate);
  const amount = money(body.default_amount);
  if (Number.isNaN(gst)) return { ok: false, error: "GST rate must be between 0 and 100" };
  if (Number.isNaN(vat)) return { ok: false, error: "VAT rate must be between 0 and 100" };
  if (Number.isNaN(amount) || (amount !== null && amount < 0)) return { ok: false, error: "Amount must be a positive number" };
  const sac = str(body.sac_code, 20);
  if (sac && !/^\d{4,8}$/.test(sac)) return { ok: false, error: "SAC / HSN code should be 4–8 digits" };
  return {
    ok: true,
    value: {
      name,
      service_name: str(body.service_name, 200),
      gst_rate: gst,
      vat_rate: vat,
      sac_code: sac,
      description: str(body.description, 250),
      default_amount: amount,
    },
  };
}

// ------------------------------------------------------------
// Ledgers
// ------------------------------------------------------------
export function validateLedger(body: Record<string, unknown>): Result<{ name: string; ledger_group: string }> {
  const name = str(body.name, 120);
  if (!name) return { ok: false, error: "Ledger name is required" };
  const group = str(body.ledger_group, 120);
  if (!group || !(LEDGER_GROUPS as readonly string[]).includes(group)) {
    return { ok: false, error: "Pick a ledger group" };
  }
  return { ok: true, value: { name, ledger_group: group } };
}

// ------------------------------------------------------------
// Tax rates
// ------------------------------------------------------------
export function validateTaxRates(body: Record<string, unknown>): Result<{ GST: number[]; VAT: number[] }> {
  const out: { GST: number[]; VAT: number[] } = { GST: [], VAT: [] };
  for (const kind of ["GST", "VAT"] as const) {
    const list = body[kind.toLowerCase()] ?? body[kind];
    if (!Array.isArray(list)) return { ok: false, error: `${kind} rates must be a list` };
    const seen = new Set<number>();
    for (const v of list) {
      const r = rate(v);
      if (r === null || Number.isNaN(r)) return { ok: false, error: `${kind} rate "${String(v)}" must be between 0 and 100` };
      seen.add(r);
    }
    out[kind] = [...seen].sort((a, b) => a - b);
  }
  if (!out.GST.length) return { ok: false, error: "Keep at least one GST rate" };
  return { ok: true, value: out };
}

// ------------------------------------------------------------
// Series + periods
// ------------------------------------------------------------
export interface SeriesPeriodInput {
  id?: string;
  prefix: string;
  suffix: string;
  applicable_from: string | null;
  applicable_to: string | null;
  starting_no: number;
  next_no: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateSeriesPeriods(list: unknown): Result<SeriesPeriodInput[]> {
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: "Add at least one numbering row" };
  if (list.length > 50) return { ok: false, error: "Too many rows" };
  const rows: SeriesPeriodInput[] = [];
  for (const [i, raw] of list.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const n = i + 1;
    const from = str(r.applicable_from, 10);
    const to = str(r.applicable_to, 10);
    if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return { ok: false, error: `Row ${n}: dates must be YYYY-MM-DD` };
    if (to && !from) return { ok: false, error: `Row ${n}: set "Applicable from" too` };
    if (from && to && to < from) return { ok: false, error: `Row ${n}: "Applicable to" is before "Applicable from"` };
    const start = Number(r.starting_no ?? 1);
    const next = Number(r.next_no ?? start);
    if (!Number.isInteger(start) || start < 0) return { ok: false, error: `Row ${n}: starting number must be a whole number` };
    if (!Number.isInteger(next) || next < 0) return { ok: false, error: `Row ${n}: next number must be a whole number` };
    const prefix = typeof r.prefix === "string" ? r.prefix.trim().slice(0, 30) : "";
    const suffix = typeof r.suffix === "string" ? r.suffix.trim().slice(0, 30) : "";
    if (!prefix && !suffix) return { ok: false, error: `Row ${n}: add a prefix or a suffix` };
    rows.push({
      id: typeof r.id === "string" ? r.id : undefined,
      prefix,
      suffix,
      applicable_from: from,
      applicable_to: to,
      starting_no: start,
      next_no: Math.max(next, start),
    });
  }
  if (rows.filter((r) => !r.applicable_from).length > 1) {
    return { ok: false, error: "Only one row can be undated (the fallback)" };
  }
  const dated = rows.filter((r) => r.applicable_from).sort((a, b) => a.applicable_from!.localeCompare(b.applicable_from!));
  for (let i = 1; i < dated.length; i++) {
    const prevEnd = dated[i - 1].applicable_to ?? "9999-12-31";
    if (dated[i].applicable_from! <= prevEnd) return { ok: false, error: "Date ranges overlap" };
  }
  return { ok: true, value: rows };
}

/** Indian financial year containing a date: 1 Apr – 31 Mar. */
export function financialYear(d: Date = new Date()): { from: string; to: string; label: string } {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const yy = (n: number) => String(n % 100).padStart(2, "0");
  return { from: `${y}-04-01`, to: `${y + 1}-03-31`, label: `${yy(y)}-${yy(y + 1)}` };
}

/** Example of the number a row produces, e.g. "TOR/26-27/QU" + 103. */
export function formatSeriesNumber(prefix: string, n: number, suffix: string): string {
  return `${prefix}${n}${suffix}`;
}
