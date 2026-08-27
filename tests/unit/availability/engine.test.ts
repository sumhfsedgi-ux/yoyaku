import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  computeAvailableSlots,
  computeAvailabilityForRange,
  validateSlotBookable,
  type ComputeSlotsDeps,
} from "@/lib/availability/engine";
import type { InstantRange, StaffAvailabilityConfig } from "@/lib/availability/types";
import { SALON_TIME_ZONE } from "@/lib/availability/types";

const ROOM_ID = "room_001";
const STAFF_A = "stf_a";

function jst(iso: string): Date {
  return DateTime.fromISO(iso, { zone: SALON_TIME_ZONE }).toJSDate();
}

function baseConfig(staffId: string, overrides: Partial<StaffAvailabilityConfig> = {}): StaffAvailabilityConfig {
  return {
    staffId,
    active: true,
    weekly: [
      { dayOfWeek: 0, ranges: [] },
      { dayOfWeek: 1, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 2, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 3, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 4, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 5, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 6, ranges: [] },
    ],
    overridesByDate: new Map(),
    cutoff: { type: "HOURS_BEFORE", hours: 0 },
    bookingWindowDays: 60,
    ...overrides,
  };
}

type FakeReservation = InstantRange & { id?: string };

interface FakeWorld {
  configs: Map<string, StaffAvailabilityConfig>;
  roomReservations: FakeReservation[];
  calendarBusy: InstantRange[] | "unavailable";
}

function makeDeps(world: FakeWorld): ComputeSlotsDeps {
  return {
    async loadStaffConfig(staffId) {
      return world.configs.get(staffId) ?? null;
    },
    async loadRoomReservations(_roomId, rangeStart, rangeEnd, excludeReservationId) {
      return world.roomReservations.filter(
        (r) => r.start < rangeEnd && r.end > rangeStart && (excludeReservationId ? r.id !== excludeReservationId : true),
      );
    },
    async loadCalendarBusy(_roomId, rangeStart, rangeEnd) {
      if (world.calendarBusy === "unavailable") return { ok: false };
      return { ok: true, busy: world.calendarBusy.filter((b) => b.start < rangeEnd && b.end > rangeStart) };
    },
    async resolvePrimaryRoomId() {
      return ROOM_ID;
    },
  };
}

// 2026-08-31 is a Monday (dayOfWeek=1 in our 0=Sun..6=Sat convention).
const MONDAY = "2026-08-31";
const NOW = DateTime.fromISO("2026-08-24T09:00", { zone: SALON_TIME_ZONE });

