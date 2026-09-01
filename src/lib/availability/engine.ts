import { DateTime } from "luxon";
import {
  isPastCutoff,
  isWithinBookingWindow,
  overlapsAnyInterval,
  generateCandidateStarts,
  resolveEffectiveRanges,
  getOccupiedRange,
} from "./rules";
import type {
  CandidateBookableResult,
  InstantRange,
  StaffAvailabilityConfig,
  Weekday,
} from "./types";
import { MAX_RESERVATION_QUERY_PADDING_MINUTES, SALON_TIME_ZONE, SERVICE_DURATION_MINUTES, SLOT_STEP_MINUTES } from "./types";

/** Buffers every reservation's raw stored [start,end) into its occupied
 *  [occupiedStart,occupiedEnd) window - conflict checks against other
 *  reservations must compare occupied ranges on both sides, never raw ones. */
function bufferReservations(reservations: InstantRange[]): InstantRange[] {
  return reservations.map((r) => {
    const { occupiedStart, occupiedEnd } = getOccupiedRange(r.start, r.end);
    return { start: occupiedStart, end: occupiedEnd };
  });
}

/**
 * Data access this engine needs, injected by the caller. Real implementations
 * live in ./data.ts (Prisma + Google Calendar). Tests pass fakes/in-memory
 * stand-ins directly, keeping this file and rules.ts DB- and network-free.
 */
