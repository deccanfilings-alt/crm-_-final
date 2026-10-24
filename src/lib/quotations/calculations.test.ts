import { describe, it, expect } from 'vitest';
import { calculateQuotationTotals } from './calculations';

describe('calculateQuotationTotals', () => {
  it('calculates subtotal and 18% GST correctly for single item', () => {
    const res = calculateQuotationTotals({
      items: [{ quantity: 1, unit_price: 10000 }],
      discountType: 'none',
      taxType: 'gst',
      taxRate: 18,
    });

    expect(res.subtotal).toBe(10000);
    expect(res.discountAmount).toBe(0);
    expect(res.taxableAmount).toBe(10000);
    expect(res.taxAmount).toBe(1800);
    expect(res.cgst).toBe(900);
    expect(res.sgst).toBe(900);
    expect(res.totalAmount).toBe(11800);
    expect(res.itemTotals).toEqual([10000]);
  });

  it('calculates multiple line items and percentage discount', () => {
    const res = calculateQuotationTotals({
      items: [
        { quantity: 2, unit_price: 5000 }, // 10000
        { quantity: 1, unit_price: 2500 }, // 2500
      ],
      discountType: 'percentage',
      discountValue: 10, // 10% of 12500 = 1250
      taxType: 'gst',
      taxRate: 18,
    });

    expect(res.subtotal).toBe(12500);
    expect(res.discountAmount).toBe(1250);
    expect(res.taxableAmount).toBe(11250);
    expect(res.taxAmount).toBe(2025);
    expect(res.totalAmount).toBe(13275);
    expect(res.itemTotals).toEqual([10000, 2500]);
  });

  it('calculates fixed discount capped at subtotal', () => {
    const res = calculateQuotationTotals({
      items: [{ quantity: 1, unit_price: 500 }],
      discountType: 'fixed',
      discountValue: 1000, // Capped at 500
      taxType: 'none',
    });

    expect(res.subtotal).toBe(500);
    expect(res.discountAmount).toBe(500);
    expect(res.taxableAmount).toBe(0);
    expect(res.taxAmount).toBe(0);
    expect(res.totalAmount).toBe(0);
  });

  it('handles empty items safely', () => {
    const res = calculateQuotationTotals({
      items: [],
      discountType: 'none',
      taxType: 'gst',
      taxRate: 18,
    });

    expect(res.subtotal).toBe(0);
    expect(res.discountAmount).toBe(0);
    expect(res.taxableAmount).toBe(0);
    expect(res.taxAmount).toBe(0);
    expect(res.totalAmount).toBe(0);
    expect(res.itemTotals).toEqual([]);
  });

  it('handles floating point precision properly', () => {
    const res = calculateQuotationTotals({
      items: [
        { quantity: 3, unit_price: 33.33 }, // 99.99
      ],
      discountType: 'none',
      taxType: 'gst',
      taxRate: 18, // 17.9982 -> 18.00
    });

    expect(res.subtotal).toBe(99.99);
    expect(res.taxAmount).toBe(18.0);
    expect(res.totalAmount).toBe(117.99);
  });
});