describe("computeAvailableSlots", () => {
  it("returns the full set of 15-minute candidates within business hours when nothing conflicts", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [],
      calendarBusy: [],
    };
    const result = await computeAvailableSlots({ staffId: STAFF_A, dateISO: MONDAY, now: NOW }, makeDeps(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 10:00-19:00 range, last bookable start is 17:30 (17:30-19:00)
    expect(result.slots[0]).toBe(DateTime.fromISO(`${MONDAY}T10:00`, { zone: SALON_TIME_ZONE }).toUTC().toISO());
    expect(result.slots.at(-1)).toBe(
      DateTime.fromISO(`${MONDAY}T17:30`, { zone: SALON_TIME_ZONE }).toUTC().toISO(),
    );
  });

  it("case 4: staff A has no reservations of her own, but staff B's room reservation blocks the shared room", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [{ start: jst(`${MONDAY}T13:00`), end: jst(`${MONDAY}T14:30`) }],
      calendarBusy: [],
    };
    const result = await computeAvailableSlots({ staffId: STAFF_A, dateISO: MONDAY, now: NOW }, makeDeps(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const blockedStart = DateTime.fromISO(`${MONDAY}T13:00`, { zone: SALON_TIME_ZONE }).toUTC().toISO();
    const nextAvailable = DateTime.fromISO(`${MONDAY}T14:30`, { zone: SALON_TIME_ZONE }).toUTC().toISO();
    expect(result.slots).not.toContain(blockedStart);
    expect(result.slots).toContain(nextAvailable);
  });

  it("case 5: a Google Calendar busy interval removes overlapping candidates", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [],
      calendarBusy: [{ start: jst(`${MONDAY}T15:00`), end: jst(`${MONDAY}T16:00`) }],
    };
    const result = await computeAvailableSlots({ staffId: STAFF_A, dateISO: MONDAY, now: NOW }, makeDeps(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 14:30-16:00 candidate overlaps the 15:00-16:00 Google event -> excluded
    const overlapping = DateTime.fromISO(`${MONDAY}T14:30`, { zone: SALON_TIME_ZONE }).toUTC().toISO();
    // 16:00-17:30 does not overlap -> included
    const clear = DateTime.fromISO(`${MONDAY}T16:00`, { zone: SALON_TIME_ZONE }).toUTC().toISO();
    expect(result.slots).not.toContain(overlapping);
    expect(result.slots).toContain(clear);
  });

  it("case 6: Google Calendar check failing fails the whole day safe, not partial results", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [],
      calendarBusy: "unavailable",
    };
    const result = await computeAvailableSlots({ staffId: STAFF_A, dateISO: MONDAY, now: NOW }, makeDeps(world));
    expect(result).toEqual({ ok: false, reason: "CALENDAR_UNAVAILABLE" });
  });

  it("respects the booking cutoff and window when computing today's or far-future slots", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A, { cutoff: { type: "HOURS_BEFORE", hours: 3 } })]]),
      roomReservations: [],
      calendarBusy: [],
    };
    const nowLate = DateTime.fromISO(`${MONDAY}T17:00`, { zone: SALON_TIME_ZONE });
    const result = await computeAvailableSlots({ staffId: STAFF_A, dateISO: MONDAY, now: nowLate }, makeDeps(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 17:30 start is only 30 min away, less than the 3-hour cutoff -> excluded
    const tooSoon = DateTime.fromISO(`${MONDAY}T17:30`, { zone: SALON_TIME_ZONE }).toUTC().toISO();
    expect(result.slots).not.toContain(tooSoon);
  });

  it("reschedule listing: excludeReservationId/excludeCalendarBusyInterval keep a reservation's own current slot from hiding nearby candidates", async () => {
    const ownReservation: FakeReservation = { start: jst(`${MONDAY}T13:00`), end: jst(`${MONDAY}T14:30`), id: "resv_self" };
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [ownReservation],
      calendarBusy: [{ start: jst(`${MONDAY}T13:00`), end: jst(`${MONDAY}T14:30`) }],
    };
    const result = await computeAvailableSlots(
      {
        staffId: STAFF_A,
        dateISO: MONDAY,
        now: NOW,
        excludeReservationId: "resv_self",
        excludeCalendarBusyInterval: { start: jst(`${MONDAY}T13:00`), end: jst(`${MONDAY}T14:30`) },
      },
      makeDeps(world),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 13:15 would overlap the reservation's own old [13:00,14:30) span in both
    // the room-reservations table and the calendar - without exclusion it
    // would be falsely hidden.
    const nearOwnSlot = DateTime.fromISO(`${MONDAY}T13:15`, { zone: SALON_TIME_ZONE }).toUTC().toISO();
    expect(result.slots).toContain(nearOwnSlot);
  });
});

