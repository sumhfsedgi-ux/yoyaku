import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createReservation } from "@/lib/reservations/service";
import { resetDb, seedAcquisitionSourceMaster, seedCustomer, seedRoom, seedStaff } from "../../helpers/db";

/**
 * Covers plan §3/§7's first-visit auto-set rule (spec scenarios 5, and the
 * additional edge cases the plan calls 5b/5c/5d):
 *  - the booking flow's customer.upsert never touches firstVisitDate/
 *    firstVisitAcquisitionSourceId, on either the online or manual path.
 *  - createMyVisitRecord auto-sets both fields, atomically with the
 *    VisitRecord, ONLY on the customer's first-ever VisitRecord.
 *  - a customer whose firstVisitDate was already set (e.g. backfilled via
 *    the customer detail "訂正" form before any VisitRecord existed) is never
 *    overwritten by a later createMyVisitRecord call.
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

async function seedBookableStaff(overrides: Parameters<typeof seedStaff>[0] = {}) {
  const staff = await seedStaff({ bookingCutoffType: "HOURS_BEFORE", bookingCutoffHours: 0, bookingWindowDays: 365, ...overrides });
  await prisma.weeklyAvailability.create({ data: { staffId: staff.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 } });
  return staff;
}

const MONDAY_1 = "2026-09-07T04:00:00.000Z"; // 13:00 JST Monday
const MONDAY_2 = "2026-09-14T04:00:00.000Z"; // following Monday

describe("Customer.firstVisitDate/firstVisitAcquisitionSourceId are never overwritten by a later booking or visit", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("scenario 5: a 2nd STAFF_MANUAL booking for a returning customer does not touch firstVisitDate that was already set via the chart", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff({ displayName: "A", bookingSlug: "fv-manual", loginEmail: "fv-manual@example.com" });

    const first = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_1,
      source: "STAFF_MANUAL",
      createdByStaffId: staff.id,
      customer: { name: "田中花子", email: "fv-manual-customer@example.com", phone: "090-0000-0000" },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const reservation = await prisma.reservation.findUnique({ where: { id: first.reservationId } });
    await prisma.customer.update({
      where: { id: reservation!.customerId },
      data: { firstVisitDate: new Date("2026-08-31T00:00:00.000Z") },
    });

    const second = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_2,
      source: "STAFF_MANUAL",
      createdByStaffId: staff.id,
      customer: { name: "田中花子", email: "fv-manual-customer@example.com", phone: "090-0000-0000" },
    });
    expect(second.ok).toBe(true);

    const customer = await prisma.customer.findUnique({ where: { id: reservation!.customerId } });
    expect(customer?.firstVisitDate?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("scenario 5: a 2nd CUSTOMER_ONLINE booking for a returning customer does not touch firstVisitDate either", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff({ displayName: "A", bookingSlug: "fv-online", loginEmail: "fv-online@example.com" });

    const first = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_1,
      source: "CUSTOMER_ONLINE",
      customer: { name: "山田太郎", email: "fv-online-customer@example.com", phone: "090-1111-1111" },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const reservation = await prisma.reservation.findUnique({ where: { id: first.reservationId } });
    await prisma.customer.update({ where: { id: reservation!.customerId }, data: { firstVisitDate: new Date("2026-08-31T00:00:00.000Z") } });

    await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_2,
      source: "CUSTOMER_ONLINE",
      customer: { name: "山田太郎", email: "fv-online-customer@example.com", phone: "090-1111-1111" },
    });

    const customer = await prisma.customer.findUnique({ where: { id: reservation!.customerId } });
    expect(customer?.firstVisitDate?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("scenario 5b: the customer's first-ever VisitRecord auto-sets firstVisitDate to the visit's own date and the chosen acquisition source, atomically", async () => {
    const staff = await seedStaff({ displayName: "A", bookingSlug: "fv-first-a", loginEmail: "fv-first-a@example.com" });
    const source = await seedAcquisitionSourceMaster(staff.id, { name: "Threads" });
    const customer = await seedCustomer(staff.id);

    await sessionAs(staff.id);
    const { createMyVisitRecord } = await import("@/actions/visitRecords");
    const result = await createMyVisitRecord({
      customerId: customer.id,
      visitDateISO: "2026-06-15",
      amount: 9900,
      concernIds: [],
      firstVisitAcquisitionSourceId: source.id,
    });
    expect(result.ok).toBe(true);

    const updated = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(updated?.firstVisitDate?.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(updated?.firstVisitAcquisitionSourceId).toBe(source.id);
  });

  it("scenario 5c: a 2nd VisitRecord for the same customer never touches firstVisitDate/firstVisitAcquisitionSourceId, even if a different source is sent", async () => {
    const staff = await seedStaff({ displayName: "A", bookingSlug: "fv-second-a", loginEmail: "fv-second-a@example.com" });
    const sourceOriginal = await seedAcquisitionSourceMaster(staff.id, { name: "Threads" });
    const sourceOther = await seedAcquisitionSourceMaster(staff.id, { name: "Instagram" });
    const customer = await seedCustomer(staff.id);

    await sessionAs(staff.id);
    const { createMyVisitRecord } = await import("@/actions/visitRecords");
    await createMyVisitRecord({
      customerId: customer.id,
      visitDateISO: "2026-06-15",
      amount: 9900,
      concernIds: [],
      firstVisitAcquisitionSourceId: sourceOriginal.id,
    });

    await createMyVisitRecord({
      customerId: customer.id,
      visitDateISO: "2026-07-20",
      amount: 5000,
      concernIds: [],
      firstVisitAcquisitionSourceId: sourceOther.id,
    });

    const updated = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(updated?.firstVisitDate?.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(updated?.firstVisitAcquisitionSourceId).toBe(sourceOriginal.id);
    expect(await prisma.visitRecord.count({ where: { customerId: customer.id } })).toBe(2);
  });

  it("scenario 5d: a customer backfilled via the '訂正' form (firstVisitDate set before any VisitRecord exists) is not overwritten by a later VisitRecord", async () => {
    const staff = await seedStaff({ displayName: "A", bookingSlug: "fv-backfill-a", loginEmail: "fv-backfill-a@example.com" });
    const source = await seedAcquisitionSourceMaster(staff.id, { name: "紹介" });
    const customer = await seedCustomer(staff.id);

    await sessionAs(staff.id);
    const { updateMyCustomerFirstVisitInfo } = await import("@/actions/customers");
    await updateMyCustomerFirstVisitInfo({
      customerId: customer.id,
      firstVisitDateISO: "2025-01-10",
      firstVisitAcquisitionSourceId: source.id,
    });

    const { createMyVisitRecord } = await import("@/actions/visitRecords");
    const newSource = await seedAcquisitionSourceMaster(staff.id, { name: "Google" });
    await createMyVisitRecord({
      customerId: customer.id,
      visitDateISO: "2026-08-01",
      amount: 5000,
      concernIds: [],
      firstVisitAcquisitionSourceId: newSource.id,
    });

    const updated = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(updated?.firstVisitDate?.toISOString()).toBe("2025-01-10T00:00:00.000Z");
    expect(updated?.firstVisitAcquisitionSourceId).toBe(source.id);
  });
});
