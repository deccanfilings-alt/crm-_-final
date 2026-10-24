export const DEFAULT_NAME_FALLBACK = 'Sir/Madam';

export function cleanDisplayName(
  name: string | null | undefined,
  fallback = DEFAULT_NAME_FALLBACK
): string {
  if (!name || typeof name !== 'string') {
    return fallback;
  }

  // 1. Remove variation selectors and zero-width characters
  let cleaned = name.replace(/[\uFE00-\uFE0F\u200B-\u200D\u2060]/g, '');

  // 2. Remove everything except letters, combining marks, spaces, ., ' and -
  const allowedRegex = new RegExp("[^\\p{L}\\p{M}\\s.'-]", 'gu');
  cleaned = cleaned.replace(allowedRegex, '');

  // 3. Collapse whitespace and trim spaces and .'- from both ends
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/^[\s.'-]+|[\s.'-]+$/g, '');

  // 4. If the result is all lowercase, capitalise each word
  if (cleaned && cleaned === cleaned.toLowerCase()) {
    cleaned = cleaned.replace(/(^|[\s.'-])(\p{L})/gu, (_, prefix, char) => {
      return prefix + char.toUpperCase();
    });
  }

  // 5. If fewer than 2 letters remain, return fallback
  const letterMatches = cleaned.match(new RegExp('\\p{L}', 'gu'));
  if (!letterMatches || letterMatches.length < 2) {
    return fallback;
  }

  return cleaned;
}
