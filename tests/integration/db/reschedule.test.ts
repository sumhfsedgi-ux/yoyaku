import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createReservation, rescheduleReservation } from "@/lib/reservations/service";
import { resetDb, seedRoom, seedStaff } from "../../helpers/db";

const MONDAY_1300 = "2026-08-31T04:00:00.000Z"; // 13:00 JST
const MONDAY_1600 = "2026-08-31T07:00:00.000Z"; // 16:00 JST
const MONDAY_1730 = "2026-08-31T08:30:00.000Z"; // 17:30 JST -> 19:00, still within 10-19 hours

async function seedBookableStaff(slug: string) {
  const staff = await seedStaff({
    displayName: "スタッフA",
    bookingSlug: slug,
    loginEmail: `${slug}@example.com`,
    bookingCutoffType: "HOURS_BEFORE",
    bookingCutoffHours: 0,
    bookingWindowDays: 365,
  });
  await prisma.weeklyAvailability.create({
    data: { staffId: staff.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 },
  });
  return staff;
}

describe("rescheduleReservation (spec §5/§27 + case 11)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("moves a reservation to a clear new slot", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff("resched-a");

    const created = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_1300,
      source: "CUSTOMER_ONLINE",
      customer: { name: "移動太郎", email: "move@example.com", phone: "090-1234-5678" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await rescheduleReservation({ reservationId: created.reservationId, newStartAtUtcIso: MONDAY_1600 });
    expect(result).toEqual({ ok: true });

    const updated = await prisma.reservation.findUnique({ where: { id: created.reservationId } });
    expect(updated?.startAt.toISOString()).toBe(MONDAY_1600);
    expect(updated?.rescheduledFromStartAt?.toISOString()).toBe(MONDAY_1300);
  });

  it("does not conflict with its own current slot (excludeReservationId) when the new time overlaps the old one", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff("resched-b");

    const created = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_1300,
      source: "CUSTOMER_ONLINE",
      customer: { name: "微調整太郎", email: "tweak@example.com", phone: "090-1234-5678" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Move 15 minutes later - the new [13:15,14:45) window overlaps the
    // reservation's own current [13:00,14:30) row, which must not self-conflict.
    const newStart = "2026-08-31T04:15:00.000Z";
    const result = await rescheduleReservation({ reservationId: created.reservationId, newStartAtUtcIso: newStart });
    expect(result).toEqual({ ok: true });
  });

  it("refuses to move onto a slot occupied by another CONFIRMED reservation in the room", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff("resched-c-a");
    const staffB = await seedBookableStaff("resched-c-b");

    const reservationA = await createReservation({
      staffId: staffA.id,
      startAtUtcIso: MONDAY_1300,
      source: "CUSTOMER_ONLINE",
      customer: { name: "Aさん", email: "a@example.com", phone: "090-0000-0001" },
    });
    const reservationB = await createReservation({
      staffId: staffB.id,
      startAtUtcIso: MONDAY_1600,
      source: "CUSTOMER_ONLINE",
      customer: { name: "Bさん", email: "b@example.com", phone: "090-0000-0002" },
    });
    expect(reservationA.ok && reservationB.ok).toBe(true);
    if (!reservationA.ok || !reservationB.ok) return;

    // Try to move A's reservation on top of B's - different staff, same shared room.
    const result = await rescheduleReservation({ reservationId: reservationA.reservationId, newStartAtUtcIso: MONDAY_1600 });
    expect(result).toEqual({ ok: false, reason: "SLOT_UNAVAILABLE" });

    const stillOriginal = await prisma.reservation.findUnique({ where: { id: reservationA.reservationId } });
    expect(stillOriginal?.startAt.toISOString()).toBe(MONDAY_1300);
  });

  it("updates the linked Google Calendar event's time on success", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff("resched-d");

    const created = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_1300,
      source: "CUSTOMER_ONLINE",
      customer: { name: "同期太郎", email: "sync@example.com", phone: "090-1234-5678" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const beforeMove = await prisma.reservation.findUnique({ where: { id: created.reservationId } });
    expect(beforeMove?.googleEventId).toBeTruthy();

    await rescheduleReservation({ reservationId: created.reservationId, newStartAtUtcIso: MONDAY_1730 });

    const afterMove = await prisma.reservation.findUnique({ where: { id: created.reservationId } });
    expect(afterMove?.googleSyncStatus).toBe("SYNCED");
    expect(afterMove?.googleEventId).toBe(beforeMove?.googleEventId); // same event, updated in place
  });
});
