import { describe, it, expect } from 'vitest';
import { computeNextDueDate, shouldGenerateRecurringTask } from './recurrence-engine';

describe('Recurrence Engine', () => {
  it('advances weekly by 7 days', () => {
    const next = computeNextDueDate('2026-10-26', 'weekly');
    expect(next).toBe('2026-11-02');
  });

  it('advances monthly and respects dayOfMonth', () => {
    const next = computeNextDueDate('2026-10-20', 'monthly', 20);
    expect(next).toBe('2026-11-20');
  });

  it('advances quarterly by 3 months', () => {
    const next = computeNextDueDate('2026-10-15', 'quarterly', 15);
    expect(next).toBe('2027-01-15');
  });

  it('advances yearly by 1 year', () => {
    const next = computeNextDueDate('2026-10-26', 'yearly', 26);
    expect(next).toBe('2027-10-26');
  });

  it('triggers generation when today is within lead days window', () => {
    // Due Nov 1st, lead days 3 -> trigger date is Oct 29
    expect(shouldGenerateRecurringTask('2026-11-01', 3, '2026-10-28')).toBe(false);
    expect(shouldGenerateRecurringTask('2026-11-01', 3, '2026-10-29')).toBe(true);
    expect(shouldGenerateRecurringTask('2026-11-01', 3, '2026-10-31')).toBe(true);
  });
});
