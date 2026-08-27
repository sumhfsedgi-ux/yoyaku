import { DateTime } from "luxon";
import { SALON_TIME_ZONE } from "@/lib/availability/types";

/** Current instant, expressed in the salon's local zone (Asia/Tokyo) with Japanese locale for display formatting. */
export function nowJst(): DateTime {
  return DateTime.now().setZone(SALON_TIME_ZONE).setLocale("ja");
}

/** Parse a UTC ISO instant string and view it in Asia/Tokyo. */
export function utcIsoToJst(utcIso: string): DateTime {
  return DateTime.fromISO(utcIso, { zone: "utc" }).setZone(SALON_TIME_ZONE).setLocale("ja");
}

/** Parse a JS Date (always a UTC instant under the hood) and view it in Asia/Tokyo. */
export function dateToJst(date: Date): DateTime {
  return DateTime.fromJSDate(date, { zone: "utc" }).setZone(SALON_TIME_ZONE).setLocale("ja");
}

/**
 * Format a start time the way customer-facing copy should show it: JST date +
 * start time only, e.g. "8月30日 13:00〜". Never include the end time here - see
 * plan §18 (customer confirmation emails must not reveal the 90-minute duration).
 */
export function formatStartTimeForCustomer(date: Date): string {
  const jst = dateToJst(date);
  return `${jst.month}月${jst.day}日 ${jst.toFormat("HH:mm")}〜`;
}

/** Full date + start-end range, for staff-facing copy where the duration is fine to show. */
export function formatRangeForStaff(start: Date, end: Date): string {
  const startJst = dateToJst(start);
  const endJst = dateToJst(end);
  return `${startJst.month}月${startJst.day}日 ${startJst.toFormat("HH:mm")}〜${endJst.toFormat("HH:mm")}`;
}
