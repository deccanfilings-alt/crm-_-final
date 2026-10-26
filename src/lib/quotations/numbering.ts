export function formatQuoteNumber(prefix: string, num: number): string {
  const cleanPrefix = (prefix || 'DF-QT-').trim();
  const safeNum = Math.max(1, Math.floor(num || 1));
  return `${cleanPrefix}${safeNum.toString().padStart(4, '0')}`;
}

export function parseQuoteNumber(quoteNumber: string, prefix: string): number | null {
  const cleanPrefix = (prefix || 'DF-QT-').trim();
  if (!quoteNumber.startsWith(cleanPrefix)) return null;
  const numPart = quoteNumber.slice(cleanPrefix.length);
  const parsed = parseInt(numPart, 10);
  return isNaN(parsed) ? null : parsed;
}
