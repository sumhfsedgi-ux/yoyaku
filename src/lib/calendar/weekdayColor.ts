/** Saturday=blue, Sunday=red; a holiday (date-specific, so not applicable to the weekday header row) overrides Saturday-blue to red too. */
export function weekdayAccentClass(weekday: number, holiday: boolean): string {
  if (weekday === 0 || holiday) return "text-rose-600 dark:text-rose-400";
  if (weekday === 6) return "text-sky-600 dark:text-sky-400";
  return "text-foreground";
}
