import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getFakeCalendarServiceForTests } from "@/lib/google/calendar/factory";
import { resetDb, seedCustomer, seedRoom, seedStaff } from "../../helpers/db";

/**
 * The /calendar "自分の予約"/"部屋全体" toggle - see lib/calendar/roomUsage.ts.
 * Covers the user's spec cases 1-5 (mine vs room scope, PII boundary for
 * other staff's reservations, own-reservation customer name, Google busy
 * blocks) plus the calendarView/calendarScope preference round-trip (cases
 * 7/8: since the preference is DB-backed rather than localStorage/session,
 * "survives navigation" and "survives logout/login" both reduce to the same
 * underlying guarantee - a saved value is read back correctly).
 *
 * next-auth's getServerSession is mocked (same technique as
 * cancel-authorization.test.ts) so requireStaffSession() sees a fixed
 * session without a real HTTP request/cookie.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

async function sessionAs(staffId: string) {
  const { getServerSession } = await import("next-auth");
  vi.mocked(getServerSession).mockResolvedValue({
    user: { name: "Test", email: "test@example.com" },
    staffId,
    mustChangePassword: false,
  } as never);
}

const DAY_ISO = "2026-08-30"; // Sunday, arbitrary fixed date

describe("calendar room-usage scope (自分の予約 / 部屋全体)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("case 1: scope=mine returns only the caller's own reservation", async () => {
    const room = await seedRoom();
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "calendar-mine-a", loginEmail: "calendar-mine-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "calendar-mine-b", loginEmail: "calendar-mine-b@example.com" });
    const customerA = await seedCustomer(staffA.id, { name: "田中" });
    const customerB = await seedCustomer(staffB.id, { name: "鈴木" });

    await prisma.reservation.create({
      data: { roomId: room.id, staffId: staffA.id, customerId: customerA.id, startAt: new Date("2026-08-30T01:00:00.000Z"), endAt: new Date("2026-08-30T02:30:00.000Z"), status: "CONFIRMED", source: "STAFF_MANUAL" },
    });
    await prisma.reservation.create({
      data: { roomId: room.id, staffId: staffB.id, customerId: customerB.id, startAt: new Date("2026-08-30T04:30:00.000Z"), endAt: new Date("2026-08-30T06:00:00.000Z"), status: "CONFIRMED", source: "STAFF_MANUAL" },
    });

    await sessionAs(staffA.id);
    const { getCalendarDayData } = await import("@/actions/calendar");
    const entries = await getCalendarDayData(DAY_ISO, "mine");

    expect(entries).toHaveLength(1);
    expect(entries[0].isMine).toBe(true);
    expect(entries[0].label).toBe("田中様");
  });

  it("case 2: scope=room returns the whole room's usage across all staff", async () => {
    const room = await seedRoom();
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "calendar-room-a", loginEmail: "calendar-room-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "calendar-room-b", loginEmail: "calendar-room-b@example.com" });
    const customerA = await seedCustomer(staffA.id, { name: "田中" });
    const customerB = await seedCustomer(staffB.id, { name: "鈴木" });

    await prisma.reservation.create({
      data: { roomId: room.id, staffId: staffA.id, customerId: customerA.id, startAt: new Date("2026-08-30T01:00:00.000Z"), endAt: new Date("2026-08-30T02:30:00.000Z"), status: "CONFIRMED", source: "STAFF_MANUAL" },
    });
    await prisma.reservation.create({
      data: { roomId: room.id, staffId: staffB.id, customerId: customerB.id, startAt: new Date("2026-08-30T04:30:00.000Z"), endAt: new Date("2026-08-30T06:00:00.000Z"), status: "CONFIRMED", source: "STAFF_MANUAL" },
    });

    await sessionAs(staffA.id);
    const { getCalendarDayData } = await import("@/actions/calendar");
    const entries = await getCalendarDayData(DAY_ISO, "room");

    expect(entries).toHaveLength(2);
  });

  it("case 3: another staff's entry carries no customer information at all (structural PII check)", async () => {
    const room = await seedRoom();
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "calendar-pii-a", loginEmail: "calendar-pii-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "calendar-pii-b", loginEmail: "calendar-pii-b@example.com" });
    const customerB = await seedCustomer(staffB.id, { name: "秘密花子", email: "himitsu-cal@example.com", phone: "090-1111-2222" });

    await prisma.reservation.create({
      data: { roomId: room.id, staffId: staffB.id, customerId: customerB.id, startAt: new Date("2026-08-30T04:00:00.000Z"), endAt: new Date("2026-08-30T05:30:00.000Z"), status: "CONFIRMED", source: "STAFF_MANUAL" },
    });

    await sessionAs(staffA.id);
    const { getCalendarDayData } = await import("@/actions/calendar");
    const entries = await getCalendarDayData(DAY_ISO, "room");

    expect(entries).toHaveLength(1);
    const otherEntry = entries[0];
    expect(otherEntry.isMine).toBe(false);
    expect(otherEntry.label).toBe("スタッフB");
    expect(otherEntry).not.toHaveProperty("customer");
    expect(otherEntry).not.toHaveProperty("customerName");
    expect(JSON.stringify(otherEntry)).not.toMatch(/秘密花子|himitsu-cal@example\.com|090-1111-2222/);
  });

  it("case 4: the caller's own reservation shows the customer's name as its label", async () => {
    const room = await seedRoom();
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "calendar-own-a", loginEmail: "calendar-own-a@example.com" });
    const customerA = await seedCustomer(staffA.id, { name: "田中" });

    await prisma.reservation.create({
      data: { roomId: room.id, staffId: staffA.id, customerId: customerA.id, startAt: new Date("2026-08-30T01:00:00.000Z"), endAt: new Date("2026-08-30T02:30:00.000Z"), status: "CONFIRMED", source: "STAFF_MANUAL" },
    });

    await sessionAs(staffA.id);
    const { getCalendarDayData } = await import("@/actions/calendar");
    const entries = await getCalendarDayData(DAY_ISO, "room");

    expect(entries).toHaveLength(1);
    expect(entries[0].isMine).toBe(true);
    expect(entries[0].label).toBe("田中様");
  });

  it("case 5: a Google-direct event shows as 部屋使用中 in room scope, and does not appear at all in mine scope", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "calendar-google-a", loginEmail: "calendar-google-a@example.com" });

    getFakeCalendarServiceForTests().seedEvent("primary", new Date("2026-08-30T06:00:00.000Z"), new Date("2026-08-30T07:00:00.000Z"));

    await sessionAs(staffA.id);
    const { getCalendarDayData } = await import("@/actions/calendar");

    const roomEntries = await getCalendarDayData(DAY_ISO, "room");
    expect(roomEntries).toHaveLength(1);
    expect(roomEntries[0].kind).toBe("googleBusy");
    expect(roomEntries[0].label).toBe("部屋使用中");

    const mineEntries = await getCalendarDayData(DAY_ISO, "mine");
    expect(mineEntries).toHaveLength(0);
  });

  it("cases 7/8: a saved calendar preference round-trips through the DB (survives navigation and logout/login alike, since it is not localStorage-backed)", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "calendar-pref-a", loginEmail: "calendar-pref-a@example.com" });

    await sessionAs(staffA.id);
    const { getMyCalendarPreference, updateMyCalendarPreference } = await import("@/actions/calendar");

    const initial = await getMyCalendarPreference();
    expect(initial).toEqual({ view: "day", scope: "mine" });

    await updateMyCalendarPreference({ view: "month", scope: "room" });
    const after = await getMyCalendarPreference();
    expect(after).toEqual({ view: "month", scope: "room" });

    const staffRow = await prisma.staff.findUniqueOrThrow({ where: { id: staffA.id } });
    expect(staffRow.calendarView).toBe("MONTH");
    expect(staffRow.calendarScope).toBe("ROOM");
  });
});

/**
 * Regression coverage for the "予約 + 部屋使用中" duplicate-display bug: a
 * reservation's own Google-synced event must never ALSO show up as a
 * separate "部屋使用中" entry. The fix (lib/reservations/queries.ts's
 * getGoogleBusyBlocksForDay/Month) checks each Google event's
 * extendedProperties.private.reservationId (via CalendarService.listEvents)
 * rather than matching time ranges against known reservations - the
 * mismatched-scenario test below is specifically the case a time-matching
 * approach would have gotten wrong.
 */
