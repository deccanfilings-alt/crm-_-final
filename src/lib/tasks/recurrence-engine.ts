import { addDays, addMonths, addYears, setDate, format } from 'date-fns';

export type RecurrenceFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/**
 * Computes the next occurrence date after currentDueDate.
 */
export function computeNextDueDate(
  currentDueDate: Date | string,
  frequency: RecurrenceFrequency,
  dayOfMonth?: number
): string {
  const base = typeof currentDueDate === 'string' ? new Date(currentDueDate) : currentDueDate;

  let next: Date;
  switch (frequency) {
    case 'weekly':
      next = addDays(base, 7);
      break;
    case 'monthly':
      next = addMonths(base, 1);
      if (dayOfMonth && dayOfMonth >= 1 && dayOfMonth <= 31) {
        const maxDays = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next = setDate(next, Math.min(dayOfMonth, maxDays));
      }
      break;
    case 'quarterly':
      next = addMonths(base, 3);
      if (dayOfMonth && dayOfMonth >= 1 && dayOfMonth <= 31) {
        const maxDays = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next = setDate(next, Math.min(dayOfMonth, maxDays));
      }
      break;
    case 'yearly':
      next = addYears(base, 1);
      if (dayOfMonth && dayOfMonth >= 1 && dayOfMonth <= 31) {
        const maxDays = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next = setDate(next, Math.min(dayOfMonth, maxDays));
      }
      break;
  }

  return format(next, 'yyyy-MM-dd');
}

/**
 * Determines whether a recurrence is due for generation given lead days.
 * Generation trigger: (next_due_date - lead_days) <= todayString
 */
export function shouldGenerateRecurringTask(
  nextDueDate: string,
  leadDays: number,
  todayString: string
): boolean {
  const due = new Date(nextDueDate);
  const triggerDate = addDays(due, -leadDays);
  const triggerStr = format(triggerDate, 'yyyy-MM-dd');
  return triggerStr <= todayString;
}