export interface ComputeSlotsDeps {
  /**
   * `overrideRangeStartISO`/`overrideRangeEndISO` (inclusive JST calendar
   * dates) bound which ScheduleOverride rows get loaded - each caller below
   * only ever looks up an override for a date within the range it itself is
   * computing candidates for, so implementations may safely ignore overrides
   * outside this range (see data.ts, which filters the DB query by it).
   */
  loadStaffConfig(staffId: string, overrideRangeStartISO: string, overrideRangeEndISO: string): Promise<StaffAvailabilityConfig | null>;
  /**
   * CONFIRMED reservations for the room, across ALL staff, that could overlap
   * [rangeStart, rangeEnd). `excludeReservationId` is used by reschedule so a
   * reservation being moved doesn't collide with its own current row.
   */
  loadRoomReservations(
    roomId: string,
    rangeStart: Date,
    rangeEnd: Date,
    excludeReservationId?: string,
  ): Promise<InstantRange[]>;
  /** null busy list is not the same as ok:false - ok:false means "could not check". */
  loadCalendarBusy(
    roomId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<{ ok: true; busy: InstantRange[] } | { ok: false }>;
  resolvePrimaryRoomId(): Promise<string | null>;
}

function toWeekday(dt: DateTime): Weekday {
  // Luxon's weekday is 1=Monday..7=Sunday; this system's convention is 0=Sunday..6=Saturday.
  return (dt.weekday % 7) as Weekday;
}

/** Any candidate's buffered occupied window can spill into the neighboring calendar day. */
function widenedDayQueryWindow(dayStartJst: DateTime): { rangeStart: Date; rangeEnd: Date } {
  const dayEndJst = dayStartJst.plus({ days: 1 });
  return {
    rangeStart: dayStartJst.minus({ minutes: MAX_RESERVATION_QUERY_PADDING_MINUTES }).toJSDate(),
    rangeEnd: dayEndJst.plus({ minutes: MAX_RESERVATION_QUERY_PADDING_MINUTES }).toJSDate(),
  };
}

/**
 * `roomReservations` must already be buffered (occupied ranges, not raw
 * stored [start,end) values) by the time it reaches this function - see
 * bufferReservations, applied once by each caller right after fetching. This
 * keeps every conflict decision in this file operating on occupied ranges
 * uniformly, while business-hours checking below stays on the raw candidate
 * window (only the actual service time needs to fit inside business hours,
 * per plan - not the buffer either side of it).
 */
function isCandidateBookable(
  candidateStart: DateTime,
  candidateEnd: DateTime,
  config: StaffAvailabilityConfig,
  roomReservations: InstantRange[],
  calendarBusy: InstantRange[] | null,
  now: DateTime,
): CandidateBookableResult {
  // Every valid slot starts on a 15-minute boundary with zero seconds - this
  // must be re-checked here (not just relied on in generateCandidateStarts),
  // since validateSlotBookable calls straight into this function with a
  // startAtUtcIso taken directly from an untrusted request body. Without this,
  // a forged request for e.g. 10:07 would pass every other check as long as
  // its 90-minute span fit inside business hours (spec test 13).
  if (candidateStart.second !== 0 || candidateStart.millisecond !== 0 || candidateStart.minute % SLOT_STEP_MINUTES !== 0) {
    return { ok: false, reason: "INVALID_START_TIME" };
  }

  const weekday = toWeekday(candidateStart);
  const dateISO = candidateStart.toISODate()!;
  const override = config.overridesByDate.get(dateISO);
  const effectiveRanges = resolveEffectiveRanges(weekday, config.weekly, override);

  const startMinute = candidateStart.hour * 60 + candidateStart.minute;
  const withinHours = effectiveRanges.some(
    (range) => startMinute >= range.startMinute && startMinute + SERVICE_DURATION_MINUTES <= range.endMinute,
  );
  if (!withinHours) return { ok: false, reason: "OUT_OF_HOURS" };

  const startJs = candidateStart.toJSDate();
  const endJs = candidateEnd.toJSDate();
  const { occupiedStart, occupiedEnd } = getOccupiedRange(startJs, endJs);

  if (isPastCutoff(candidateStart, now, config.cutoff)) return { ok: false, reason: "PAST_CUTOFF" };
  if (!isWithinBookingWindow(dateISO, now.setZone(SALON_TIME_ZONE), config.bookingWindowDays)) {
    return { ok: false, reason: "OUT_OF_WINDOW" };
  }
  // Room/Calendar conflicts use the buffered occupied window - business hours
  // above deliberately did not. calendarBusy is compared unbuffered on its own
  // side: only the candidate gets a buffer against a Google interval (whether
  // genuinely external or this app's own already-buffered synced event).
  if (overlapsAnyInterval(occupiedStart, occupiedEnd, roomReservations)) return { ok: false, reason: "ROOM_CONFLICT" };
  if (calendarBusy === null) return { ok: false, reason: "CALENDAR_UNAVAILABLE" };
  if (overlapsAnyInterval(occupiedStart, occupiedEnd, calendarBusy)) return { ok: false, reason: "CALENDAR_BUSY" };

  return { ok: true };
}

/**
 * Walks every 15-minute candidate start on `dateISO` in rule-chain order,
 * calling `onBookable` for each one that passes `isCandidateBookable`.
 * Returning true from `onBookable` stops the walk early. Shared by
 * computeAvailableSlots (collects every slot) and computeAvailabilityForRange
 * (stops at the first hit, since it only needs a yes/no per day) so the two
 * can never diverge - the range function's ○/× can never disagree with what
 * computeAvailableSlots would actually return for that same day.
 */
function forEachBookableCandidate(
  dayStartJst: DateTime,
  dateISO: string,
  config: StaffAvailabilityConfig,
  roomReservations: InstantRange[],
  calendarBusy: InstantRange[] | null,
  now: DateTime,
  onBookable: (candidateStart: DateTime) => boolean,
): void {
  const weekday = toWeekday(dayStartJst);
  const override = config.overridesByDate.get(dateISO);
  const effectiveRanges = resolveEffectiveRanges(weekday, config.weekly, override);
  const candidateStarts = generateCandidateStarts(effectiveRanges, SERVICE_DURATION_MINUTES, SLOT_STEP_MINUTES);

  for (const startMinute of candidateStarts) {
    const candidateStart = dayStartJst.plus({ minutes: startMinute });
    const candidateEnd = candidateStart.plus({ minutes: SERVICE_DURATION_MINUTES });
    const result = isCandidateBookable(candidateStart, candidateEnd, config, roomReservations, calendarBusy, now);
    if (result.ok && onBookable(candidateStart)) return;
  }
}

export type ComputeAvailableSlotsResult =
  | { ok: true; slots: string[] }
  | { ok: false; reason: "CALENDAR_UNAVAILABLE" | "STAFF_NOT_FOUND" | "STAFF_INACTIVE" | "ROOM_NOT_FOUND" };

/**
 * Every bookable 15-minute start time (as UTC ISO strings) for `staffId` on
 * `dateISO` (JST calendar date). The exclude* params exist for the reschedule
 * UI: without them, a reservation's own current DB row and still-unmoved
 * Google Calendar event would make nearby candidates falsely show as taken
 * (see validateSlotBookable's docs for the same issue at confirmation time -
 * this keeps listing and validation using identical logic, per plan §4).
 */
export async function computeAvailableSlots(
  params: {
    staffId: string;
    dateISO: string;
    now?: DateTime;
    excludeReservationId?: string;
    excludeCalendarBusyInterval?: InstantRange;
  },
  deps: ComputeSlotsDeps,
): Promise<ComputeAvailableSlotsResult> {
  const now = params.now ?? DateTime.now().setZone(SALON_TIME_ZONE);
  // loadStaffConfig and resolvePrimaryRoomId don't depend on each other's
  // result - this is called on every date the customer/staff picks, so
  // running them in parallel instead of one-after-another shaves a full DB
  // round trip off the hottest path in the app.
  const [config, roomId] = await Promise.all([
    deps.loadStaffConfig(params.staffId, params.dateISO, params.dateISO),
    deps.resolvePrimaryRoomId(),
  ]);
  if (!config) return { ok: false, reason: "STAFF_NOT_FOUND" };
  if (!config.active) return { ok: false, reason: "STAFF_INACTIVE" };
  if (!roomId) return { ok: false, reason: "ROOM_NOT_FOUND" };

  const dayStartJst = DateTime.fromISO(params.dateISO, { zone: SALON_TIME_ZONE }).startOf("day");
  const { rangeStart, rangeEnd } = widenedDayQueryWindow(dayStartJst);

  const [roomReservations, calendarResult] = await Promise.all([
    deps.loadRoomReservations(roomId, rangeStart, rangeEnd, params.excludeReservationId),
    deps.loadCalendarBusy(roomId, rangeStart, rangeEnd),
  ]);
  if (!calendarResult.ok) return { ok: false, reason: "CALENDAR_UNAVAILABLE" };

  const occupiedRoomReservations = bufferReservations(roomReservations);

  const exclude = params.excludeCalendarBusyInterval;
  const calendarBusy = exclude
    ? calendarResult.busy.filter(
        (b) => !(b.start.getTime() === exclude.start.getTime() && b.end.getTime() === exclude.end.getTime()),
      )
    : calendarResult.busy;

  const slots: string[] = [];
  forEachBookableCandidate(dayStartJst, params.dateISO, config, occupiedRoomReservations, calendarBusy, now, (candidateStart) => {
    slots.push(candidateStart.toUTC().toISO()!);
    return false;
  });

  return { ok: true, slots };
}

export type ValidateSlotBookableResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "INVALID_START_TIME"
        | "OUT_OF_HOURS"
        | "PAST_CUTOFF"
        | "OUT_OF_WINDOW"
        | "ROOM_CONFLICT"
        | "CALENDAR_BUSY"
        | "CALENDAR_UNAVAILABLE"
        | "STAFF_NOT_FOUND"
        | "STAFF_INACTIVE"
        | "ROOM_NOT_FOUND";
    };

