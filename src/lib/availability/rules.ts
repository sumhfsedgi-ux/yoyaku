import type { DateTime } from "luxon";
import type { CutoffConfig, InstantRange, MinuteRange, OverrideRule, Weekday, WeeklyRule } from "./types";

/**
 * Pure, dependency-free rule functions for the availability engine. No I/O, no
 * implicit clock reads (`now` is always passed in) - these are the functions
 * unit-tested directly against the spec's overlap/cutoff test cases.
 */

/** Individual-date overrides always win over the weekly rule for that date. */
export function resolveEffectiveRanges(
  weekday: Weekday,
  weekly: WeeklyRule[],
  override: OverrideRule | undefined,
): MinuteRange[] {
  if (override) {
    return override.isClosed ? [] : override.ranges;
  }
  return weekly.find((rule) => rule.dayOfWeek === weekday)?.ranges ?? [];
}

/** Every 15-minute start time within `ranges` that leaves room for a full-duration appointment. */
export function generateCandidateStarts(
  ranges: MinuteRange[],
  durationMinutes: number,
  stepMinutes: number,
): number[] {
  const starts: number[] = [];
  for (const range of ranges) {
    for (let start = range.startMinute; start + durationMinutes <= range.endMinute; start += stepMinutes) {
      starts.push(start);
    }
  }
  return starts;
}

/**
 * The single overlap primitive used everywhere in this system. Half-open
 * intervals [start, end): two intervals that merely touch (aEnd === bStart) do
 * NOT overlap.
 */
export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function overlapsAnyInterval(start: Date, end: Date, intervals: InstantRange[]): boolean {
  return intervals.some((interval) => intervalsOverlap(start, end, interval.start, interval.end));
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * UTC millis of JST midnight for the JST calendar date containing `instant`.
 * Pure integer arithmetic instead of Luxon's `.setZone().startOf("day")` -
 * safe because JST has been a fixed UTC+9 offset with no DST since 1951, so
 * "shift into JST-numbered time, floor to a day boundary, shift back" is
 * exact for any date this app will ever handle. This function alone used to
 * cost ~46us per call (measured); this version is native-Date-arithmetic
 * cheap. See isPastCutoff/isWithinBookingWindow below, both hot-path
 * functions called once per 15-minute candidate (~30-40x per staff per day).
 */
function jstDayStartMillis(instant: DateTime): number {
  const shifted = instant.toMillis() + JST_OFFSET_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS - JST_OFFSET_MS;
}

/**
 * Whether `candidateStart` has already passed the staff's booking cutoff, evaluated
 * as of `now`. Both DateTimes should carry a real zone (Asia/Tokyo) - callers should
 * not pass bare UTC-instant DateTimes without a zone when using DAY_BEFORE_AT_TIME,
 * since that variant reasons about the JST calendar date of the appointment.
 *
 * Computed via millisecond arithmetic rather than Luxon's `.minus()`/`.plus()`
 * Duration machinery - behaviorally identical (verified against the existing
 * isPastCutoff test cases), but this function sits in the availability
 * engine's hottest per-candidate loop, where Luxon's Duration-based math
 * measured ~45-48us/call vs <1us for the equivalent plain arithmetic.
 */
export function isPastCutoff(candidateStart: DateTime, now: DateTime, cutoff: CutoffConfig): boolean {
  const deadlineMs =
    cutoff.type === "HOURS_BEFORE"
      ? candidateStart.toMillis() - cutoff.hours * 60 * 60 * 1000
      : jstDayStartMillis(candidateStart) - cutoff.daysBefore * DAY_MS + cutoff.atMinute * 60 * 1000;

  return now.toMillis() > deadlineMs;
}

/**
 * `dateISO` is bookable if it falls within [today, today + windowDays]
 * inclusive, JST calendar days.
 *
 * Computed via millisecond/epoch-day arithmetic rather than Luxon's
 * `.set().startOf("day")` + `.diff()` - same hot-path rationale as
 * isPastCutoff above (`.diff()` alone measured ~110-118us/call; this version
 * is <1us).
 */
export function isWithinBookingWindow(dateISO: string, todayJst: DateTime, windowDays: number): boolean {
  const candidateEpochDay =
    Date.UTC(Number(dateISO.slice(0, 4)), Number(dateISO.slice(5, 7)) - 1, Number(dateISO.slice(8, 10))) / DAY_MS;
  const todayEpochDay = Math.floor((todayJst.toMillis() + JST_OFFSET_MS) / DAY_MS);
  const daysDiff = candidateEpochDay - todayEpochDay;
  return daysDiff >= 0 && daysDiff <= windowDays;
}
