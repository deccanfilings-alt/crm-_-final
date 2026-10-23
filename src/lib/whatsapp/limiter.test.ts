import { describe, expect, it, vi } from 'vitest';
import { SerialRateLimiter, calculateBackoffDelay } from './limiter';

describe('SerialRateLimiter', () => {
  it('defaults to 2 msgs/sec (500ms interval)', () => {
    const limiter = new SerialRateLimiter();
    expect(limiter.getMinIntervalMs()).toBe(500);
  });

  it('respects custom ratePerSec option', () => {
    const limiter = new SerialRateLimiter({ ratePerSec: 5 });
    expect(limiter.getMinIntervalMs()).toBe(200);
  });

  it('pushes next slot time back when penalized on 429', () => {
    const limiter = new SerialRateLimiter({ ratePerSec: 2 });
    const now = Date.now();
    limiter.penalize(5000);
    expect(limiter.getNextSlotTime()).toBeGreaterThanOrEqual(now + 4900);
  });
});

describe('calculateBackoffDelay', () => {
  it('calculates full-jitter backoff bounded by 1000 * 2^attempt capped at 32000', () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const delay = calculateBackoffDelay(attempt);
      const expectedCap = Math.min(1000 * Math.pow(2, attempt), 32000);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(expectedCap);
    }
  });

  it('uses Retry-After header when present and caps at 60s', () => {
    expect(calculateBackoffDelay(1, '5')).toBe(5000);
    expect(calculateBackoffDelay(1, 10)).toBe(10000);
    // Capped at 60s (60000ms) even if Retry-After is 120s
    expect(calculateBackoffDelay(1, '120')).toBe(60000);
  });
});
