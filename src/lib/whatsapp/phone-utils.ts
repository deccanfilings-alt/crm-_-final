/**
 * Sanitize phone number for Meta WhatsApp API.
 * Meta requires digits only — no + prefix, no spaces, no dashes.
 * e.g. "+370 63949836" → "37063949836"
 */
export function sanitizePhoneForMeta(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Normalize phone number by removing all non-digit characters.
 * Used for comparing phone numbers in different formats.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Compare two phone numbers accounting for trunk prefix differences.
 * e.g. "370063949836" (with trunk 0) matches "37063949836" (without trunk 0)
 * by comparing the last 8 digits.
 */
export function phonesMatch(phone1: string, phone2: string): boolean {
  const n1 = normalizePhone(phone1)
  const n2 = normalizePhone(phone2)
  if (n1 === n2) return true
  if (n1.length >= 8 && n2.length >= 8) {
    return n1.slice(-8) === n2.slice(-8)
  }
  return false
}

/**
 * Validate phone number is E.164-like format (7-15 digits starting with non-zero).
 * Accepts with or without + prefix.
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phone)
}

/**
 * Generate plausible phone number variants for retry when Meta's
 * sandbox rejects a number with error #131030 ("not in allowed list").
 *
 * Many countries use a "trunk prefix" 0 for domestic dialing that is
 * meant to be dropped in international format (e.g. Lithuanian
 * "+370 063 949 836" domestically → "+370 63 949 836" international).
 * But some sandboxes register the number with the trunk 0 included,
 * causing sends to the correct international format to fail.
 *
 * This helper yields up to 3 variants:
 *   1. The original sanitized number (first attempt)
 *   2. With a trunk 0 inserted after the country code
 *   3. With a trunk 0 removed after the country code
 *
 * Country-code lengths of 1, 2, and 3 digits are tried because we
 * don't know the user's country ahead of time.
 *
 * @param sanitized - digits-only phone number (from sanitizePhoneForMeta)
 * @returns deduplicated list of variants, original first
 */
export function phoneVariants(sanitized: string): string[] {
  if (!sanitized) return []
  const seen = new Set<string>()
  const push = (v: string) => {
    if (v && !seen.has(v)) seen.add(v)
  }

  // 1. Original
  push(sanitized)

  // 2. Insert a 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (!rest.startsWith('0')) {
      push(cc + '0' + rest)
    }
  }

  // 3. Remove a leading 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen + 1) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (rest.startsWith('0')) {
      push(cc + rest.slice(1))
    }
  }

  return [...seen]
}

/**
 * Returns true when the Meta API error indicates the recipient
 * phone number isn't in the allowed list (sandbox restriction).
 * Detected via error code 131030 or the standard error text.
 */
export function isRecipientNotAllowedError(message: string): boolean {
  return /131030|not in allowed list|not in the allowed list/i.test(message)
}

export interface PhoneValidationResult {
  isValid: boolean;
  sanitized: string;
  isQuarantined: boolean;
  reason?: string;
}

/**
 * Strict Indian mobile phone validator for broadcast dispatches.
 *
 * Rules:
 *   1. Strip all non-digits
 *   2. If 12 digits starting with '91', keep the last 10
 *   3. If 10 digits, keep as-is
 *   4. The resulting 10 digits MUST start with 6, 7, 8, or 9
 *   5. Anything else -> quarantined (isQuarantined = true, isValid = false)
 */
export function validateBroadcastPhone(phone: string | null | undefined): PhoneValidationResult {
  if (!phone || typeof phone !== 'string') {
    return { isValid: false, sanitized: '', isQuarantined: true, reason: 'Empty or missing phone number' };
  }

  // 1. Strip all non-digits
  const digits = phone.replace(/\D/g, '');

  let tenDigits = digits;

  // 2 & 3. 12 digits starting with 91, or 10 digits
  if (digits.length === 12 && digits.startsWith('91')) {
    tenDigits = digits.slice(-10);
  } else if (digits.length === 10) {
    tenDigits = digits;
  } else {
    return {
      isValid: false,
      sanitized: digits,
      isQuarantined: true,
      reason: `Invalid digit count (${digits.length}). Must be 10 digits or 12 digits starting with 91.`,
    };
  }

  // 4. Resulting 10 digits MUST start with 6, 7, 8, or 9
  if (!/^[6789]\d{9}$/.test(tenDigits)) {
    return {
      isValid: false,
      sanitized: tenDigits,
      isQuarantined: true,
      reason: `Invalid mobile prefix '${tenDigits[0]}'. Must start with 6, 7, 8, or 9.`,
    };
  }

  return {
    isValid: true,
    sanitized: tenDigits,
    isQuarantined: false,
  };
}
