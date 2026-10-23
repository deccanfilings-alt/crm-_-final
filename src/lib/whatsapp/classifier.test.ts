import { describe, expect, it } from 'vitest';
import { classifyMetaError } from './classifier';

describe('classifyMetaError', () => {
  it('assigns disposition "retry" for network timeouts and HTTP 0', () => {
    const err = new Error('fetch failed: network timeout');
    const result = classifyMetaError(err, 0);
    expect(result.disposition).toBe('retry');
  });

  it('assigns disposition "retry" for HTTP 429 and HTTP 5xx', () => {
    expect(classifyMetaError({ message: 'Rate limit' }, 429).disposition).toBe('retry');
    expect(classifyMetaError({ message: 'Internal Server Error' }, 500).disposition).toBe('retry');
    expect(classifyMetaError({ message: 'Service Unavailable' }, 503).disposition).toBe('retry');
  });

  it('assigns disposition "retry" for specific transient codes (1, 2, 4, 80007, 130429, 131053, 131056)', () => {
    expect(classifyMetaError({ error: { code: 130429, message: 'Rate limit' } }, 400).disposition).toBe('retry');
    expect(classifyMetaError({ error: { code: 80007, message: 'Graph rate limit' } }).disposition).toBe('retry');
    expect(classifyMetaError({ error: { code: 4 } }).disposition).toBe('retry');
  });

  it('assigns disposition "defer" for per-person marketing cap codes (131049, 131050)', () => {
    const r1 = classifyMetaError({ error: { code: 131049, message: 'Marketing cap' } }, 400);
    expect(r1.disposition).toBe('defer');
    expect(r1.code).toBe(131049);

    const r2 = classifyMetaError({ error: { code: 131050 } });
    expect(r2.disposition).toBe('defer');
  });

  it('assigns disposition "abort" for account or template level blocks (131031, 131042, 131045, 131048, 132015, 132016)', () => {
    const r1 = classifyMetaError({ error: { code: 132015, message: 'Template disabled' } }, 400);
    expect(r1.disposition).toBe('abort');
    expect(r1.code).toBe(132015);

    expect(classifyMetaError({ error: { code: 131031 } }).disposition).toBe('abort');
    expect(classifyMetaError({ error: { code: 131042 } }).disposition).toBe('abort');
    expect(classifyMetaError({ error: { code: 132016 } }).disposition).toBe('abort');
  });

  it('assigns disposition "fail" for single-row 4xx errors (e.g., 132001, 131026, 131009)', () => {
    const r1 = classifyMetaError({ error: { code: 132001, message: 'Template does not exist' } }, 400);
    expect(r1.disposition).toBe('fail');
    expect(r1.code).toBe(132001);

    expect(classifyMetaError({ error: { code: 131026, message: 'Undeliverable' } }, 400).disposition).toBe('fail');
    expect(classifyMetaError({ message: 'Bad request' }, 400).disposition).toBe('fail');
  });

  it('ensures code-specific rules win over HTTP status (e.g., 400 carrying 132015 is abort; 400 carrying 132001 is fail)', () => {
    // 400 carrying 132015 -> abort
    expect(classifyMetaError({ error: { code: 132015 } }, 400).disposition).toBe('abort');
    // 400 carrying 132001 -> fail
    expect(classifyMetaError({ error: { code: 132001 } }, 400).disposition).toBe('fail');
    // 400 carrying 130429 -> retry
    expect(classifyMetaError({ error: { code: 130429 } }, 400).disposition).toBe('retry');
  });
});
