export interface CalculationItemInput {
  quantity: number;
  unit_price: number;
  title?: string;
  description?: string;
  position?: number;
}

export interface CalculateTotalsInput {
  items: CalculationItemInput[];
  discountType?: 'percentage' | 'fixed' | 'none';
  discountValue?: number;
  taxType?: 'gst' | 'custom' | 'none';
  taxRate?: number;
}

export interface CalculatedTotals {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalAmount: number;
  itemTotals: number[];
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates item totals, subtotal, discount, tax (GST / CGST / SGST), and grand total.
 */
export function calculateQuotationTotals(input: CalculateTotalsInput): CalculatedTotals {
  const items = input.items || [];
  const discountType = input.discountType || 'none';
  const discountVal = Math.max(0, input.discountValue || 0);
  const taxType = input.taxType || 'gst';
  const taxRate = Math.max(0, input.taxRate !== undefined ? input.taxRate : 18.0);

  // 1. Line items
  const itemTotals: number[] = [];
  let subtotal = 0;

  for (const item of items) {
    const qty = Math.max(0, item.quantity || 0);
    const price = Math.max(0, item.unit_price || 0);
    const lineTotal = round2(qty * price);
    itemTotals.push(lineTotal);
    subtotal += lineTotal;
  }
  subtotal = round2(subtotal);

  // 2. Discount
  let discountAmount = 0;
  if (discountType === 'percentage') {
    discountAmount = round2(subtotal * (discountVal / 100));
  } else if (discountType === 'fixed') {
    discountAmount = round2(discountVal);
  }
  discountAmount = Math.min(subtotal, Math.max(0, discountAmount));

  // 3. Taxable Amount
  const taxableAmount = round2(Math.max(0, subtotal - discountAmount));

  // 4. Tax
  let taxAmount = 0;
  if (taxType !== 'none') {
    taxAmount = round2(taxableAmount * (taxRate / 100));
  }

  // 5. Total
  const totalAmount = round2(taxableAmount + taxAmount);

  // 6. GST breakdown (CGST 50%, SGST 50%)
  const cgst = round2(taxAmount / 2);
  const sgst = round2(taxAmount - cgst);
  const igst = taxAmount;

  return {
    subtotal,
    discountAmount,
    taxableAmount,
    taxAmount,
    cgst,
    sgst,
    igst,
    totalAmount,
    itemTotals,
  };
}
