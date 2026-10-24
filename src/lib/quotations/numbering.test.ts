import { describe, it, expect } from 'vitest';
import { formatQuoteNumber, parseQuoteNumber } from './numbering';

describe('Quotation Numbering', () => {
  it('formats quotation number with 4-digit padding', () => {
    expect(formatQuoteNumber('DF-QT-', 1)).toBe('DF-QT-0001');
    expect(formatQuoteNumber('DF-QT-', 1001)).toBe('DF-QT-1001');
    expect(formatQuoteNumber('EST-', 42)).toBe('EST-0042');
  });

  it('handles default prefix if empty', () => {
    expect(formatQuoteNumber('', 5)).toBe('DF-QT-0005');
  });

  it('parses valid quotation numbers', () => {
    expect(parseQuoteNumber('DF-QT-1001', 'DF-QT-')).toBe(1001);
    expect(parseQuoteNumber('EST-0025', 'EST-')).toBe(25);
    expect(parseQuoteNumber('INVALID-1001', 'DF-QT-')).toBe(null);
  });
});
