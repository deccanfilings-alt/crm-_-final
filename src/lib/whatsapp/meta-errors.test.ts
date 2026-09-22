import { describe, it, expect } from 'vitest';
import {
  parseMetaError,
  check24HourServiceWindow,
} from './meta-errors';

describe('Meta Errors & 24-Hour Service Window Diagnostics', () => {
  describe('check24HourServiceWindow', () => {
    it('returns closed/expired when customer has never messaged (null/undefined)', () => {
      const result = check24HourServiceWindow(null);
      expect(result.isOpen).toBe(false);
      expect(result.isExpired).toBe(true);
      expect(result.remainingMs).toBe(0);
      expect(result.formattedRemaining).toContain('Expired');

      const undefinedResult = check24HourServiceWindow(undefined);
      expect(undefinedResult.isExpired).toBe(true);
    });

    it('returns open/active when customer messaged 2 hours ago', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const result = check24HourServiceWindow(twoHoursAgo);

      expect(result.isOpen).toBe(true);
      expect(result.isExpired).toBe(false);
      expect(result.remainingHours).toBe(21); // ~22h remaining
      expect(result.formattedRemaining).toMatch(/21h|22h/);
    });

    it('returns expired when customer messaged 25 hours ago', () => {
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const result = check24HourServiceWindow(twentyFiveHoursAgo);

      expect(result.isOpen).toBe(false);
      expect(result.isExpired).toBe(true);
      expect(result.remainingMs).toBe(0);
      expect(result.formattedRemaining).toContain('Expired');
    });

    it('handles invalid date strings gracefully', () => {
      const result = check24HourServiceWindow('invalid-date-string');
      expect(result.isExpired).toBe(true);
    });
  });

  describe('parseMetaError', () => {
    it('translates code 131047 (24h window closed)', () => {
      const err = { code: 131047, message: 'Re-engagement message' };
      const parsed = parseMetaError(err);

      expect(parsed.code).toBe('META_131047');
      expect(parsed.numericCode).toBe(131047);
      expect(parsed.isWindowExpired).toBe(true);
      expect(parsed.userMessage).toContain('24-hour');
      expect(parsed.action).toContain('approved WhatsApp template');
    });

    it('translates nested Meta error structure { error: { code, message } }', () => {
      const err = {
        error: {
          code: 131026,
          message: 'Message undeliverable',
        },
      };
      const parsed = parseMetaError(err);

      expect(parsed.code).toBe('META_131026');
      expect(parsed.userMessage).toContain('not registered on WhatsApp');
    });

    it('translates code 132000 (template parameter mismatch)', () => {
      const parsed = parseMetaError({ code: 132000 });
      expect(parsed.code).toBe('META_132000');
      expect(parsed.userMessage).toContain('parameter count');
    });

    it('translates code 190 (access token expired)', () => {
      const parsed = parseMetaError({ code: 190 });
      expect(parsed.code).toBe('META_190');
      expect(parsed.action).toContain('access token');
    });

    it('translates string errors containing Meta codes', () => {
      const parsed = parseMetaError('Meta API failed with error code 130429: rate limit');
      expect(parsed.numericCode).toBe(130429);
      expect(parsed.userMessage).toContain('rate limit');
    });

    it('handles unknown errors safely with fallback message', () => {
      const parsed = parseMetaError(new Error('Connection reset by peer'));
      expect(parsed.code).toBe('META_ERROR');
      expect(parsed.userMessage).toBe('Connection reset by peer');
      expect(parsed.isActionable).toBe(false);
    });
  });
});