/**
 * Re-validates a single candidate start time. Called from the booking-confirmation
 * path (createReservation/rescheduleReservation) with a live Calendar freebusy
 * check, using the exact same rule functions as computeAvailableSlots.
 */
export async function validateSlotBookable(
  params: {
    staffId: string;
    startAtUtcIso: string;
    now?: DateTime;
    excludeReservationId?: string;
    /**
     * Reschedule only: the reservation-being-moved's CURRENT [start, end) - its
     * own Google Calendar event still exists at this old time until the
     * post-commit sync runs, so without this it would falsely read back as
     * "room busy" against itself when the new time overlaps the old one.
     * excludeReservationId already handles the equivalent case for the DB
     * reservations table; freebusy has no event-id-based exclusion, so this is
     * filtered by exact interval match instead.
     */
    excludeCalendarBusyInterval?: InstantRange;
  },
  deps: ComputeSlotsDeps,
): Promise<ValidateSlotBookableResult> {
  const now = params.now ?? DateTime.now().setZone(SALON_TIME_ZONE);
  // Parsing startAtUtcIso doesn't depend on config/roomId - done first purely
  // so its date can bound the ScheduleOverride lookup below (no DB access here).
  const candidateStart = DateTime.fromISO(params.startAtUtcIso, { zone: "utc" }).setZone(SALON_TIME_ZONE);
  const candidateEnd = candidateStart.plus({ minutes: SERVICE_DURATION_MINUTES });
  // A malformed startAtUtcIso (e.g. a forged request) yields an invalid
  // DateTime here - isCandidateBookable's own check below is what actually
  // rejects it (INVALID_START_TIME); this fallback only keeps the override
  // lookup's date range well-formed so that later check is reached at all.
  const candidateDateISO = candidateStart.isValid ? candidateStart.toISODate()! : now.toISODate()!;

  // Same independent-lookup parallelization as computeAvailableSlots above -
  // this path runs again at booking confirmation, so it matters just as much.
  const [config, roomId] = await Promise.all([
    deps.loadStaffConfig(params.staffId, candidateDateISO, candidateDateISO),
    deps.resolvePrimaryRoomId(),
  ]);
  if (!config) return { ok: false, reason: "STAFF_NOT_FOUND" };
  if (!config.active) return { ok: false, reason: "STAFF_INACTIVE" };
  if (!roomId) return { ok: false, reason: "ROOM_NOT_FOUND" };

  const rangeStart = candidateStart.minus({ minutes: MAX_RESERVATION_QUERY_PADDING_MINUTES }).toJSDate();
  const rangeEnd = candidateEnd.plus({ minutes: MAX_RESERVATION_QUERY_PADDING_MINUTES }).toJSDate();

  const [roomReservations, calendarResult] = await Promise.all([
    deps.loadRoomReservations(roomId, rangeStart, rangeEnd, params.excludeReservationId),
    deps.loadCalendarBusy(roomId, rangeStart, rangeEnd),
  ]);

  const occupiedRoomReservations = bufferReservations(roomReservations);

  const exclude = params.excludeCalendarBusyInterval;
  const calendarBusy =
    calendarResult.ok && exclude
      ? calendarResult.busy.filter(
          (b) => !(b.start.getTime() === exclude.start.getTime() && b.end.getTime() === exclude.end.getTime()),
        )
      : calendarResult.ok
        ? calendarResult.busy
        : null;

  return isCandidateBookable(candidateStart, candidateEnd, config, occupiedRoomReservations, calendarBusy, now);
}

