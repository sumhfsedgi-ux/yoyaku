import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { cancelReservation, createReservation, resyncReservationCalendarEvent } from "@/lib/reservations/service";
import { getFakeCalendarServiceForTests } from "@/lib/google/calendar/factory";
import { resetDb, seedRoom, seedStaff } from "../../helpers/db";

const MONDAY_START = "2026-09-07T04:00:00.000Z"; // 13:00 JST on a Monday

async function seedBookableStaff() {
  const staff = await seedStaff({
    displayName: "スタッフA",
    bookingSlug: "cancel-sync-a",
    loginEmail: "cancel-sync-a@example.com",
    bookingCutoffType: "HOURS_BEFORE",
    bookingCutoffHours: 0,
    bookingWindowDays: 365,
  });
  await prisma.weeklyAvailability.create({
    data: { staffId: staff.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 },
  });
  return staff;
}

async function seedConfirmedReservation() {
  const room = await seedRoom();
  await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
  const staff = await seedBookableStaff();

  const created = await createReservation({
    staffId: staff.id,
    startAtUtcIso: MONDAY_START,
    source: "CUSTOMER_ONLINE",
    customer: { name: "田中一郎", email: "tanaka@example.com", phone: "090-1111-1111" },
  });
  if (!created.ok) throw new Error(`setup failed: ${created.reason}`);

  const reservation = await prisma.reservation.findUniqueOrThrow({ where: { id: created.reservationId } });
  expect(reservation.googleEventId).toBeTruthy(); // sanity: the event this test cancels/deletes actually exists
  return { staff, reservation };
}

describe("cancelReservation Calendar event deletion", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("a successful delete clears googleEventId and marks the row SYNCED", async () => {
    const { staff, reservation } = await seedConfirmedReservation();

    const result = await cancelReservation(reservation.id, staff.id);
    expect(result.ok).toBe(true);

    const dbRow = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(dbRow?.status).toBe("CANCELLED");
    expect(dbRow?.googleEventId).toBeNull();
    expect(dbRow?.googleSyncStatus).toBe("SYNCED");
    expect(dbRow?.googleSyncError).toBeNull();
  });

  it("a failed delete still cancels the reservation in the DB, but records the failure instead of discarding it", async () => {
    const { staff, reservation } = await seedConfirmedReservation();
    getFakeCalendarServiceForTests().simulateNextDeleteFailure();

    const result = await cancelReservation(reservation.id, staff.id);
    expect(result.ok).toBe(true); // DB cancellation is unconditional, per existing behavior

    const dbRow = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(dbRow?.status).toBe("CANCELLED");
    // googleEventId is deliberately preserved (not cleared) so a retry can still target it.
    expect(dbRow?.googleEventId).toBeTruthy();
    expect(dbRow?.googleSyncStatus).toBe("FAILED");
    expect(dbRow?.googleSyncError).toBeTruthy();
  });

  it("resyncReservationCalendarEvent retries the deletion for a CANCELLED reservation stuck in FAILED", async () => {
    const { staff, reservation } = await seedConfirmedReservation();
    getFakeCalendarServiceForTests().simulateNextDeleteFailure();
    await cancelReservation(reservation.id, staff.id);

    const failedRow = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(failedRow?.googleSyncStatus).toBe("FAILED");

    // This time the fake succeeds - staff clicking "resync" again should clear the error.
    const retryResult = await resyncReservationCalendarEvent(reservation.id);
    expect(retryResult.ok).toBe(true);

    const dbRow = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(dbRow?.status).toBe("CANCELLED");
    expect(dbRow?.googleEventId).toBeNull();
    expect(dbRow?.googleSyncStatus).toBe("SYNCED");
    expect(dbRow?.googleSyncError).toBeNull();
  });
});
