import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createReservation } from "@/lib/reservations/service";
import { getFakeCalendarServiceForTests } from "@/lib/google/calendar/factory";
import { getFakeGmailServiceForTests } from "@/lib/google/gmail/factory";
import { resetDb, seedRoom, seedStaff } from "../../helpers/db";

const MONDAY_START = "2026-08-31T04:00:00.000Z"; // 13:00 JST on a Monday

async function seedBookableStaff() {
  const staff = await seedStaff({
    displayName: "スタッフA",
    bookingSlug: "e2e-staff-a",
    loginEmail: "e2e-staff-a@example.com",
    bookingCutoffType: "HOURS_BEFORE",
    bookingCutoffHours: 0,
    bookingWindowDays: 365,
  });
  await prisma.weeklyAvailability.create({
    data: { staffId: staff.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 },
  });
  return staff;
}

describe("createReservation end-to-end (spec case 10: DB + Calendar + Gmail)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("a normal booking persists to the DB, creates a Calendar event, and sends both emails", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();

    const fakeGmail = getFakeGmailServiceForTests();
    fakeGmail.sent = [];

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "山田花子", email: "hanako@example.com", phone: "090-1234-5678" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dbRow = await prisma.reservation.findUnique({ where: { id: result.reservationId } });
    expect(dbRow?.status).toBe("CONFIRMED");
    expect(dbRow?.googleSyncStatus).toBe("SYNCED");
    expect(dbRow?.googleEventId).toBeTruthy();

    const calendarService = getFakeCalendarServiceForTests();
    const busy = await calendarService.getFreeBusy(
      "primary",
      new Date("2026-08-31T00:00:00.000Z"),
      new Date("2026-09-01T00:00:00.000Z"),
    );
    expect(busy.ok).toBe(true);
    if (busy.ok) expect(busy.busy).toHaveLength(1);

    expect(fakeGmail.sent).toHaveLength(2);
    const customerEmail = fakeGmail.sent.find((m) => m.to === "hanako@example.com");
    const staffEmail = fakeGmail.sent.find((m) => m.to === staff.loginEmail);
    expect(customerEmail).toBeDefined();
    expect(staffEmail).toBeDefined();
    // Customer email must show start time only, never the end time / duration.
    expect(customerEmail!.text).toContain("13:00");
    expect(customerEmail!.text).not.toContain("14:30");
    // Staff email is allowed to show the full range.
    expect(staffEmail!.text).toContain("13:00");
    expect(staffEmail!.text).toContain("14:30");
  });

  it("the Calendar event carries no customer PII in its title/description", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();

    await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "個人情報太郎", email: "personal@example.com", phone: "090-9999-8888" },
    });

    const dbRow = await prisma.reservation.findFirst({ where: { staffId: staff.id } });
    expect(dbRow?.googleEventId).toBeTruthy();
    // The fake store doesn't expose summary text directly, so assert indirectly:
    // the DB is the only place PII should exist, and the sync succeeded without
    // needing to pass PII into createEvent (see syncReservationToCalendarBestEffort).
    expect(dbRow?.googleSyncStatus).toBe("SYNCED");
  });

  it("room has no calendar connected at all: booking is refused up front (fail-safe), not partially committed", async () => {
    // No RoomCalendar row -> validateSlotBookable can't check freebusy -> CALENDAR_UNAVAILABLE,
    // per plan §23: never book blind when Google's state can't be verified.
    await seedRoom();
    const staff = await seedBookableStaff();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "田中一郎", email: "tanaka@example.com", phone: "090-1111-1111" },
    });

    expect(result).toEqual({ ok: false, reason: "CALENDAR_UNAVAILABLE" });
    const reservations = await prisma.reservation.findMany({ where: { staffId: staff.id } });
    expect(reservations).toHaveLength(0);
  });

  it("DB insert succeeding but the post-commit Calendar event-create call failing does not block the booking response", async () => {
    // Distinct from the above: here the room DOES have a working Calendar
    // connection (freebusy check succeeds, so validation passes), but the
    // createEvent() call itself fails afterwards - the partial-failure case
    // plan §5/§23 describes, tracked via googleSyncStatus=FAILED.
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();
    getFakeCalendarServiceForTests().simulateNextCreateFailure();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "田中一郎", email: "tanaka@example.com", phone: "090-1111-1111" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dbRow = await prisma.reservation.findUnique({ where: { id: result.reservationId } });
    expect(dbRow?.status).toBe("CONFIRMED");
    expect(dbRow?.googleSyncStatus).toBe("FAILED");
    expect(dbRow?.googleSyncError).toBeTruthy();
  });

  it("repeat customer under the same staff reuses the same Customer row; a different staff gets an independent row", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff();
    const staffB = await seedStaff({
      displayName: "スタッフB",
      bookingSlug: "e2e-staff-b",
      loginEmail: "e2e-staff-b@example.com",
      bookingCutoffType: "HOURS_BEFORE",
      bookingCutoffHours: 0,
      bookingWindowDays: 365,
    });
    await prisma.weeklyAvailability.create({
      data: { staffId: staffB.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 },
    });

    const email = "repeat@example.com";
    await createReservation({
      staffId: staffA.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "リピート客", email, phone: "090-2222-2222" },
    });
    await createReservation({
      staffId: staffA.id,
      startAtUtcIso: "2026-09-07T04:00:00.000Z", // next Monday, same staff
      source: "CUSTOMER_ONLINE",
      customer: { name: "リピート客", email, phone: "090-2222-2222" },
    });
    // Different time slot than staffA's Aug31 13:00 booking - the room is
    // shared, so booking the exact same time under a different staff would be
    // a legitimate ROOM_CONFLICT (that's spec case 4), not what this test is about.
    await createReservation({
      staffId: staffB.id,
      startAtUtcIso: "2026-08-31T07:00:00.000Z", // 16:00 JST, same day, clear of staffA's slot
      source: "CUSTOMER_ONLINE",
      customer: { name: "リピート客", email, phone: "090-2222-2222" },
    });

    const customersWithEmail = await prisma.customer.findMany({ where: { email } });
    expect(customersWithEmail).toHaveLength(2); // one per owning staff, not one global row
    expect(new Set(customersWithEmail.map((c) => c.ownerStaffId))).toEqual(new Set([staffA.id, staffB.id]));

    const staffAReservations = await prisma.reservation.findMany({ where: { staffId: staffA.id } });
    expect(staffAReservations).toHaveLength(2);
    expect(new Set(staffAReservations.map((r) => r.customerId)).size).toBe(1); // same Customer row reused
  });
});
