import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError } from "@/lib/auth/authorization";
import { getReservationDetail, listReservationsForDay } from "@/lib/reservations/queries";
import { resetDb, seedCustomer, seedRoom, seedStaff } from "../../helpers/db";

describe("Reservation PII authorization (spec case 9)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("staff B fetching staff A's reservation detail gets ForbiddenError, no customer PII at all", async () => {
    const room = await seedRoom();
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "auth-a", loginEmail: "auth-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "auth-b", loginEmail: "auth-b@example.com" });
    const customerA = await seedCustomer(staffA.id, { name: "秘密太郎", email: "himitsu@example.com", phone: "090-1111-2222" });

    const reservation = await prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staffA.id,
        customerId: customerA.id,
        startAt: new Date("2026-08-30T04:00:00.000Z"),
        endAt: new Date("2026-08-30T05:30:00.000Z"),
        status: "CONFIRMED",
        source: "CUSTOMER_ONLINE",
      },
    });

    // staff A can see it
    const own = await getReservationDetail(reservation.id, staffA.id);
    expect(own.customer.name).toBe("秘密太郎");

    // staff B cannot - and the rejection happens before any customer field is touched
    let caught: unknown;
    try {
      await getReservationDetail(reservation.id, staffB.id);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ForbiddenError);
    // sanity: the error itself must not carry the customer's PII in its message
    expect(String((caught as Error).message)).not.toMatch(/秘密太郎|himitsu@example\.com|090-1111-2222/);
  });

  it("the day-list endpoint never returns a customer field, for anyone's reservations", async () => {
    const room = await seedRoom();
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "auth-list-a", loginEmail: "auth-list-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "auth-list-b", loginEmail: "auth-list-b@example.com" });
    const customerA = await seedCustomer(staffA.id, { name: "顧客A", email: "a@example.com", phone: "090-0000-0001" });

    await prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staffA.id,
        customerId: customerA.id,
        startAt: new Date("2026-08-30T04:00:00.000Z"),
        endAt: new Date("2026-08-30T05:30:00.000Z"),
        status: "CONFIRMED",
        source: "CUSTOMER_ONLINE",
      },
    });

    const rowsForB = await listReservationsForDay("2026-08-30", staffB.id);
    expect(rowsForB).toHaveLength(1);
    expect(rowsForB[0]).not.toHaveProperty("customer");
    expect(rowsForB[0].staffDisplayName).toBe("スタッフA");
    expect(rowsForB[0].isMine).toBe(false);
    expect(JSON.stringify(rowsForB)).not.toMatch(/顧客A|a@example\.com|090-0000-0001/);

    const rowsForA = await listReservationsForDay("2026-08-30", staffA.id);
    expect(rowsForA[0].isMine).toBe(true);
  });
});
