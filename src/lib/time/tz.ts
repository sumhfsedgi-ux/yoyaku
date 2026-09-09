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

/** Same weekday-label convention used by DateStrip/MonthGrid/ScheduleMonthPicker etc: index by Luxon's `weekday % 7` (0=Sun..6=Sat). */
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** JST date with weekday, e.g. "9月22日（火）" - used by the reservation email template's {{reservationDate}}/{{reservationDateTime}} tags. */
export function formatReservationDateForCustomer(date: Date): string {
  const jst = dateToJst(date);
  return `${jst.month}月${jst.day}日（${WEEKDAY_JA[jst.weekday % 7]}）`;
}

/** JST clock time only, e.g. "18:00". */
export function formatClockTime(date: Date): string {
  return dateToJst(date).toFormat("HH:mm");
}

/** Full date + start-end range, for staff-facing copy where the duration is fine to show. */
export function formatRangeForStaff(start: Date, end: Date): string {
  const startJst = dateToJst(start);
  const endJst = dateToJst(end);
  return `${startJst.month}月${startJst.day}日 ${startJst.toFormat("HH:mm")}〜${endJst.toFormat("HH:mm")}`;
}
