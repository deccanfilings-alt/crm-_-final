import { describe, it, expect, vi, afterEach } from 'vitest';
import { todayIST, toISTDateString, formatDateTimeIST, formatDateOnlyIST, getLateInfo } from './dates';

describe('dates.ts - IST timezone utilities', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('todayIST returns a valid YYYY-MM-DD string', () => {
    const today = todayIST();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('todayIST handles midnight transitions correctly using fake timers', () => {
    // 2026-10-24 18:29:59 UTC is 2026-10-24 23:59:59 IST
    vi.setSystemTime(new Date('2026-10-24T18:29:59.000Z'));
    expect(todayIST()).toBe('2026-10-24');

    // 2026-10-24 18:30:00 UTC is 2026-10-25 00:00:00 IST (midnight in India)
    vi.setSystemTime(new Date('2026-10-24T18:30:00.000Z'));
    expect(todayIST()).toBe('2026-10-25');

    // 2026-10-25 02:00:00 UTC is 2026-10-25 07:30:00 IST
    // Raw UTC toISOString().split('T')[0] would be 2026-10-25, and IST is 2026-10-25
    vi.setSystemTime(new Date('2026-10-25T02:00:00.000Z'));
    expect(todayIST()).toBe('2026-10-25');

    // Between 00:00 UTC and 05:30 IST: e.g. 2026-10-24 20:00:00 UTC
    // Raw UTC date is 2026-10-24, but in IST it's already 2026-10-25 01:30!
    vi.setSystemTime(new Date('2026-10-24T20:00:00.000Z'));
    expect(todayIST()).toBe('2026-10-25');
  });

  it('toISTDateString converts UTC timestamps to correct IST dates', () => {
    // 2026-10-24 20:00:00 UTC is 2026-10-25 01:30:00 IST
    const dateStr = toISTDateString('2026-10-24T20:00:00Z');
    expect(dateStr).toBe('2026-10-25');

    // 2026-10-24 01:00:00 UTC is 2026-10-24 06:30:00 IST
    const dateStrSameDay = toISTDateString('2026-10-24T01:00:00Z');
    expect(dateStrSameDay).toBe('2026-10-24');
  });

  it('formatDateOnlyIST formats date in IST e.g. 25 Oct', () => {
    const formatted = formatDateOnlyIST('2026-10-25T04:30:00Z');
    expect(formatted).toBe('25 Oct');
  });

  it('formatDateTimeIST formats timestamp into IST e.g. 24 Oct, 14:05', () => {
    // 2026-10-24 08:35:00 UTC is 2026-10-24 14:05:00 IST
    const formatted = formatDateTimeIST('2026-10-24T08:35:00Z');
    expect(formatted).toBe('24 Oct, 14:05');
  });

  it('getLateInfo detects on-time completion', () => {
    // Completed on target date
    const res = getLateInfo('2026-10-24T10:00:00Z', '2026-10-24');
    expect(res.isLate).toBe(false);
    expect(res.daysLate).toBe(0);

    // Completed before target date
    const resEarly = getLateInfo('2026-10-23T10:00:00Z', '2026-10-24');
    expect(resEarly.isLate).toBe(false);
    expect(resEarly.daysLate).toBe(0);
  });

  it('getLateInfo detects late completion and calculates days late', () => {
    // Target date 2026-10-24, completed on 2026-10-25 (1 day late)
    const res1 = getLateInfo('2026-10-25T05:00:00Z', '2026-10-24');
    expect(res1.isLate).toBe(true);
    expect(res1.daysLate).toBe(1);

    // Target date 2026-10-20, completed on 2026-10-24 (4 days late)
    const res4 = getLateInfo('2026-10-24T05:00:00Z', '2026-10-20');
    expect(res4.isLate).toBe(true);
    expect(res4.daysLate).toBe(4);
  });
});