describe("calendar room-usage: reservation-synced Google events are not duplicated as 部屋使用中", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  const MONDAY_START = "2026-09-07T04:00:00.000Z"; // 13:00 JST on a Monday

  async function seedBookableStaff(overrides: Parameters<typeof seedStaff>[0] = {}) {
    const staff = await seedStaff({
      bookingCutoffType: "HOURS_BEFORE",
      bookingCutoffHours: 0,
      bookingWindowDays: 365,
      ...overrides,
    });
    await prisma.weeklyAvailability.create({
      data: { staffId: staff.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 },
    });
    return staff;
  }

  it("a reservation synced to Google Calendar appears once (as the reservation), not twice (reservation + 部屋使用中)", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff({ displayName: "スタッフA", bookingSlug: "dup-a", loginEmail: "dup-a@example.com" });

    const { createReservation } = await import("@/lib/reservations/service");
    const result = await createReservation({
      staffId: staffA.id,
      startAtUtcIso: MONDAY_START,
      source: "STAFF_MANUAL",
      customer: { name: "田中", email: "dup-customer@example.com", phone: "090-0000-0000" },
    });
    expect(result.ok).toBe(true);

    await sessionAs(staffA.id);
    const { getCalendarDayData, getCalendarMonthData } = await import("@/actions/calendar");

    const dayEntries = await getCalendarDayData("2026-09-07", "room");
    expect(dayEntries).toHaveLength(1);
    expect(dayEntries[0].kind).toBe("reservation");
    expect(dayEntries.some((e) => e.kind === "googleBusy")).toBe(false);

    const monthEntries = await getCalendarMonthData(2026, 9, "room");
    expect(monthEntries["2026-09-07"]).toHaveLength(1);
    expect(monthEntries["2026-09-07"][0].kind).toBe("reservation");
  });

  it("a direct Google event that coincidentally has the exact same start/end as a reservation is still correctly identified as direct (not filtered by time match)", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff({ displayName: "スタッフA", bookingSlug: "dup-coincidence-a", loginEmail: "dup-coincidence-a@example.com" });

    const { createReservation } = await import("@/lib/reservations/service");
    const result = await createReservation({
      staffId: staffA.id,
      startAtUtcIso: MONDAY_START,
      source: "STAFF_MANUAL",
      customer: { name: "田中", email: "dup-coincidence-customer@example.com", phone: "090-0000-0000" },
    });
    expect(result.ok).toBe(true);

    // A second, genuinely separate event added directly in Google Calendar,
    // at the EXACT same [start, end) as the reservation's own synced event
    // above (the BUFFERED occupied window - see
    // syncReservationToCalendarBestEffort) - seedEvent stores it with
    // reservationId: null, exactly like a real direct-added event. A
    // time-range-matching dedup would have wrongly swallowed this too; the
    // id-based check must still show it.
    getFakeCalendarServiceForTests().seedEvent(
      "primary",
      new Date("2026-09-07T03:45:00.000Z"), // 12:45 JST
      new Date("2026-09-07T05:15:00.000Z"), // 14:15 JST
    );

    await sessionAs(staffA.id);
    const { getCalendarDayData } = await import("@/actions/calendar");
    const dayEntries = await getCalendarDayData("2026-09-07", "room");

    expect(dayEntries).toHaveLength(2);
    const reservationEntries = dayEntries.filter((e) => e.kind === "reservation");
    const googleBusyEntries = dayEntries.filter((e) => e.kind === "googleBusy");
    expect(reservationEntries).toHaveLength(1);
    expect(googleBusyEntries).toHaveLength(1);
    expect(googleBusyEntries[0].label).toBe("部屋使用中");
  });
});
