export type FailureDisposition = 'retry' | 'defer' | 'fail' | 'abort';

export interface ClassificationResult {
  disposition: FailureDisposition;
  code?: number;
  message: string;
  details?: string;
  href?: string;
  optOut?: boolean;
  raw?: unknown;
}

const RETRY_CODES = new Set([1, 2, 4, 80007, 130429, 131053, 131056]);
const OPT_OUT_CODES = new Set([131050]);
const DEFER_CODES = new Set([131049]);
const ABORT_CODES = new Set([131031, 131042, 131045, 131048, 132015, 132016]);

/**
 * Classifies Meta Cloud API & network response failures into one of 4 dispositions:
 *   - 'retry': Transient failure (network timeout, 429, 5xx, or specific transient error code)
 *   - 'defer': Valid recipient/message, but not deliverable to this person today (marketing cap)
 *   - 'fail': Single recipient or content validation error (do not retry for this recipient)
 *   - 'abort': Account or template level failure (stop the entire broadcast immediately)
 *
 * Code-specific rules MUST win over HTTP status.
 */
export function classifyMetaError(error: unknown, httpStatus?: number): ClassificationResult {
  let numCode: number | undefined;
  let message = 'Unknown error';
  let details: string | undefined;
  let href: string | undefined;
  let status: number | undefined = httpStatus;
  const raw: unknown = error;

  if (error && typeof error === 'object') {
    const errObj = error as Record<string, unknown>;

    const target = (errObj.error && typeof errObj.error === 'object'
      ? errObj.error
      : errObj) as Record<string, unknown>;

    if (typeof target.code === 'number') {
      numCode = target.code;
    } else if (typeof target.code === 'string') {
      const p = parseInt(target.code, 10);
      if (!isNaN(p)) numCode = p;
    }

    if (numCode === undefined && typeof target.error_subcode === 'number') {
      numCode = target.error_subcode;
    }

    if (typeof target.message === 'string' && target.message) {
      message = target.message;
    } else if (typeof errObj.message === 'string' && errObj.message) {
      message = errObj.message;
    }

    const errData = target.error_data || errObj.error_data;
    if (errData && typeof errData === 'object') {
      const d = (errData as Record<string, unknown>).details;
      if (typeof d === 'string') details = d;
    }

    if (typeof target.href === 'string') href = target.href;

    if (status === undefined && typeof errObj.status === 'number') {
      status = errObj.status;
    }
  } else if (typeof error === 'string') {
    message = error;
    const match = error.match(/\b(13\d{4}|80007|130429|131056|131053|132015|132016|131031|131042|131045|131048|131049|131050|1|2|4)\b/);
    if (match) {
      numCode = parseInt(match[1], 10);
    }
  }

  // 1. Code-specific rules ALWAYS win over HTTP status
  if (numCode !== undefined) {
    if (OPT_OUT_CODES.has(numCode)) {
      return { disposition: 'fail', code: numCode, optOut: true, message, details, href, raw };
    }
    if (ABORT_CODES.has(numCode)) {
      return { disposition: 'abort', code: numCode, message, details, href, raw };
    }
    if (DEFER_CODES.has(numCode)) {
      return { disposition: 'defer', code: numCode, message, details, href, raw };
    }
    if (RETRY_CODES.has(numCode)) {
      return { disposition: 'retry', code: numCode, message, details, href, raw };
    }
  }

  // 2. HTTP status / Network-level fallback rules
  if (status === 0 || (error instanceof Error && /network|timeout|econnreset|etimedout|fetch failed/i.test(error.message))) {
    return { disposition: 'retry', code: numCode, message, details, href, raw };
  }

  if (status === 429) {
    return { disposition: 'retry', code: numCode, message, details, href, raw };
  }

  if (status !== undefined && status >= 500) {
    return { disposition: 'retry', code: numCode, message, details, href, raw };
  }

  if (status !== undefined && status >= 400 && status < 500) {
    return { disposition: 'fail', code: numCode, message, details, href, raw };
  }

  // Default fallback
  return { disposition: 'fail', code: numCode, message, details, href, raw };
}
