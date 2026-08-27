import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { isExclusionConstraintViolation } from "@/lib/reservations/errors";
import { resetDb, seedCustomer, seedRoom, seedStaff } from "../../helpers/db";

describe("Reservation EXCLUDE constraint (spec case 8: concurrent booking race)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("DB-level: a plain INSERT of an overlapping CONFIRMED reservation in the same room is rejected", async () => {
    const room = await seedRoom();
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "case8-a", loginEmail: "case8-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "case8-b", loginEmail: "case8-b@example.com" });
    const customerA = await seedCustomer(staffA.id);
    const customerB = await seedCustomer(staffB.id);

    await prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staffA.id,
        customerId: customerA.id,
        startAt: new Date("2026-08-30T04:00:00.000Z"), // 13:00 JST
        endAt: new Date("2026-08-30T05:30:00.000Z"), // 14:30 JST
        status: "CONFIRMED",
        source: "CUSTOMER_ONLINE",
      },
    });

    let caught: unknown;
    try {
      await prisma.reservation.create({
        data: {
          roomId: room.id,
          staffId: staffB.id,
          customerId: customerB.id,
          startAt: new Date("2026-08-30T04:15:00.000Z"), // 13:15 JST, overlaps
          endAt: new Date("2026-08-30T05:45:00.000Z"),
          status: "CONFIRMED",
          source: "CUSTOMER_ONLINE",
        },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // Confirms isExclusionConstraintViolation() correctly classifies the real
    // error this Prisma/Postgres combination actually throws, not just a
    // synthetic fixture (see tests/unit/reservations/errors.test.ts for that).
    expect(isExclusionConstraintViolation(caught)).toBe(true);
  });

  it("exactly one of two concurrent overlapping INSERTs succeeds, the other fails", async () => {
    const room = await seedRoom();
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "case8c-a", loginEmail: "case8c-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "case8c-b", loginEmail: "case8c-b@example.com" });
    const customerA = await seedCustomer(staffA.id);
    const customerB = await seedCustomer(staffB.id);

    const attempt = (staffId: string, customerId: string) =>
      prisma.reservation.create({
        data: {
          roomId: room.id,
          staffId,
          customerId,
          startAt: new Date("2026-08-30T04:00:00.000Z"),
          endAt: new Date("2026-08-30T05:30:00.000Z"),
          status: "CONFIRMED",
          source: "CUSTOMER_ONLINE",
        },
      });

    const results = await Promise.allSettled([attempt(staffA.id, customerA.id), attempt(staffB.id, customerB.id)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const remaining = await prisma.reservation.findMany({ where: { roomId: room.id, status: "CONFIRMED" } });
    expect(remaining).toHaveLength(1);
  });

  it("non-overlapping concurrent INSERTs (adjacent, half-open boundary) both succeed", async () => {
    const room = await seedRoom();
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "case8b-a", loginEmail: "case8b-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "case8b-b", loginEmail: "case8b-b@example.com" });
    const customerA = await seedCustomer(staffA.id);
    const customerB = await seedCustomer(staffB.id);

    const first = prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staffA.id,
        customerId: customerA.id,
        startAt: new Date("2026-08-30T04:00:00.000Z"), // 13:00-14:30 JST
        endAt: new Date("2026-08-30T05:30:00.000Z"),
        status: "CONFIRMED",
        source: "CUSTOMER_ONLINE",
      },
    });
    const second = prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staffB.id,
        customerId: customerB.id,
        startAt: new Date("2026-08-30T05:30:00.000Z"), // 14:30-16:00 JST, adjacent
        endAt: new Date("2026-08-30T07:00:00.000Z"),
        status: "CONFIRMED",
        source: "CUSTOMER_ONLINE",
      },
    });

    const results = await Promise.allSettled([first, second]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("a CANCELLED reservation does not block an overlapping CONFIRMED one (WHERE clause on the constraint)", async () => {
    const room = await seedRoom();
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "case8d-a", loginEmail: "case8d-a@example.com" });
    const customerA = await seedCustomer(staffA.id);

    await prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staffA.id,
        customerId: customerA.id,
        startAt: new Date("2026-08-30T04:00:00.000Z"),
        endAt: new Date("2026-08-30T05:30:00.000Z"),
        status: "CANCELLED",
        source: "CUSTOMER_ONLINE",
      },
    });

    await expect(
      prisma.reservation.create({
        data: {
          roomId: room.id,
          staffId: staffA.id,
          customerId: customerA.id,
          startAt: new Date("2026-08-30T04:00:00.000Z"),
          endAt: new Date("2026-08-30T05:30:00.000Z"),
          status: "CONFIRMED",
          source: "CUSTOMER_ONLINE",
        },
      }),
    ).resolves.toBeDefined();
  });
});
