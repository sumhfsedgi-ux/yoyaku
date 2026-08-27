import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resetDb, seedAcquisitionSourceMaster, seedConcernMaster, seedCustomer, seedStaff, seedVisitRecord } from "../../helpers/db";

/**
 * End-to-end wiring for getMonthlyAnalytics (DB -> pure kpi.ts functions),
 * covering spec scenario 8 (new-customer-count query scoping) plus a
 * representative seeded month for the other KPIs/charts. Exhaustive edge
 * cases for the calculations themselves live in the unit tests
 * (tests/unit/analytics/*.test.ts) - same split as monthCell.ts/roomUsage.ts
 * elsewhere in this codebase.
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

describe("getMyMonthlyAnalytics", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("scopes every KPI/chart strictly to the caller's own staffId (spec scenario 8's new-customer-count, plus revenue/visits/breakdown/ranking)", async () => {
    const staffA = await seedStaff({ displayName: "A", bookingSlug: "an-a", loginEmail: "an-a@example.com" });
    const staffB = await seedStaff({ displayName: "B", bookingSlug: "an-b", loginEmail: "an-b@example.com" });

    const sourceA = await seedAcquisitionSourceMaster(staffA.id, { name: "Threads" });
    const concernA = await seedConcernMaster(staffA.id, { name: "便秘" });
    const newCustomerA = await seedCustomer(staffA.id, {
      firstVisitDate: new Date("2026-08-05T00:00:00.000Z"),
      firstVisitAcquisitionSourceId: sourceA.id,
    });
    const repeatCustomerA = await seedCustomer(staffA.id, { firstVisitDate: new Date("2026-01-01T00:00:00.000Z") });
    await seedVisitRecord(staffA.id, newCustomerA.id, { visitDate: new Date("2026-08-05T00:00:00.000Z"), amount: 9900 });
    const visitWithConcern = await seedVisitRecord(staffA.id, repeatCustomerA.id, { visitDate: new Date("2026-08-10T00:00:00.000Z"), amount: 5000 });
    await prisma.visitRecord.update({ where: { id: visitWithConcern.id }, data: { concerns: { connect: [{ id: concernA.id }] } } });
    // Outside the target month - must not be counted.
    await seedVisitRecord(staffA.id, newCustomerA.id, { visitDate: new Date("2026-07-01T00:00:00.000Z"), amount: 100000 });

    const sourceB = await seedAcquisitionSourceMaster(staffB.id, { name: "Instagram" });
    const newCustomerB = await seedCustomer(staffB.id, {
      firstVisitDate: new Date("2026-08-05T00:00:00.000Z"),
      firstVisitAcquisitionSourceId: sourceB.id,
    });
    await seedVisitRecord(staffB.id, newCustomerB.id, { visitDate: new Date("2026-08-05T00:00:00.000Z"), amount: 500000 });

    await sessionAs(staffA.id);
    const { getMyMonthlyAnalytics } = await import("@/actions/analytics");
    const analytics = await getMyMonthlyAnalytics(2026, 8);

    expect(analytics.kpis.monthlyRevenue).toBe(14900); // 9900 + 5000, staff B's 500000 excluded
    expect(analytics.kpis.visitCount).toBe(2);
    expect(analytics.kpis.newCustomerCount).toBe(1); // only newCustomerA, not staff B's
    expect(analytics.kpis.repeatVisitCount).toBe(1);

    // 2 rows: sourceA (newCustomerA's visit) and an explicit "未設定" bucket
    // (repeatCustomerA has no acquisition source set) - see plan §4/§6.
    expect(analytics.acquisitionBreakdown).toHaveLength(2);
    const sourceARow = analytics.acquisitionBreakdown.find((r) => r.sourceId === sourceA.id);
    const unsetRow = analytics.acquisitionBreakdown.find((r) => r.sourceId === null);
    expect(sourceARow?.revenue).toBe(9900);
    expect(sourceARow?.newCustomerCount).toBe(1);
    expect(unsetRow?.revenue).toBe(5000);
    expect(unsetRow?.newCustomerCount).toBe(0);

    expect(analytics.concernRanking).toHaveLength(1);
    expect(analytics.concernRanking[0].concernId).toBe(concernA.id);
    expect(analytics.concernRanking[0].count).toBe(1);
  });

  it("an empty month returns zeroed KPIs and empty chart arrays, not an error", async () => {
    const staff = await seedStaff({ displayName: "A", bookingSlug: "an-empty", loginEmail: "an-empty@example.com" });
    await sessionAs(staff.id);
    const { getMyMonthlyAnalytics } = await import("@/actions/analytics");
    const analytics = await getMyMonthlyAnalytics(2026, 8);

    expect(analytics.kpis).toEqual({
      monthlyRevenue: 0,
      visitCount: 0,
      newCustomerCount: 0,
      repeatVisitCount: 0,
      repeatVisitRate: 0,
      averageRevenuePerVisit: 0,
    });
    expect(analytics.acquisitionBreakdown).toEqual([]);
    expect(analytics.concernRanking).toEqual([]);
  });
});

describe("getMyAllTimeAnalytics", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("includes visits from any date (not limited to a recent window) and still scopes strictly to the caller's own staffId", async () => {
    const staffA = await seedStaff({ displayName: "A", bookingSlug: "an-all-a", loginEmail: "an-all-a@example.com" });
    const staffB = await seedStaff({ displayName: "B", bookingSlug: "an-all-b", loginEmail: "an-all-b@example.com" });

    const oldCustomerA = await seedCustomer(staffA.id, { firstVisitDate: new Date("2020-01-01T00:00:00.000Z") });
    const recentCustomerA = await seedCustomer(staffA.id, { firstVisitDate: new Date("2026-08-05T00:00:00.000Z") });
    // Years-old visit - a monthly query would never see this, all-time must.
    await seedVisitRecord(staffA.id, oldCustomerA.id, { visitDate: new Date("2020-01-01T00:00:00.000Z"), amount: 3000 });
    await seedVisitRecord(staffA.id, recentCustomerA.id, { visitDate: new Date("2026-08-05T00:00:00.000Z"), amount: 9900 });

    const customerB = await seedCustomer(staffB.id, { firstVisitDate: new Date("2020-01-01T00:00:00.000Z") });
    await seedVisitRecord(staffB.id, customerB.id, { visitDate: new Date("2020-01-01T00:00:00.000Z"), amount: 500000 });

    await sessionAs(staffA.id);
    const { getMyAllTimeAnalytics } = await import("@/actions/analytics");
    const analytics = await getMyAllTimeAnalytics();

    expect(analytics.kpis.monthlyRevenue).toBe(12900); // 3000 + 9900 - staff B's 500000 excluded
    expect(analytics.kpis.visitCount).toBe(2);
    expect(analytics.kpis.newCustomerCount).toBe(2); // every one of staff A's customers, regardless of when their first visit fell
  });
});
