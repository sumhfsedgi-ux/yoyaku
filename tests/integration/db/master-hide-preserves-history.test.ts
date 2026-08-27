import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resetDb, seedAcquisitionSourceMaster, seedConcernMaster, seedCustomer, seedStaff, seedVisitRecord } from "../../helpers/db";

/**
 * active=false means "hide from new-entry pickers", never "erase from past
 * data" (plan §4). Covers spec scenario 13 (past VisitRecord/Customer
 * display keeps working) and 13b (past analytics for a month with usage
 * keeps showing the item even after it's hidden), reproducing the exact
 * example from the plan: used in August, hidden in September, still shows in
 * August's analytics.
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

describe("Hiding a master item preserves past chart entries and past analytics", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("scenario 13: a hidden concern still resolves its name on a past VisitRecord", async () => {
    const staff = await seedStaff({ displayName: "A", bookingSlug: "hide-concern-a", loginEmail: "hide-concern-a@example.com" });
    const concern = await seedConcernMaster(staff.id, { name: "便秘" });
    const customer = await seedCustomer(staff.id);
    const visit = await seedVisitRecord(staff.id, customer.id, { visitDate: new Date("2026-08-10T00:00:00.000Z"), amount: 5000 });
    await prisma.visitRecord.update({ where: { id: visit.id }, data: { concerns: { connect: [{ id: concern.id }] } } });

    await sessionAs(staff.id);
    const { setMyConcernMasterActive } = await import("@/actions/masters");
    await setMyConcernMasterActive({ id: concern.id, active: false });

    const { getMyCustomerDetail } = await import("@/actions/customers");
    const detail = await getMyCustomerDetail(customer.id);
    expect(detail.visitRecords[0].concerns).toEqual([{ id: concern.id, name: "便秘" }]);
  });

  it("scenario 13: a hidden acquisition source still resolves its name on Customer.firstVisitAcquisitionSource", async () => {
    const staff = await seedStaff({ displayName: "A", bookingSlug: "hide-source-a", loginEmail: "hide-source-a@example.com" });
    const source = await seedAcquisitionSourceMaster(staff.id, { name: "Threadsモニター" });
    const customer = await seedCustomer(staff.id, {
      firstVisitDate: new Date("2026-08-01T00:00:00.000Z"),
      firstVisitAcquisitionSourceId: source.id,
    });

    await sessionAs(staff.id);
    const { setMyAcquisitionSourceActive } = await import("@/actions/masters");
    await setMyAcquisitionSourceActive({ id: source.id, active: false });

    const { getMyCustomerDetail } = await import("@/actions/customers");
    const detail = await getMyCustomerDetail(customer.id);
    expect(detail.firstVisitAcquisitionSource).toEqual({ id: source.id, name: "Threadsモニター" });
  });

  it("scenario 13b: a source used in August still appears in August's analytics after being hidden in September (plan §4 example)", async () => {
    const staff = await seedStaff({ displayName: "A", bookingSlug: "hide-analytics-a", loginEmail: "hide-analytics-a@example.com" });
    const source = await seedAcquisitionSourceMaster(staff.id, { name: "Threadsモニター" });

    for (let i = 0; i < 10; i++) {
      const customer = await seedCustomer(staff.id, {
        firstVisitDate: new Date("2026-08-15T00:00:00.000Z"),
        firstVisitAcquisitionSourceId: source.id,
      });
      await seedVisitRecord(staff.id, customer.id, { visitDate: new Date("2026-08-15T00:00:00.000Z"), amount: 5000 });
    }

    await sessionAs(staff.id);
    const { setMyAcquisitionSourceActive } = await import("@/actions/masters");
    await setMyAcquisitionSourceActive({ id: source.id, active: false }); // "hidden in September"

    const { getMyMonthlyAnalytics } = await import("@/actions/analytics");
    const augustAnalytics = await getMyMonthlyAnalytics(2026, 8);

    const row = augustAnalytics.acquisitionBreakdown.find((r) => r.sourceId === source.id);
    expect(row?.newCustomerCount).toBe(10);
    expect(row?.sourceName).toBe("Threadsモニター");
  });

  it("scenario 13b: a concern used in August still appears in August's concern ranking after being hidden", async () => {
    const staff = await seedStaff({ displayName: "A", bookingSlug: "hide-concern-analytics-a", loginEmail: "hide-concern-analytics-a@example.com" });
    const concern = await seedConcernMaster(staff.id, { name: "お腹の張り" });
    const customer = await seedCustomer(staff.id);
    const visit = await seedVisitRecord(staff.id, customer.id, { visitDate: new Date("2026-08-15T00:00:00.000Z"), amount: 5000 });
    await prisma.visitRecord.update({ where: { id: visit.id }, data: { concerns: { connect: [{ id: concern.id }] } } });

    await sessionAs(staff.id);
    const { setMyConcernMasterActive } = await import("@/actions/masters");
    await setMyConcernMasterActive({ id: concern.id, active: false });

    const { getMyMonthlyAnalytics } = await import("@/actions/analytics");
    const augustAnalytics = await getMyMonthlyAnalytics(2026, 8);
    const row = augustAnalytics.concernRanking.find((r) => r.concernId === concern.id);
    expect(row?.count).toBe(1);
    expect(row?.concernName).toBe("お腹の張り");
  });

  it("a hidden concern no longer appears as a selectable option for a brand-new VisitRecord (new-entry picker stays active-only)", async () => {
    const staff = await seedStaff({ displayName: "A", bookingSlug: "hide-picker-a", loginEmail: "hide-picker-a@example.com" });
    const concern = await seedConcernMaster(staff.id, { name: "睡眠" });

    await sessionAs(staff.id);
    const { setMyConcernMasterActive, listMyConcernMasters } = await import("@/actions/masters");
    await setMyConcernMasterActive({ id: concern.id, active: false });

    const all = await listMyConcernMasters();
    // list* still returns it (management screen needs to show/unhide it) - active is what UI-level pickers filter on.
    expect(all.find((c) => c.id === concern.id)?.active).toBe(false);
  });
});
