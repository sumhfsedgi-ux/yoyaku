import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createReservation } from "@/lib/reservations/service";
import { resetDb, seedRoom, seedStaff } from "../../helpers/db";

/**
 * getReschedulableSlots (src/actions/rescheduleAvailability.ts) had zero test
 * coverage until now, despite carrying the exact same buffered-exclude bug
 * fixed in rescheduleReservation (service.ts): its own Google Calendar event
 * is synced at the BUFFERED occupied window (see
 * syncReservationToCalendarBestEffort), not its raw actual startAt/endAt, so
 * excludeCalendarBusyInterval must be buffered to match - otherwise a
 * reservation's own already-synced event would falsely hide nearby slots in
 * the reschedule dialog's date/time picker.
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

const MONDAY_START = "2026-09-07T04:00:00.000Z"; // 13:00 JST

async function seedBookableStaff(overrides: Parameters<typeof seedStaff>[0] = {}) {
  const staff = await seedStaff({
    bookingCutoffType: "HOURS_BEFORE",
    bookingCutoffHours: 0,
    bookingWindowDays: 365,
    active: true,
    ...overrides,
  });
  await prisma.weeklyAvailability.create({
    data: { staffId: staff.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 },
  });
  return staff;
}

describe("getReschedulableSlots", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("a reservation's own already-synced (buffered) Google event does not hide nearby slots in its own reschedule listing", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff({ bookingSlug: "resched-avail-a", loginEmail: "resched-avail-a@example.com" });

    const created = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "予定太郎", email: "resched-avail@example.com", phone: "090-1234-5678" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await sessionAs(staff.id);
    const { getReschedulableSlots } = await import("@/actions/rescheduleAvailability");

    const result = await getReschedulableSlots(created.reservationId, "2026-09-07");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 13:15 would overlap the reservation's own current actual [13:00,14:00)
    // row in the DB, and its own buffered Calendar event [12:45,14:15) -
    // without both exclusions (id-based for the DB, buffered-interval-based
    // for Calendar) this would be falsely absent from the list.
    const nearOwnSlot = "2026-09-07T04:15:00.000Z"; // 13:15 JST
    expect(result.slots).toContain(nearOwnSlot);
  });

  it("staff B cannot list reschedule slots for staff A's reservation", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff({ bookingSlug: "resched-avail-b-a", loginEmail: "resched-avail-b-a@example.com" });
    const staffB = await seedBookableStaff({ bookingSlug: "resched-avail-b-b", loginEmail: "resched-avail-b-b@example.com" });

    const created = await createReservation({
      staffId: staffA.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "予定花子", email: "resched-avail-2@example.com", phone: "090-1234-5678" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await sessionAs(staffB.id);
    const { getReschedulableSlots } = await import("@/actions/rescheduleAvailability");

    await expect(getReschedulableSlots(created.reservationId, "2026-09-07")).rejects.toThrow();
  });
});
