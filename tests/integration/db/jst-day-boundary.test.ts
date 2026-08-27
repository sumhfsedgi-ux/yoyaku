import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { listReservationsForDay, getReservationCountsForMonth } from "@/lib/reservations/queries";
import { resetDb, seedCustomer, seedRoom, seedStaff } from "../../helpers/db";

/**
 * Regression test for a real bug found during requirements review: the day-view
 * queries originally computed [dayStart, dayEnd) using UTC midnight
 * (`new Date(`${dateISO}T00:00:00.000Z`)`) instead of Asia/Tokyo midnight. Since
 * `dateISO` throughout the admin UI is always a JST calendar date (see
 * app/(admin)/calendar/page.tsx, dashboard/page.tsx), that made the day view's
 * query window actually span 09:00 JST -> 09:00 JST (the next day), silently
 * dropping early-morning JST reservations from "today" and misfiling them under
 * the wrong day - see plan §33 (timezone correctness).
 */
describe("JST day boundary (queries.ts)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("a reservation starting early morning JST (before 09:00 JST) is listed under its JST calendar date, not the UTC date", async () => {
    const room = await seedRoom();
    const staff = await seedStaff({ displayName: "スタッフA", bookingSlug: "tz-a", loginEmail: "tz-a@example.com" });
    const customer = await seedCustomer(staff.id);

    // 2026-08-30T00:30 JST == 2026-08-29T15:30 UTC. A naive UTC-midnight day
    // window for "2026-08-30" would start at 2026-08-30T00:00Z (09:00 JST) and
    // completely miss this reservation.
    await prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staff.id,
        customerId: customer.id,
        startAt: new Date("2026-08-29T15:30:00.000Z"),
        endAt: new Date("2026-08-29T17:00:00.000Z"),
        status: "CONFIRMED",
        source: "STAFF_MANUAL",
      },
    });

    const rowsForJstDay = await listReservationsForDay("2026-08-30", staff.id);
    expect(rowsForJstDay).toHaveLength(1);

    const rowsForPreviousUtcDay = await listReservationsForDay("2026-08-29", staff.id);
    expect(rowsForPreviousUtcDay).toHaveLength(0);
  });

  it("getReservationCountsForMonth agrees with listReservationsForDay on which JST date an early-morning reservation belongs to", async () => {
    const room = await seedRoom();
    const staff = await seedStaff({ displayName: "スタッフA", bookingSlug: "tz-b", loginEmail: "tz-b@example.com" });
    const customer = await seedCustomer(staff.id);

    await prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staff.id,
        customerId: customer.id,
        startAt: new Date("2026-08-29T15:30:00.000Z"), // 2026-08-30T00:30 JST
        endAt: new Date("2026-08-29T17:00:00.000Z"),
        status: "CONFIRMED",
        source: "STAFF_MANUAL",
      },
    });

    const counts = await getReservationCountsForMonth(2026, 8);
    expect(counts["2026-08-30"]).toBe(1);
    expect(counts["2026-08-29"]).toBeUndefined();
  });
});