/**
 * Buckets `intervals` by which day's WIDENED query window (per
 * widenedDayQueryWindow - ±90min padding, since a 90-minute appointment can
 * spill past midnight) each one overlaps. An interval near a day boundary
 * can land in two adjacent buckets - that's intentional and required for
 * correctness (a 23:30-01:00 spanning reservation must still be visible to
 * both days' candidate checks), not a bug to dedupe away.
 *
 * Without this, computeAvailabilityForRange re-scanned the ENTIRE range's
 * reservation/busy lists for every one of ~14×35 candidates regardless of
 * which day they belonged to - O(days × candidatesPerDay × totalIntervals).
 * Bucketing once up front turns the hot loop into O(days × candidatesPerDay ×
 * intervalsForThatDay) instead, which is what actually matters since a given
 * candidate can only ever conflict with intervals on its own day anyway.
 */
function bucketIntervalsByDay(
  intervals: InstantRange[],
  dayWindows: Array<{ dateISO: string; rangeStart: Date; rangeEnd: Date }>,
): Map<string, InstantRange[]> {
  const byDate = new Map<string, InstantRange[]>();
  for (const { dateISO } of dayWindows) byDate.set(dateISO, []);
  for (const interval of intervals) {
    for (const { dateISO, rangeStart, rangeEnd } of dayWindows) {
      if (interval.start < rangeEnd && interval.end > rangeStart) {
        byDate.get(dateISO)!.push(interval);
      }
    }
  }
  return byDate;
}

