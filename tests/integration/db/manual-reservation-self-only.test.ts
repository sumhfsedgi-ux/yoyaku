import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getFakeCalendarServiceForTests } from "@/lib/google/calendar/factory";
import { getFakeGmailServiceForTests } from "@/lib/google/gmail/factory";
import { resetDb, seedRoom, seedStaff } from "../../helpers/db";

/**
 * Manual (LINE/phone/in-person) reservations were changed, at the user's
 * explicit request, from "any staff can register a booking under any staff"
 * to "always registered under the caller's own identity" - see
 * actions/adminReservations.ts's createManualReservation, which no longer
 * accepts a staffId from the client at all.
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

describe("createManualReservation is always self-only", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("a forged staffId in the input is ignored - the reservation is always created under the caller's own staffId", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff({ displayName: "スタッフA", bookingSlug: "self-only-a", loginEmail: "self-only-a@example.com" });
    const staffB = await seedBookableStaff({ displayName: "スタッフB", bookingSlug: "self-only-b", loginEmail: "self-only-b@example.com" });

    await sessionAs(staffA.id);
    const { createManualReservation } = await import("@/actions/adminReservations");

    // Deliberately bypasses the TypeScript type (which no longer even has a
    // staffId field) to prove the SERVER can't be redirected to another
    // staff at runtime either, not just that the type system discourages it.
    const forgedInput = {
      staffId: staffB.id,
      startAtUtcIso: MONDAY_START,
      customerMode: "new",
      customer: { name: "偽装太郎", email: "gisou@example.com", phone: "090-0000-1111" },
    };
    const result = await createManualReservation(forgedInput as never);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reservation = await prisma.reservation.findUnique({ where: { id: result.reservationId } });
    expect(reservation?.staffId).toBe(staffA.id);
    expect(reservation?.staffId).not.toBe(staffB.id);
  });

  it("a normal manual reservation is fully attributed to the caller: Reservation.staffId, Customer.ownerStaffId, the Google Calendar event's staff name, and the staff notification recipient", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff({ displayName: "スタッフA", bookingSlug: "self-only-c", loginEmail: "self-only-c@example.com" });

    const fakeGmail = getFakeGmailServiceForTests();
    fakeGmail.sent = [];

    await sessionAs(staffA.id);
    const { createManualReservation } = await import("@/actions/adminReservations");

    const result = await createManualReservation({
      startAtUtcIso: MONDAY_START,
      customerMode: "new",
      customer: { name: "山田花子", email: "hanako-manual@example.com", phone: "090-1234-5678" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Reservation.staffId (item 2)
    const reservation = await prisma.reservation.findUnique({ where: { id: result.reservationId }, include: { customer: true } });
    expect(reservation?.staffId).toBe(staffA.id);

    // Customer.ownerStaffId (item 3)
    expect(reservation?.customer.ownerStaffId).toBe(staffA.id);

    // Google Calendar event's staff name (item 4)
    expect(reservation?.googleEventId).toBeTruthy();
    const fakeCalendar = getFakeCalendarServiceForTests();
    expect(fakeCalendar.getEventStaffDisplayName(reservation!.googleEventId!)).toBe("スタッフA");

    // Staff notification email recipient (item 5)
    const staffEmail = fakeGmail.sent.find((m) => m.to === staffA.loginEmail);
    expect(staffEmail).toBeDefined();
  });

  it("item 6: staff A cannot manually book a time staff B already has the shared room reserved for", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff({ displayName: "スタッフA", bookingSlug: "self-only-d-a", loginEmail: "self-only-d-a@example.com" });
    const staffB = await seedBookableStaff({ displayName: "スタッフB", bookingSlug: "self-only-d-b", loginEmail: "self-only-d-b@example.com" });

    await sessionAs(staffB.id);
    const { createManualReservation } = await import("@/actions/adminReservations");
    const staffBBooking = await createManualReservation({
      startAtUtcIso: MONDAY_START, // 13:00-14:00 JST
      customerMode: "new",
      customer: { name: "スタッフBの客", email: "staffb-customer@example.com", phone: "090-2222-3333" },
    });
    expect(staffBBooking.ok).toBe(true);

    // Same exact slot, now as staff A - the room is shared, so this must be rejected
    // even though staff A has never touched staff B's reservation directly.
    await sessionAs(staffA.id);
    const staffAAttempt = await createManualReservation({
      startAtUtcIso: MONDAY_START,
      customerMode: "new",
      customer: { name: "スタッフAの客", email: "staffa-customer@example.com", phone: "090-4444-5555" },
    });

    expect(staffAAttempt).toEqual({ ok: false, reason: "SLOT_UNAVAILABLE" });
    const roomReservations = await prisma.reservation.findMany({ where: { roomId: room.id, status: "CONFIRMED" } });
    expect(roomReservations).toHaveLength(1);
    expect(roomReservations[0].staffId).toBe(staffB.id);
  });
});
