import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resetDb, seedCustomer, seedRoom, seedStaff } from "../../helpers/db";

/**
 * The "登録済みのお客様" path added to the manual-reservation flow - see plan.
 * Covers spec items 8 (existing-customer half), 9, 10, 11, 12, 15.
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

const MONDAY_START = "2026-08-31T04:00:00.000Z"; // 13:00 JST on a Monday

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

describe("createManualReservation with an existing customer", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("items 9,10,11: books the selected customer without creating a duplicate, and stores customerId/staffId on the reservation", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff({ displayName: "スタッフA", bookingSlug: "existing-a", loginEmail: "existing-a@example.com" });
    const existing = await seedCustomer(staffA.id, { name: "常連花子", email: "regular@example.com", phone: "090-1111-2222" });

    await sessionAs(staffA.id);
    const { createManualReservation } = await import("@/actions/adminReservations");

    const beforeCount = await prisma.customer.count({ where: { ownerStaffId: staffA.id } });
    const result = await createManualReservation({ startAtUtcIso: MONDAY_START, customerMode: "existing", customerId: existing.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const afterCount = await prisma.customer.count({ where: { ownerStaffId: staffA.id } });
    expect(afterCount).toBe(beforeCount); // item 10: no duplicate created

    const reservation = await prisma.reservation.findUnique({ where: { id: result.reservationId } });
    expect(reservation?.customerId).toBe(existing.id); // item 11
    expect(reservation?.staffId).toBe(staffA.id); // item 11
    expect(reservation?.customerNameSnapshot).toBe("常連花子");
    expect(reservation?.customerEmailSnapshot).toBe("regular@example.com");
    expect(reservation?.customerPhoneSnapshot).toBe("090-1111-2222");
  });

  it("a contactOverride is stored on the reservation snapshot but never written to the Customer master row", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff({ displayName: "スタッフA", bookingSlug: "existing-override", loginEmail: "existing-override@example.com" });
    const existing = await seedCustomer(staffA.id, { name: "元花子", email: "original@example.com", phone: "090-1111-2222" });

    await sessionAs(staffA.id);
    const { createManualReservation } = await import("@/actions/adminReservations");

    const result = await createManualReservation({
      startAtUtcIso: MONDAY_START,
      customerMode: "existing",
      customerId: existing.id,
      contactOverride: { name: "今回だけ別名", email: "override@example.com", phone: "080-9999-9999" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reservation = await prisma.reservation.findUnique({ where: { id: result.reservationId } });
    expect(reservation?.customerNameSnapshot).toBe("今回だけ別名");
    expect(reservation?.customerEmailSnapshot).toBe("override@example.com");

    const master = await prisma.customer.findUnique({ where: { id: existing.id } });
    expect(master?.name).toBe("元花子"); // master row untouched
    expect(master?.email).toBe("original@example.com");
  });

  it("item 12: registering a first-time customer creates it under the caller's own staffId (regression)", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff({ displayName: "スタッフA", bookingSlug: "existing-new", loginEmail: "existing-new@example.com" });

    await sessionAs(staffA.id);
    const { createManualReservation } = await import("@/actions/adminReservations");
    const result = await createManualReservation({
      startAtUtcIso: MONDAY_START,
      customerMode: "new",
      customer: { name: "初めて太郎", email: "first-timer@example.com", phone: "090-5555-6666" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reservation = await prisma.reservation.findUnique({ where: { id: result.reservationId }, include: { customer: true } });
    expect(reservation?.customer.ownerStaffId).toBe(staffA.id);
  });

  it("item 8: a customerId belonging to a different staff is rejected as CUSTOMER_NOT_FOUND, and no reservation is created", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff({ displayName: "スタッフA", bookingSlug: "existing-forge-a", loginEmail: "existing-forge-a@example.com" });
    const staffB = await seedBookableStaff({ displayName: "スタッフB", bookingSlug: "existing-forge-b", loginEmail: "existing-forge-b@example.com" });
    const othersCustomer = await seedCustomer(staffB.id, { name: "他人の客" });

    await sessionAs(staffA.id);
    const { createManualReservation } = await import("@/actions/adminReservations");
    const result = await createManualReservation({ startAtUtcIso: MONDAY_START, customerMode: "existing", customerId: othersCustomer.id });

    expect(result).toEqual({ ok: false, reason: "CUSTOMER_NOT_FOUND" });
    const reservationCount = await prisma.reservation.count();
    expect(reservationCount).toBe(0);
  });

  it("item 8: a nonexistent customerId is rejected as CUSTOMER_NOT_FOUND (same reason as belonging to someone else)", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff({ displayName: "スタッフA", bookingSlug: "existing-missing", loginEmail: "existing-missing@example.com" });

    await sessionAs(staffA.id);
    const { createManualReservation } = await import("@/actions/adminReservations");
    const result = await createManualReservation({ startAtUtcIso: MONDAY_START, customerMode: "existing", customerId: "does-not-exist" });

    expect(result).toEqual({ ok: false, reason: "CUSTOMER_NOT_FOUND" });
  });

  it("item 15: when the reservation insert loses a concurrent-booking race, the new customer created alongside it is rolled back too", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff({ displayName: "スタッフA", bookingSlug: "existing-race-a", loginEmail: "existing-race-a@example.com" });
    const staffB = await seedBookableStaff({ displayName: "スタッフB", bookingSlug: "existing-race-b", loginEmail: "existing-race-b@example.com" });

    const { createReservation } = await import("@/lib/reservations/service");

    const [resultA, resultB] = await Promise.allSettled([
      createReservation({
        staffId: staffA.id,
        startAtUtcIso: MONDAY_START,
        source: "STAFF_MANUAL",
        createdByStaffId: staffA.id,
        customer: { name: "レースA", email: "race-a@example.com", phone: "090-0000-0001" },
      }),
      createReservation({
        staffId: staffB.id,
        startAtUtcIso: MONDAY_START,
        source: "STAFF_MANUAL",
        createdByStaffId: staffB.id,
        customer: { name: "レースB", email: "race-b@example.com", phone: "090-0000-0002" },
      }),
    ]);

    const outcomes = [resultA, resultB].map((r) => (r.status === "fulfilled" ? r.value : r.reason));
    const succeeded = outcomes.filter((o): o is { ok: true; reservationId: string } => o.ok === true);
    const failed = outcomes.filter((o) => o.ok === false);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as { reason: string }).reason).toBe("CONCURRENT_BOOKING");

    // Whichever side lost the race must not have left an orphan Customer row -
    // the upsert and the reservation insert are in the same $transaction.
    const raceACustomer = await prisma.customer.findFirst({ where: { email: "race-a@example.com" } });
    const raceBCustomer = await prisma.customer.findFirst({ where: { email: "race-b@example.com" } });
    const winnerIsA = succeeded[0].reservationId && (await prisma.reservation.findUnique({ where: { id: succeeded[0].reservationId } }))?.staffId === staffA.id;
    if (winnerIsA) {
      expect(raceACustomer).not.toBeNull();
      expect(raceBCustomer).toBeNull();
    } else {
      expect(raceBCustomer).not.toBeNull();
      expect(raceACustomer).toBeNull();
    }
  });
});
