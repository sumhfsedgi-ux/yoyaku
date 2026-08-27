import { DateTime } from "luxon";
import { SALON_TIME_ZONE } from "@/lib/availability/types";

const WINDOW_DAYS = 14;

/** The 14 sequential ISO dates starting at anchorDateISO. */
export function buildTwoWeekWindow(anchorDateISO: string): string[] {
  const anchor = DateTime.fromISO(anchorDateISO, { zone: SALON_TIME_ZONE }).startOf("day");
  return Array.from({ length: WINDOW_DAYS }, (_, i) => anchor.plus({ days: i }).toISODate()!);
}

/** Last date (inclusive) of the 14-day window starting at startDateISO. */
export function computeEndDateISO(startDateISO: string): string {
  return DateTime.fromISO(startDateISO, { zone: SALON_TIME_ZONE })
    .startOf("day")
    .plus({ days: WINDOW_DAYS - 1 })
    .toISODate()!;
}

/**
 * "M/D" for the window's first cell and for the first cell of any month the
 * window crosses into; bare "D" otherwise - keeps every other cell from
 * repeating the month digit.
 */
export function formatGridDayLabel(dateISO: string, previousDateISO: string | null): string {
  const day = DateTime.fromISO(dateISO, { zone: SALON_TIME_ZONE });
  if (!previousDateISO) return `${day.month}/${day.day}`;
  const previous = DateTime.fromISO(previousDateISO, { zone: SALON_TIME_ZONE });
  if (day.month !== previous.month) return `${day.month}/${day.day}`;
  return `${day.day}`;
}

/** The window can't be paged earlier than the one starting today. */
export function canGoToPreviousWindow(currentStartISO: string, todayISO: string): boolean {
  return currentStartISO > todayISO;
}

/** The next window's start date must still fall within the booking horizon. */
export function isWindowStartWithinHorizon(nextStartISO: string, todayISO: string, bookingWindowDays: number): boolean {
  const today = DateTime.fromISO(todayISO, { zone: SALON_TIME_ZONE }).startOf("day");
  const nextStart = DateTime.fromISO(nextStartISO, { zone: SALON_TIME_ZONE }).startOf("day");
  const horizon = today.plus({ days: bookingWindowDays });
  return nextStart <= horizon;
}
