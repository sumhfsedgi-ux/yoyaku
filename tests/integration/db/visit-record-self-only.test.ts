import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError } from "@/lib/auth/authorization";
import { resetDb, seedAcquisitionSourceMaster, seedConcernMaster, seedCustomer, seedRoom, seedStaff, seedVisitRecord } from "../../helpers/db";

/**
 * VisitRecord read/write isolation (spec scenarios 2 and 15): staff B must
 * never read staff A's VisitRecord, and every forged cross-staff id in a
 * createMyVisitRecord/updateMyVisitRecord payload (customerId, reservationId,
 * concernIds, firstVisitAcquisitionSourceId) must be rejected server-side.
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

async function seedTwoStaffWithCustomers() {
  const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: `vr-a-${Math.random().toString(36).slice(2, 6)}`, loginEmail: `vr-a-${Math.random().toString(36).slice(2, 6)}@example.com` });
  const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: `vr-b-${Math.random().toString(36).slice(2, 6)}`, loginEmail: `vr-b-${Math.random().toString(36).slice(2, 6)}@example.com` });
  const customerA = await seedCustomer(staffA.id);
  const customerB = await seedCustomer(staffB.id);
  return { staffA, staffB, customerA, customerB };
}

describe("VisitRecord is strictly self-only", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("createMyVisitRecord rejects a customerId belonging to another staff (customer exists, so this is a ForbiddenError, not NOT_FOUND)", async () => {
    const { staffB, customerA } = await seedTwoStaffWithCustomers();

    await sessionAs(staffB.id);
    const { createMyVisitRecord } = await import("@/actions/visitRecords");
    await expect(
      createMyVisitRecord({ customerId: customerA.id, visitDateISO: "2026-08-01", amount: 5000, concernIds: [] }),
    ).rejects.toThrow(ForbiddenError);
    expect(await prisma.visitRecord.count()).toBe(0);
  });

  it("createMyVisitRecord rejects a reservationId belonging to another staff", async () => {
    const { staffA, staffB, customerA } = await seedTwoStaffWithCustomers();
    const room = await seedRoom();
    const reservation = await prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staffA.id,
        customerId: customerA.id,
        startAt: new Date("2026-08-01T04:00:00.000Z"),
        endAt: new Date("2026-08-01T05:30:00.000Z"),
        status: "CONFIRMED",
        source: "STAFF_MANUAL",
      },
    });

    await sessionAs(staffB.id);
    const { createMyVisitRecord } = await import("@/actions/visitRecords");
    const staffBCustomer = await seedCustomer(staffB.id);
    await expect(
      createMyVisitRecord({
        customerId: staffBCustomer.id,
        reservationId: reservation.id,
        visitDateISO: "2026-08-01",
        amount: 5000,
        concernIds: [],
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("createMyVisitRecord rejects a reservation that belongs to the caller but to a DIFFERENT customer", async () => {
    const { staffA, customerA } = await seedTwoStaffWithCustomers();
    const otherCustomerOfA = await seedCustomer(staffA.id);
    const room = await seedRoom();
    const reservation = await prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staffA.id,
        customerId: customerA.id,
        startAt: new Date("2026-08-01T04:00:00.000Z"),
        endAt: new Date("2026-08-01T05:30:00.000Z"),
        status: "CONFIRMED",
        source: "STAFF_MANUAL",
      },
    });

    await sessionAs(staffA.id);
    const { createMyVisitRecord } = await import("@/actions/visitRecords");
    const result = await createMyVisitRecord({
      customerId: otherCustomerOfA.id,
      reservationId: reservation.id,
      visitDateISO: "2026-08-01",
      amount: 5000,
      concernIds: [],
    });

    expect(result).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
  });

  it("createMyVisitRecord rejects concernIds belonging to another staff", async () => {
    const { staffB, customerA, staffA } = await seedTwoStaffWithCustomers();
    const otherStaffConcern = await seedConcernMaster(staffA.id, { name: "他スタッフの悩み" });
    const staffBCustomer = await seedCustomer(staffB.id);

    await sessionAs(staffB.id);
    const { createMyVisitRecord } = await import("@/actions/visitRecords");
    const result = await createMyVisitRecord({
      customerId: staffBCustomer.id,
      visitDateISO: "2026-08-01",
      amount: 5000,
      concernIds: [otherStaffConcern.id],
    });

    expect(result).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
    void customerA;
  });

  it("createMyVisitRecord silently ignores a firstVisitAcquisitionSourceId belonging to another staff (does not throw, does not attribute it)", async () => {
    const { staffA, staffB } = await seedTwoStaffWithCustomers();
    const otherStaffSource = await seedAcquisitionSourceMaster(staffA.id, { name: "他スタッフの流入経路" });
    const staffBCustomer = await seedCustomer(staffB.id);

    await sessionAs(staffB.id);
    const { createMyVisitRecord } = await import("@/actions/visitRecords");
    const result = await createMyVisitRecord({
      customerId: staffBCustomer.id,
      visitDateISO: "2026-08-01",
      amount: 5000,
      concernIds: [],
      firstVisitAcquisitionSourceId: otherStaffSource.id,
    });

    expect(result.ok).toBe(true);
    const updatedCustomer = await prisma.customer.findUnique({ where: { id: staffBCustomer.id } });
    expect(updatedCustomer?.firstVisitAcquisitionSourceId).toBeNull();
  });

  it("updateMyVisitRecord rejects staff B updating staff A's VisitRecord", async () => {
    const { staffA, staffB, customerA } = await seedTwoStaffWithCustomers();
    const record = await seedVisitRecord(staffA.id, customerA.id, { amount: 5000 });

    await sessionAs(staffB.id);
    const { updateMyVisitRecord } = await import("@/actions/visitRecords");
    await expect(
      updateMyVisitRecord({ id: record.id, visitDateISO: "2026-08-01", amount: 99999, concernIds: [] }),
    ).rejects.toThrow(ForbiddenError);
    const unchanged = await prisma.visitRecord.findUnique({ where: { id: record.id } });
    expect(unchanged?.amount).toBe(5000);
  });

  it("getMyVisitRecordForReservation throws ForbiddenError when the reservation belongs to another staff", async () => {
    const { staffA, staffB, customerA } = await seedTwoStaffWithCustomers();
    const room = await seedRoom();
    const reservation = await prisma.reservation.create({
      data: {
        roomId: room.id,
        staffId: staffA.id,
        customerId: customerA.id,
        startAt: new Date("2026-08-01T04:00:00.000Z"),
        endAt: new Date("2026-08-01T05:30:00.000Z"),
        status: "CONFIRMED",
        source: "STAFF_MANUAL",
      },
    });

    await sessionAs(staffB.id);
    const { getMyVisitRecordForReservation } = await import("@/actions/visitRecords");
    await expect(getMyVisitRecordForReservation(reservation.id)).rejects.toThrow();
  });
});
