import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resetDb, seedCustomer, seedRetailSale, seedStaff } from "../../helpers/db";

/** Retail sales: registration, monthly aggregation, cancellation, and self-only isolation - see plan. */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

async function sessionAs(staffId: string) {
  const { getServerSession } = await import("next-auth");
  vi.mocked(getServerSession).mockResolvedValue({
    user: { name: "Test", email: "test@example.com" },
    staffId,
    mustChangePassword: false,
  } as never);
}

const AUG_1 = "2026-08-01T00:00:00.000Z";

describe("retail sales", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("registers a sale with multiple products, and ファイバー3+プロバイオ3 totals 6 units in the monthly aggregate", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "retail-a", loginEmail: "retail-a@example.com" });
    await sessionAs(staffA.id);
    const { createMyRetailSale, getMyMonthlyRetailAnalytics } = await import("@/actions/retail");

    const result = await createMyRetailSale({
      customerId: null,
      soldAtISO: "2026-08-15",
      totalAmount: 15000,
      items: [
        { productName: "ファイバー", quantity: 3 },
        { productName: "プロバイオ", quantity: 3 },
      ],
    });
    expect(result).toEqual({ ok: true });

    const analytics = await getMyMonthlyRetailAnalytics(2026, 8);
    expect(analytics.kpis).toEqual({ retailRevenue: 15000, unitsSold: 6, retailCustomerCount: 1 });
    expect(analytics.productBreakdown).toEqual(
      expect.arrayContaining([
        { productName: "ファイバー", quantity: 3 },
        { productName: "プロバイオ", quantity: 3 },
      ]),
    );
  });

  it("the checkout total is reflected in the monthly retail revenue", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "retail-b", loginEmail: "retail-b@example.com" });
    await seedRetailSale(staffA.id, { soldAt: new Date(AUG_1), totalAmount: 4000 });
    await seedRetailSale(staffA.id, { soldAt: new Date(AUG_1), totalAmount: 6000 });

    await sessionAs(staffA.id);
    const { getMyMonthlyRetailAnalytics } = await import("@/actions/retail");
    const analytics = await getMyMonthlyRetailAnalytics(2026, 8);
    expect(analytics.kpis.retailRevenue).toBe(10000);
  });

  it("the same customer buying twice in the same month counts as 1 person", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "retail-c", loginEmail: "retail-c@example.com" });
    const customer = await seedCustomer(staffA.id);
    await seedRetailSale(staffA.id, { soldAt: new Date(AUG_1), customerId: customer.id, totalAmount: 3000 });
    await seedRetailSale(staffA.id, { soldAt: new Date(AUG_1), customerId: customer.id, totalAmount: 3000 });

    await sessionAs(staffA.id);
    const { getMyMonthlyRetailAnalytics } = await import("@/actions/retail");
    expect((await getMyMonthlyRetailAnalytics(2026, 8)).kpis.retailCustomerCount).toBe(1);
  });

  it("two different customers count as 2 people, and an unregistered-buyer sale adds 1 more", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "retail-d", loginEmail: "retail-d@example.com" });
    const customer1 = await seedCustomer(staffA.id);
    const customer2 = await seedCustomer(staffA.id);
    await seedRetailSale(staffA.id, { soldAt: new Date(AUG_1), customerId: customer1.id, totalAmount: 1000 });
    await seedRetailSale(staffA.id, { soldAt: new Date(AUG_1), customerId: customer2.id, totalAmount: 1000 });
    await seedRetailSale(staffA.id, { soldAt: new Date(AUG_1), customerId: null, totalAmount: 1000 });

    await sessionAs(staffA.id);
    const { getMyMonthlyRetailAnalytics } = await import("@/actions/retail");
    expect((await getMyMonthlyRetailAnalytics(2026, 8)).kpis.retailCustomerCount).toBe(3);
  });

  it("cancelling a sale removes it from the monthly aggregate but keeps it (with status) in the self-only list", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "retail-e", loginEmail: "retail-e@example.com" });
    const sale = await seedRetailSale(staffA.id, { soldAt: new Date(AUG_1), totalAmount: 5000 });

    await sessionAs(staffA.id);
    const { getMyMonthlyRetailAnalytics, cancelMyRetailSale, listMyRetailSales } = await import("@/actions/retail");

    expect((await getMyMonthlyRetailAnalytics(2026, 8)).kpis.retailRevenue).toBe(5000);
    await cancelMyRetailSale(sale.id);
    expect((await getMyMonthlyRetailAnalytics(2026, 8)).kpis.retailRevenue).toBe(0);

    const list = await listMyRetailSales(2026, 8);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("CANCELLED");
  });

  it("the analytics aggregate for one staff member never includes another staff member's sales", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "retail-f-a", loginEmail: "retail-f-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "retail-f-b", loginEmail: "retail-f-b@example.com" });
    const customerA = await seedCustomer(staffA.id);
    const customerB = await seedCustomer(staffB.id);
    await seedRetailSale(staffA.id, { soldAt: new Date(AUG_1), customerId: customerA.id, totalAmount: 2000 });
    await seedRetailSale(staffB.id, { soldAt: new Date(AUG_1), customerId: customerB.id, totalAmount: 3000 });

    await sessionAs(staffA.id);
    const { getMyMonthlyRetailAnalytics } = await import("@/actions/retail");
    const mine = await getMyMonthlyRetailAnalytics(2026, 8);
    expect(mine.kpis.retailRevenue).toBe(2000);
    expect(mine.kpis.retailCustomerCount).toBe(1);
  });

  it("purchasers are limited to the caller's own customers: attaching another staff's customerId is rejected", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "retail-h-a", loginEmail: "retail-h-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "retail-h-b", loginEmail: "retail-h-b@example.com" });
    const othersCustomer = await seedCustomer(staffB.id);

    await sessionAs(staffA.id);
    const { createMyRetailSale } = await import("@/actions/retail");
    const result = await createMyRetailSale({
      customerId: othersCustomer.id,
      soldAtISO: "2026-08-15",
      totalAmount: 1000,
      items: [{ productName: "ファイバー", quantity: 1 }],
    });

    expect(result).toEqual({ ok: false, reason: "CUSTOMER_NOT_FOUND" });
    const count = await prisma.retailSale.count();
    expect(count).toBe(0);
  });

  it("getMyAllTimeRetailAnalytics includes sales from any date, excludes cancelled sales, and stays self-only", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "retail-j-a", loginEmail: "retail-j-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "retail-j-b", loginEmail: "retail-j-b@example.com" });

    // Years-old sale - a monthly query would never see this, all-time must.
    await seedRetailSale(staffA.id, { soldAt: new Date("2020-01-01T00:00:00.000Z"), totalAmount: 3000 });
    await seedRetailSale(staffA.id, { soldAt: new Date(AUG_1), totalAmount: 2000 });
    const cancelled = await seedRetailSale(staffA.id, { soldAt: new Date(AUG_1), totalAmount: 9999 });
    await prisma.retailSale.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });
    await seedRetailSale(staffB.id, { soldAt: new Date("2020-01-01T00:00:00.000Z"), totalAmount: 500000 });

    await sessionAs(staffA.id);
    const { getMyAllTimeRetailAnalytics } = await import("@/actions/retail");
    const analytics = await getMyAllTimeRetailAnalytics();

    expect(analytics.kpis.retailRevenue).toBe(5000); // 3000 + 2000 - cancelled and staff B's excluded
  });

  it("another staff's retail sale cannot be viewed, edited, or cancelled by id", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "retail-i-a", loginEmail: "retail-i-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "retail-i-b", loginEmail: "retail-i-b@example.com" });
    const staffASale = await seedRetailSale(staffA.id, { soldAt: new Date(AUG_1), totalAmount: 5000 });

    await sessionAs(staffB.id);
    const { updateMyRetailSale, cancelMyRetailSale, listMyRetailSales } = await import("@/actions/retail");

    await expect(
      updateMyRetailSale({
        id: staffASale.id,
        customerId: null,
        soldAtISO: "2026-08-16",
        totalAmount: 9999,
        items: [{ productName: "改ざん", quantity: 1 }],
      }),
    ).rejects.toThrow();

    await expect(cancelMyRetailSale(staffASale.id)).rejects.toThrow();

    const staffBList = await listMyRetailSales(2026, 8);
    expect(staffBList).toHaveLength(0);

    const untouched = await prisma.retailSale.findUnique({ where: { id: staffASale.id } });
    expect(untouched?.totalAmount).toBe(5000);
    expect(untouched?.status).toBe("COMPLETED");
  });
});
