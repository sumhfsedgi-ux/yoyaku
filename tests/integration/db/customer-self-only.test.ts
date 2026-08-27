import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ForbiddenError } from "@/lib/auth/authorization";
import { resetDb, seedCustomer, seedStaff, seedVisitRecord } from "../../helpers/db";

/**
 * Staff A must never see staff B's Customer rows (list or detail), and vice
 * versa - spec scenario 1. All reads go through requireStaffSession()'s
 * session.staffId, never a client-supplied staffId.
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

describe("Customer is strictly self-only", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("listMyCustomers never returns another staff's customers", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "cust-list-a", loginEmail: "cust-list-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "cust-list-b", loginEmail: "cust-list-b@example.com" });
    const customerA = await seedCustomer(staffA.id, { name: "顧客A" });
    await seedCustomer(staffB.id, { name: "顧客B" });

    await sessionAs(staffA.id);
    const { listMyCustomers } = await import("@/actions/customers");
    const result = await listMyCustomers();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(customerA.id);
  });

  it("getMyCustomerDetail throws ForbiddenError when staff B requests staff A's customer, and never leaks PII in the error path", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "cust-detail-a", loginEmail: "cust-detail-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "cust-detail-b", loginEmail: "cust-detail-b@example.com" });
    const customerA = await seedCustomer(staffA.id, { name: "顧客A", email: "secret-a@example.com" });
    await seedVisitRecord(staffA.id, customerA.id, { amount: 12000 });

    await sessionAs(staffB.id);
    const { getMyCustomerDetail } = await import("@/actions/customers");

    await expect(getMyCustomerDetail(customerA.id)).rejects.toThrow(ForbiddenError);
  });

  it("getMyCustomerDetail succeeds for the owning staff and returns derived totals", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "cust-detail-c", loginEmail: "cust-detail-c@example.com" });
    const customerA = await seedCustomer(staffA.id, { name: "顧客A" });
    await seedVisitRecord(staffA.id, customerA.id, { amount: 5000, visitDate: new Date("2026-07-01T00:00:00.000Z") });
    await seedVisitRecord(staffA.id, customerA.id, { amount: 9900, visitDate: new Date("2026-08-01T00:00:00.000Z") });

    await sessionAs(staffA.id);
    const { getMyCustomerDetail } = await import("@/actions/customers");
    const detail = await getMyCustomerDetail(customerA.id);

    expect(detail.totalVisits).toBe(2);
    expect(detail.totalRevenue).toBe(14900);
    expect(detail.visitRecords).toHaveLength(2);
    expect(detail.visitRecords[0].visitDate.getTime()).toBeGreaterThan(detail.visitRecords[1].visitDate.getTime());
  });

  it("updateMyCustomerFirstVisitInfo rejects staff B correcting staff A's customer", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "cust-update-a", loginEmail: "cust-update-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "cust-update-b", loginEmail: "cust-update-b@example.com" });
    const customerA = await seedCustomer(staffA.id);

    await sessionAs(staffB.id);
    const { updateMyCustomerFirstVisitInfo } = await import("@/actions/customers");

    await expect(
      updateMyCustomerFirstVisitInfo({ customerId: customerA.id, firstVisitDateISO: "2026-08-01", firstVisitAcquisitionSourceId: null }),
    ).rejects.toThrow(ForbiddenError);

    const unchanged = await prisma.customer.findUnique({ where: { id: customerA.id } });
    expect(unchanged?.firstVisitDate).toBeNull();
  });
});