export type ComputeAvailabilityForRangeResult =
  | { ok: true; days: Array<{ dateISO: string; available: boolean }> }
  | { ok: false; reason: "CALENDAR_UNAVAILABLE" | "STAFF_NOT_FOUND" | "STAFF_INACTIVE" | "ROOM_NOT_FOUND" };

/**
 * Per-day "is there at least one bookable slot" for every date from
 * startDateISO through endDateISO (inclusive), for the date-grid picker.
 * Loads staff config, room reservations, and calendar busy ONCE for the
 * whole range (not once per day) and then walks each day with
 * forEachBookableCandidate, stopping at the first bookable candidate - the
 * exact same rule chain computeAvailableSlots uses for a single day, so a ○
 * day can never turn out to have zero real slots when actually opened.
 */
export async function computeAvailabilityForRange(
  params: { staffId: string; startDateISO: string; endDateISO: string; now?: DateTime },
  deps: ComputeSlotsDeps,
): Promise<ComputeAvailabilityForRangeResult> {
  const now = params.now ?? DateTime.now().setZone(SALON_TIME_ZONE);
  const [config, roomId] = await Promise.all([
    deps.loadStaffConfig(params.staffId, params.startDateISO, params.endDateISO),
    deps.resolvePrimaryRoomId(),
  ]);
  if (!config) return { ok: false, reason: "STAFF_NOT_FOUND" };
  if (!config.active) return { ok: false, reason: "STAFF_INACTIVE" };
  if (!roomId) return { ok: false, reason: "ROOM_NOT_FOUND" };

  const firstDayStartJst = DateTime.fromISO(params.startDateISO, { zone: SALON_TIME_ZONE }).startOf("day");
  const lastDayStartJst = DateTime.fromISO(params.endDateISO, { zone: SALON_TIME_ZONE }).startOf("day");
  const rangeStart = widenedDayQueryWindow(firstDayStartJst).rangeStart;
  const rangeEnd = widenedDayQueryWindow(lastDayStartJst).rangeEnd;

  const [roomReservations, calendarResult] = await Promise.all([
    deps.loadRoomReservations(roomId, rangeStart, rangeEnd),
    deps.loadCalendarBusy(roomId, rangeStart, rangeEnd),
  ]);
  if (!calendarResult.ok) return { ok: false, reason: "CALENDAR_UNAVAILABLE" };

  const dayCount = Math.round(lastDayStartJst.diff(firstDayStartJst, "days").days) + 1;
  const dayStarts = Array.from({ length: dayCount }, (_, i) => firstDayStartJst.plus({ days: i }));
  const dayWindows = dayStarts.map((dayStartJst) => ({
    dateISO: dayStartJst.toISODate()!,
    ...widenedDayQueryWindow(dayStartJst),
  }));
  const reservationsByDay = bucketIntervalsByDay(bufferReservations(roomReservations), dayWindows);
  const busyByDay = bucketIntervalsByDay(calendarResult.busy, dayWindows);

  const days = dayStarts.map((dayStartJst, i) => {
    const { dateISO } = dayWindows[i];
    let available = false;
    forEachBookableCandidate(
      dayStartJst,
      dateISO,
      config,
      reservationsByDay.get(dateISO)!,
      busyByDay.get(dateISO)!,
      now,
      () => {
        available = true;
        return true;
      },
    );
    return { dateISO, available };
  });
  return { ok: true, days };
}