describe("validateSlotBookable", () => {
  it("case 8 (single-request half): re-validating a slot that is already taken in the room returns ROOM_CONFLICT", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [{ start: jst(`${MONDAY}T13:00`), end: jst(`${MONDAY}T14:30`) }],
      calendarBusy: [],
    };
    const startAtUtcIso = DateTime.fromISO(`${MONDAY}T13:00`, { zone: SALON_TIME_ZONE }).toUTC().toISO()!;
    const result = await validateSlotBookable({ staffId: STAFF_A, startAtUtcIso, now: NOW }, makeDeps(world));
    expect(result).toEqual({ ok: false, reason: "ROOM_CONFLICT" });
  });

  it("reschedule: excludeReservationId lets a reservation's own current slot not conflict with itself", async () => {
    const reservation: FakeReservation = { start: jst(`${MONDAY}T13:00`), end: jst(`${MONDAY}T14:30`), id: "resv_1" };
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [reservation],
      calendarBusy: [],
    };
    const startAtUtcIso = DateTime.fromISO(`${MONDAY}T13:00`, { zone: SALON_TIME_ZONE }).toUTC().toISO()!;
    const result = await validateSlotBookable(
      { staffId: STAFF_A, startAtUtcIso, now: NOW, excludeReservationId: "resv_1" },
      makeDeps(world),
    );
    expect(result).toEqual({ ok: true });
  });

  it("reschedule: excludeCalendarBusyInterval lets a reservation's own still-unmoved Google event not conflict with its new time", async () => {
    // The reservation's OWN Google Calendar event is still sitting at its old
    // time (13:00-14:30) until the post-commit sync moves it - without
    // excluding that exact interval, moving to an overlapping new time
    // (13:15-14:45) would falsely read back as CALENDAR_BUSY against itself.
    const oldInterval = { start: jst(`${MONDAY}T13:00`), end: jst(`${MONDAY}T14:30`) };
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [],
      calendarBusy: [oldInterval],
    };
    const newStart = DateTime.fromISO(`${MONDAY}T13:15`, { zone: SALON_TIME_ZONE }).toUTC().toISO()!;
    const result = await validateSlotBookable(
      { staffId: STAFF_A, startAtUtcIso: newStart, now: NOW, excludeCalendarBusyInterval: oldInterval },
      makeDeps(world),
    );
    expect(result).toEqual({ ok: true });
  });

  it("excludeCalendarBusyInterval only filters an exact match - a genuinely different busy event still blocks", async () => {
    const oldInterval = { start: jst(`${MONDAY}T13:00`), end: jst(`${MONDAY}T14:30`) };
    const otherEvent = { start: jst(`${MONDAY}T15:00`), end: jst(`${MONDAY}T16:00`) };
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [],
      calendarBusy: [oldInterval, otherEvent],
    };
    const newStart = DateTime.fromISO(`${MONDAY}T14:30`, { zone: SALON_TIME_ZONE }).toUTC().toISO()!;
    const result = await validateSlotBookable(
      { staffId: STAFF_A, startAtUtcIso: newStart, now: NOW, excludeCalendarBusyInterval: oldInterval },
      makeDeps(world),
    );
    expect(result).toEqual({ ok: false, reason: "CALENDAR_BUSY" });
  });

  it("a fully clear slot validates ok", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [],
      calendarBusy: [],
    };
    const startAtUtcIso = DateTime.fromISO(`${MONDAY}T11:00`, { zone: SALON_TIME_ZONE }).toUTC().toISO()!;
    const result = await validateSlotBookable({ staffId: STAFF_A, startAtUtcIso, now: NOW }, makeDeps(world));
    expect(result).toEqual({ ok: true });
  });

  it("case 13: a start time not on a 15-minute boundary is rejected even when the 90-minute span fits within business hours", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [],
      calendarBusy: [],
    };
    // 10:07 is well within the 10:00-19:00 range and conflicts with nothing -
    // only the 15-minute alignment check should reject it. A forged/direct
    // request (bypassing the chip-based UI, which only ever offers aligned
    // times) must not be able to slip an off-grid appointment through.
    const startAtUtcIso = DateTime.fromISO(`${MONDAY}T10:07`, { zone: SALON_TIME_ZONE }).toUTC().toISO()!;
    const result = await validateSlotBookable({ staffId: STAFF_A, startAtUtcIso, now: NOW }, makeDeps(world));
    expect(result).toEqual({ ok: false, reason: "INVALID_START_TIME" });
  });

  it("case 14: a direct request for a slot already past the staff's booking cutoff is rejected", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A, { cutoff: { type: "HOURS_BEFORE", hours: 3 } })]]),
      roomReservations: [],
      calendarBusy: [],
    };
    const nowLate = DateTime.fromISO(`${MONDAY}T17:00`, { zone: SALON_TIME_ZONE });
    // 17:30 is only 30 minutes away - inside the 15-minute grid and within
    // business hours, but past the 3-hour cutoff.
    const startAtUtcIso = DateTime.fromISO(`${MONDAY}T17:30`, { zone: SALON_TIME_ZONE }).toUTC().toISO()!;
    const result = await validateSlotBookable(
      { staffId: STAFF_A, startAtUtcIso, now: nowLate },
      makeDeps(world),
    );
    expect(result).toEqual({ ok: false, reason: "PAST_CUTOFF" });
  });

  it("case 15: a direct request for a date beyond the staff's booking window is rejected", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A, { bookingWindowDays: 30 })]]),
      roomReservations: [],
      calendarBusy: [],
    };
    // NOW is 2026-08-24; 60 days out is well beyond the 30-day window.
    const farMonday = NOW.plus({ days: 60 }).set({ weekday: 1 });
    const startAtUtcIso = farMonday.set({ hour: 11, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO()!;
    const result = await validateSlotBookable(
      { staffId: STAFF_A, startAtUtcIso, now: NOW },
      makeDeps(world),
    );
    expect(result).toEqual({ ok: false, reason: "OUT_OF_WINDOW" });
  });

  // Weekly config with Thursday (dayOfWeek=4) closed, used by the two tests
  // below - regression coverage for a report where a staff member set
  // Thursday to 休み but customer/manual-reservation screens still showed
  // Thursdays as bookable.
  const THURSDAY_CLOSED_WEEKLY: StaffAvailabilityConfig["weekly"] = [
    { dayOfWeek: 0, ranges: [] },
    { dayOfWeek: 1, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
    { dayOfWeek: 2, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
    { dayOfWeek: 3, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
    { dayOfWeek: 4, ranges: [] },
    { dayOfWeek: 5, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
    { dayOfWeek: 6, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
  ];

  it("a forged request for a normally-closed weekday (Thursday, empty weekly ranges) is rejected as OUT_OF_HOURS, even with no room/calendar conflicts", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A, { weekly: THURSDAY_CLOSED_WEEKLY })]]),
      roomReservations: [],
      calendarBusy: [],
    };
    // 2026-09-03 is a Thursday, would be a perfectly normal 10:00 slot if the
    // day were open - a UI bypass (forged/direct Server Action call) must
    // still be rejected by the same rules the ○/× grid uses, not just hidden
    // from the picker.
    const startAtUtcIso = DateTime.fromISO("2026-09-03T10:00", { zone: SALON_TIME_ZONE }).toUTC().toISO()!;
    const result = await validateSlotBookable({ staffId: STAFF_A, startAtUtcIso, now: NOW }, makeDeps(world));
    expect(result).toEqual({ ok: false, reason: "OUT_OF_HOURS" });
  });

  it("an override reopening a normally-closed weekday makes a direct request for that exact date succeed (override takes precedence)", async () => {
    const world: FakeWorld = {
      configs: new Map([
        [
          STAFF_A,
          baseConfig(STAFF_A, {
            weekly: THURSDAY_CLOSED_WEEKLY,
            overridesByDate: new Map([
              ["2026-09-03", { date: "2026-09-03", isClosed: false, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] }],
            ]),
          }),
        ],
      ]),
      roomReservations: [],
      calendarBusy: [],
    };
    const startAtUtcIso = DateTime.fromISO("2026-09-03T10:00", { zone: SALON_TIME_ZONE }).toUTC().toISO()!;
    const result = await validateSlotBookable({ staffId: STAFF_A, startAtUtcIso, now: NOW }, makeDeps(world));
    expect(result).toEqual({ ok: true });
  });
});

