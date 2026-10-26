/**
 * Date and timezone utilities for Action Items and Indian Standard Time (IST).
 * Timezone: Asia/Kolkata (UTC+05:30)
 */

/**
 * Returns today's date formatted as YYYY-MM-DD in Asia/Kolkata (IST).
 */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Returns the date portion (YYYY-MM-DD) of a timestamp in Asia/Kolkata (IST).
 */
export function toISTDateString(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Formats a date/time into IST e.g. "24 Oct, 14:05"
 */
export function formatDateTimeIST(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return formatter.format(d);
}

/**
 * Formats date only in IST e.g. "25 Oct"
 */
export function formatDateOnlyIST(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
  });

  return formatter.format(d);
}

/**
 * Determines whether a completion timestamp is late compared to target_date (in IST)
 * and calculates the number of days late.
 */
export function getLateInfo(
  completedAt: string | null | undefined,
  targetDate: string | null | undefined
): { isLate: boolean; daysLate: number } {
  if (!completedAt || !targetDate) return { isLate: false, daysLate: 0 };

  const completedDateIST = toISTDateString(completedAt);
  if (!completedDateIST) return { isLate: false, daysLate: 0 };

  if (completedDateIST > targetDate) {
    const compParts = completedDateIST.split('-').map(Number);
    const targetParts = targetDate.split('-').map(Number);
    const compUtc = Date.UTC(compParts[0], compParts[1] - 1, compParts[2]);
    const targetUtc = Date.UTC(targetParts[0], targetParts[1] - 1, targetParts[2]);
    const diffDays = Math.max(1, Math.round((compUtc - targetUtc) / (1000 * 60 * 60 * 24)));
    return { isLate: true, daysLate: diffDays };
  }

  return { isLate: false, daysLate: 0 };
}
