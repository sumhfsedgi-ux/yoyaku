import type { DateTime } from "luxon";

/** 0 = Sunday .. 6 = Saturday, matching Prisma's WeeklyAvailability.dayOfWeek convention. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Minute-of-day range, 0-1439, always on a 15-minute boundary. No date/timezone attached. */
export interface MinuteRange {
  startMinute: number;
  endMinute: number;
}

/** A concrete instant range (a real point in time on both ends), always UTC Date objects. */
export interface InstantRange {
  start: Date;
  end: Date;
}

export interface WeeklyRule {
  dayOfWeek: Weekday;
  ranges: MinuteRange[];
}

export interface OverrideRule {
  /** ISO date string, e.g. "2026-08-30". */
  date: string;
  isClosed: boolean;
  ranges: MinuteRange[];
}

export type CutoffConfig =
  | { type: "HOURS_BEFORE"; hours: number }
  | { type: "DAY_BEFORE_AT_TIME"; daysBefore: number; atMinute: number };

export interface StaffAvailabilityConfig {
  staffId: string;
  active: boolean;
  weekly: WeeklyRule[];
  overridesByDate: Map<string, OverrideRule>;
  blocks: InstantRange[];
  cutoff: CutoffConfig;
  bookingWindowDays: number;
}

export type UnavailableReason =
  | "INVALID_START_TIME"
  | "OUT_OF_HOURS"
  | "STAFF_BLOCK"
  | "PAST_CUTOFF"
  | "OUT_OF_WINDOW"
  | "ROOM_CONFLICT"
  | "CALENDAR_BUSY"
  | "CALENDAR_UNAVAILABLE";

export type CandidateBookableResult = { ok: true } | { ok: false; reason: UnavailableReason };

export interface Candidate {
  start: DateTime;
  end: DateTime;
}

/** Fixed business rules shared across the whole availability engine. */
export const APPOINTMENT_DURATION_MINUTES = 90;
export const SLOT_STEP_MINUTES = 15;
export const SALON_TIME_ZONE = "Asia/Tokyo";