describe("computeAvailabilityForRange", () => {
  // 2026-08-24 is the Monday just before MONDAY (2026-08-31), and is NOW's
  // own calendar date - used as the 14-day window's anchor for every case
  // below so the fixed weekly schedule (Sun/Sat closed) lines up predictably.
  const RANGE_START = "2026-08-24";
  const RANGE_END = "2026-09-06"; // RANGE_START + 13 days

  it("baseline: weekdays are ○, the weekly Sun/Sat off-days are × across the whole window", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [],
      calendarBusy: [],
    };
    const result = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      makeDeps(world),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toHaveLength(14);
    for (const day of result.days) {
      const weekday = DateTime.fromISO(day.dateISO, { zone: SALON_TIME_ZONE }).weekday % 7; // 0=Sun..6=Sat
      const expectAvailable = weekday !== 0 && weekday !== 6;
      expect(day.available, `${day.dateISO} (weekday ${weekday})`).toBe(expectAvailable);
    }
  });

  it("a room reservation filling one weekday's entire business hours makes only that day ×", async () => {
    const bookedDay = "2026-08-26"; // Wednesday, within the range
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [{ start: jst(`${bookedDay}T10:00`), end: jst(`${bookedDay}T19:00`) }],
      calendarBusy: [],
    };
    const result = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      makeDeps(world),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.find((d) => d.dateISO === bookedDay)?.available).toBe(false);
    expect(result.days.find((d) => d.dateISO === "2026-08-25")?.available).toBe(true);
    expect(result.days.find((d) => d.dateISO === "2026-08-27")?.available).toBe(true);
  });

  it("Google Calendar busy filling one weekday's entire business hours makes only that day ×", async () => {
    const bookedDay = "2026-08-27"; // Thursday, within the range
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [],
      calendarBusy: [{ start: jst(`${bookedDay}T10:00`), end: jst(`${bookedDay}T19:00`) }],
    };
    const result = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      makeDeps(world),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.find((d) => d.dateISO === bookedDay)?.available).toBe(false);
    expect(result.days.find((d) => d.dateISO === "2026-08-26")?.available).toBe(true);
    expect(result.days.find((d) => d.dateISO === "2026-08-28")?.available).toBe(true);
  });

  it("a Google Calendar check failure for the whole range returns CALENDAR_UNAVAILABLE, not 14 silent ×s", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [],
      calendarBusy: "unavailable",
    };
    const result = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      makeDeps(world),
    );
    expect(result).toEqual({ ok: false, reason: "CALENDAR_UNAVAILABLE" });
  });

  it("a per-date override closing an otherwise-open weekday makes only that day ×", async () => {
    const closedDay = "2026-08-25"; // Tuesday, normally open
    const world: FakeWorld = {
      configs: new Map([
        [
          STAFF_A,
          baseConfig(STAFF_A, {
            overridesByDate: new Map([[closedDay, { date: closedDay, isClosed: true, ranges: [] }]]),
          }),
        ],
      ]),
      roomReservations: [],
      calendarBusy: [],
    };
    const result = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      makeDeps(world),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.find((d) => d.dateISO === closedDay)?.available).toBe(false);
    expect(result.days.find((d) => d.dateISO === "2026-08-24")?.available).toBe(true);
    expect(result.days.find((d) => d.dateISO === "2026-08-26")?.available).toBe(true);
  });

  it("a booking cutoff that consumes all of today's remaining slots makes only today × (later days unaffected)", async () => {
    // now=09:00, cutoff=24h -> every candidate start today is under 24h away,
    // so today is fully cut off; tomorrow's 10:00 start is >24h away and stays open.
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A, { cutoff: { type: "HOURS_BEFORE", hours: 24 } })]]),
      roomReservations: [],
      calendarBusy: [],
    };
    const result = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      makeDeps(world),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.find((d) => d.dateISO === "2026-08-24")?.available).toBe(false);
    expect(result.days.find((d) => d.dateISO === "2026-08-25")?.available).toBe(true);
  });

  it("respects the staff's bookingWindowDays horizon: the boundary day is ○, the day after is ×", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A, { bookingWindowDays: 10 })]]),
      roomReservations: [],
      calendarBusy: [],
    };
    const result = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      makeDeps(world),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // RANGE_START (2026-08-24) + 10 days = 2026-09-03 (Thursday, in-window weekday)
    expect(result.days.find((d) => d.dateISO === "2026-09-03")?.available).toBe(true);
    // +11 days = 2026-09-04 is past the 10-day horizon
    expect(result.days.find((d) => d.dateISO === "2026-09-04")?.available).toBe(false);
  });

  it("STAFF_NOT_FOUND when the staff has no config", async () => {
    const world: FakeWorld = { configs: new Map(), roomReservations: [], calendarBusy: [] };
    const result = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      makeDeps(world),
    );
    expect(result).toEqual({ ok: false, reason: "STAFF_NOT_FOUND" });
  });

  it("STAFF_INACTIVE when the staff config is present but inactive", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A, { active: false })]]),
      roomReservations: [],
      calendarBusy: [],
    };
    const result = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      makeDeps(world),
    );
    expect(result).toEqual({ ok: false, reason: "STAFF_INACTIVE" });
  });

  it("ROOM_NOT_FOUND when there is no active room", async () => {
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A)]]),
      roomReservations: [],
      calendarBusy: [],
    };
    const deps: ComputeSlotsDeps = { ...makeDeps(world), async resolvePrimaryRoomId() { return null; } };
    const result = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      deps,
    );
    expect(result).toEqual({ ok: false, reason: "ROOM_NOT_FOUND" });
  });

  it("parity: every day's ○/× exactly matches whether computeAvailableSlots would return ≥1 slot for that same day, across a mixed 14-day fixture", async () => {
    const world: FakeWorld = {
      configs: new Map([
        [
          STAFF_A,
          baseConfig(STAFF_A, {
            overridesByDate: new Map([["2026-08-28", { date: "2026-08-28", isClosed: true, ranges: [] }]]),
          }),
        ],
      ]),
      roomReservations: [
        { start: jst("2026-08-26T10:00"), end: jst("2026-08-26T19:00") },
        { start: jst("2026-08-31T12:00"), end: jst("2026-08-31T13:30") },
      ],
      calendarBusy: [{ start: jst("2026-09-01T10:00"), end: jst("2026-09-01T19:00") }],
    };
    const deps = makeDeps(world);
    const rangeResult = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      deps,
    );
    expect(rangeResult.ok).toBe(true);
    if (!rangeResult.ok) return;
    expect(rangeResult.days).toHaveLength(14);

    for (const day of rangeResult.days) {
      const singleDayResult = await computeAvailableSlots({ staffId: STAFF_A, dateISO: day.dateISO, now: NOW }, deps);
      const expectedAvailable = singleDayResult.ok && singleDayResult.slots.length > 0;
      expect(day.available, day.dateISO).toBe(expectedAvailable);
    }
  });

  it("a normally-closed weekday (Thursday, dayOfWeek=4 with empty ranges) is × across the whole window, matching the reported repro date", async () => {
    const thursdayClosedWeekly: StaffAvailabilityConfig["weekly"] = [
      { dayOfWeek: 0, ranges: [] },
      { dayOfWeek: 1, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 2, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 3, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 4, ranges: [] },
      { dayOfWeek: 5, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 6, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
    ];
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A, { weekly: thursdayClosedWeekly })]]),
      roomReservations: [],
      calendarBusy: [],
    };
    const result = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      makeDeps(world),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2026-08-27 and 2026-09-03 are both Thursdays within the 14-day window.
    expect(result.days.find((d) => d.dateISO === "2026-08-27")?.available).toBe(false);
    expect(result.days.find((d) => d.dateISO === "2026-09-03")?.available).toBe(false);
    // Neighboring open weekdays are unaffected.
    expect(result.days.find((d) => d.dateISO === "2026-08-26")?.available).toBe(true);
    expect(result.days.find((d) => d.dateISO === "2026-08-28")?.available).toBe(true);
  });

  it("a per-date override REOPENS an otherwise weekly-closed weekday (Thursday) for only that date - other closed Thursdays in the window stay ×", async () => {
    const reopenedDay = "2026-09-03"; // Thursday, normally closed in this fixture
    const thursdayClosedWeekly: StaffAvailabilityConfig["weekly"] = [
      { dayOfWeek: 0, ranges: [] },
      { dayOfWeek: 1, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 2, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 3, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 4, ranges: [] },
      { dayOfWeek: 5, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 6, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
    ];
    const world: FakeWorld = {
      configs: new Map([
        [
          STAFF_A,
          baseConfig(STAFF_A, {
            weekly: thursdayClosedWeekly,
            overridesByDate: new Map([
              [reopenedDay, { date: reopenedDay, isClosed: false, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] }],
            ]),
          }),
        ],
      ]),
      roomReservations: [],
      calendarBusy: [],
    };
    const result = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      makeDeps(world),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.find((d) => d.dateISO === reopenedDay)?.available).toBe(true);
    expect(result.days.find((d) => d.dateISO === "2026-08-27")?.available).toBe(false);
  });

  it("every weekday-of-week offset (0=Sun..6=Sat) lines up with the calendar date it's meant to represent - only Thursday open, every day in the window checked", async () => {
    const onlyThursdayWeekly: StaffAvailabilityConfig["weekly"] = [
      { dayOfWeek: 0, ranges: [] },
      { dayOfWeek: 1, ranges: [] },
      { dayOfWeek: 2, ranges: [] },
      { dayOfWeek: 3, ranges: [] },
      { dayOfWeek: 4, ranges: [{ startMinute: 10 * 60, endMinute: 19 * 60 }] },
      { dayOfWeek: 5, ranges: [] },
      { dayOfWeek: 6, ranges: [] },
    ];
    const world: FakeWorld = {
      configs: new Map([[STAFF_A, baseConfig(STAFF_A, { weekly: onlyThursdayWeekly })]]),
      roomReservations: [],
      calendarBusy: [],
    };
    const result = await computeAvailabilityForRange(
      { staffId: STAFF_A, startDateISO: RANGE_START, endDateISO: RANGE_END, now: NOW },
      makeDeps(world),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toHaveLength(14);
    for (const day of result.days) {
      // Luxon's own .weekday is 1=Monday..7=Sunday, so Thursday is 4 there too
      // - this assertion is intentionally independent of this codebase's
      // toWeekday() helper, so a bug in that helper can't hide from this test.
      const isThursday = DateTime.fromISO(day.dateISO, { zone: SALON_TIME_ZONE }).weekday === 4;
      expect(day.available, day.dateISO).toBe(isThursday);
    }
  });
});
