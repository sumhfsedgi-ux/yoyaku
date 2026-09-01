import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getFakeCalendarServiceForTests } from "@/lib/google/calendar/factory";
import { resetDb, seedRoom, seedStaff } from "../../helpers/db";

/**
 * Regression coverage for a production bug report: an event registered
 * directly in Google Calendar (10:00-15:00 JST on a bookable day) failed to
 * block the overlapping slots. The engine-level boundary math is already
 * covered exhaustively by tests/unit/availability/engine.test.ts - this file
 * instead proves the two real entry points (createCustomerReservation and
 * createManualReservation) each individually reject a booking through the
 * SAME Google-busy interval, end to end through Prisma + FakeCalendarService.
 * Confirming this at both entry points matters because they're two separate
 * Server Actions with their own input handling - both must actually route
 * into the shared validateSlotBookable, not just one of them.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

// createCustomerReservation reads the caller's IP via next/headers for rate
// limiting - unavailable outside a real Next.js request context, so it's
// stubbed here the same way requireStaffSession's getServerSession is above.
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }) }));

async function sessionAs(staffId: string) {
  const { getServerSession } = await import("next-auth");
  vi.mocked(getServerSession).mockResolvedValue({
    user: { name: "Test", email: "test@example.com" },
    staffId,
    mustChangePassword: false,
  } as never);
}

const MONDAY = "2026-09-07";
const BUSY_START = new Date(`${MONDAY}T01:00:00.000Z`); // 10:00 JST
const BUSY_END = new Date(`${MONDAY}T06:00:00.000Z`); // 15:00 JST
const INSIDE_BUSY_START_UTC = `${MONDAY}T03:00:00.000Z`; // 12:00 JST - inside the busy window
// A candidate starting exactly at the busy window's end (15:00 JST) now
// occupies [14:45,16:15) (60min service ±15min buffer) - that overlaps the
// unbuffered Google busy window [10:00,15:00) at the 14:45 edge, so it's
// correctly rejected too. The first genuinely clear start is 15:15 JST,
// whose occupied window [15:00,16:30) only touches the busy window's end.
const AFTER_BUSY_START_UTC = `${MONDAY}T06:15:00.000Z`; // 15:15 JST
const AT_BUSY_END_UTC = `${MONDAY}T06:00:00.000Z`; // 15:00 JST - exactly at the busy window's end

async function seedBookableStaff(overrides: Parameters<typeof seedStaff>[0] = {}) {
  const staff = await seedStaff({
    bookingCutoffType: "HOURS_BEFORE",
    bookingCutoffHours: 0,
    bookingWindowDays: 365,
    active: true,
    ...overrides,
  });
  await prisma.weeklyAvailability.create({
    data: { staffId: staff.id, dayOfWeek: 1, startMinute: 8 * 60, endMinute: 19 * 60 },
  });
  return staff;
}

describe("a Google Calendar event registered directly (not through this app) blocks booking at both entry points", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("createCustomerReservation (public /reserve/[slug] path) rejects a slot inside the busy window and accepts one after it", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff({ bookingSlug: "busy-boundary-customer", loginEmail: "busy-boundary-customer@example.com" });
    getFakeCalendarServiceForTests().seedEvent("primary", BUSY_START, BUSY_END);

    const { createCustomerReservation } = await import("@/actions/booking");

    const insideBusy = await createCustomerReservation({
      bookingSlug: staff.bookingSlug,
      startAtUtcIso: INSIDE_BUSY_START_UTC,
      customer: { name: "顧客太郎", email: "customer-busy-a@example.com", phone: "090-1111-2222" },
    });
    expect(insideBusy).toEqual({ ok: false, reason: "SLOT_UNAVAILABLE" });

    const afterBusy = await createCustomerReservation({
      bookingSlug: staff.bookingSlug,
      startAtUtcIso: AFTER_BUSY_START_UTC,
      customer: { name: "顧客花子", email: "customer-busy-b@example.com", phone: "090-3333-4444" },
    });
    expect(afterBusy.ok).toBe(true);
  });

  it("a candidate starting exactly at the busy window's end is still rejected (its buffered occupied window overlaps)", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff({ bookingSlug: "busy-boundary-at-end", loginEmail: "busy-boundary-at-end@example.com" });
    getFakeCalendarServiceForTests().seedEvent("primary", BUSY_START, BUSY_END);

    const { createCustomerReservation } = await import("@/actions/booking");

    const atBusyEnd = await createCustomerReservation({
      bookingSlug: staff.bookingSlug,
      startAtUtcIso: AT_BUSY_END_UTC,
      customer: { name: "顧客次郎", email: "customer-busy-c@example.com", phone: "090-9999-0000" },
    });
    expect(atBusyEnd).toEqual({ ok: false, reason: "SLOT_UNAVAILABLE" });
  });

  it("createManualReservation (staff /reservations/new path) rejects a slot inside the busy window and accepts one after it", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff({ bookingSlug: "busy-boundary-manual", loginEmail: "busy-boundary-manual@example.com" });
    getFakeCalendarServiceForTests().seedEvent("primary", BUSY_START, BUSY_END);

    await sessionAs(staff.id);
    const { createManualReservation } = await import("@/actions/adminReservations");

    const insideBusy = await createManualReservation({
      startAtUtcIso: INSIDE_BUSY_START_UTC,
      customerMode: "new",
      customer: { name: "手動太郎", email: "manual-busy-a@example.com", phone: "090-5555-6666" },
    });
    expect(insideBusy).toEqual({ ok: false, reason: "SLOT_UNAVAILABLE" });

    const afterBusy = await createManualReservation({
      startAtUtcIso: AFTER_BUSY_START_UTC,
      customerMode: "new",
      customer: { name: "手動花子", email: "manual-busy-b@example.com", phone: "090-7777-8888" },
    });
    expect(afterBusy.ok).toBe(true);
  });
});
