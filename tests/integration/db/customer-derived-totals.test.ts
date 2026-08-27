import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resetDb, seedCustomer, seedStaff, seedVisitRecord } from "../../helpers/db";

/**
 * Customer.totalVisits/totalRevenue are never stored - always derived from
 * VisitRecord at query time (plan §3). Covers spec scenario 16: the
 * groupBy-based listMyCustomers and the aggregate-based getMyCustomerDetail
 * must both match what a direct sum over VisitRecord produces, including a
 * customer with zero visits.
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

describe("Customer list/detail derived totals match underlying VisitRecords", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("listMyCustomers' groupBy-derived totals match a customer's actual VisitRecords", async () => {
    const staff = await seedStaff({ displayName: "A", bookingSlug: "totals-list-a", loginEmail: "totals-list-a@example.com" });
    const customerWithVisits = await seedCustomer(staff.id, { name: "来店あり" });
    await seedVisitRecord(staff.id, customerWithVisits.id, { amount: 5000, visitDate: new Date("2026-07-01T00:00:00.000Z") });
    await seedVisitRecord(staff.id, customerWithVisits.id, { amount: 9900, visitDate: new Date("2026-08-01T00:00:00.000Z") });
    const customerWithoutVisits = await seedCustomer(staff.id, { name: "来店なし" });

    await sessionAs(staff.id);
    const { listMyCustomers } = await import("@/actions/customers");
    const list = await listMyCustomers();

    const withVisits = list.find((c) => c.id === customerWithVisits.id);
    expect(withVisits?.totalVisits).toBe(2);
    expect(withVisits?.totalRevenue).toBe(14900);
    expect(withVisits?.lastVisitDate?.toISOString()).toBe("2026-08-01T00:00:00.000Z");

    const withoutVisits = list.find((c) => c.id === customerWithoutVisits.id);
    expect(withoutVisits?.totalVisits).toBe(0);
    expect(withoutVisits?.totalRevenue).toBe(0);
    expect(withoutVisits?.lastVisitDate).toBeNull();
  });

  it("getMyCustomerDetail's aggregate-derived totals match listMyCustomers' groupBy-derived totals for the same customer", async () => {
    const staff = await seedStaff({ displayName: "A", bookingSlug: "totals-detail-a", loginEmail: "totals-detail-a@example.com" });
    const customer = await seedCustomer(staff.id);
    await seedVisitRecord(staff.id, customer.id, { amount: 3000 });
    await seedVisitRecord(staff.id, customer.id, { amount: 4000 });
    await seedVisitRecord(staff.id, customer.id, { amount: 2000 });

    await sessionAs(staff.id);
    const { listMyCustomers, getMyCustomerDetail } = await import("@/actions/customers");
    const list = await listMyCustomers();
    const detail = await getMyCustomerDetail(customer.id);

    const listItem = list.find((c) => c.id === customer.id);
    expect(detail.totalVisits).toBe(listItem?.totalVisits);
    expect(detail.totalRevenue).toBe(listItem?.totalRevenue);
    expect(detail.totalRevenue).toBe(9000);
  });

  it("totals never include another staff's VisitRecords for a customer of the same id space", async () => {
    const staffA = await seedStaff({ displayName: "A", bookingSlug: "totals-iso-a", loginEmail: "totals-iso-a@example.com" });
    const staffB = await seedStaff({ displayName: "B", bookingSlug: "totals-iso-b", loginEmail: "totals-iso-b@example.com" });
    const customerA = await seedCustomer(staffA.id);
    await seedVisitRecord(staffA.id, customerA.id, { amount: 1000 });
    const customerB = await seedCustomer(staffB.id);
    await seedVisitRecord(staffB.id, customerB.id, { amount: 999999 });

    await sessionAs(staffA.id);
    const { listMyCustomers } = await import("@/actions/customers");
    const list = await listMyCustomers();

    expect(list).toHaveLength(1);
    expect(list[0].totalRevenue).toBe(1000);
  });
});
