import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resetDb, seedCustomer, seedStaff } from "../../helpers/db";

/** checkNewCustomerDuplicate (spec items 13,14 - see plan §8). */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

async function sessionAs(staffId: string) {
  const { getServerSession } = await import("next-auth");
  vi.mocked(getServerSession).mockResolvedValue({
    user: { name: "Test", email: "test@example.com" },
    staffId,
    mustChangePassword: false,
  } as never);
}

describe("checkNewCustomerDuplicate", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("item 13: a contact match under the caller's own customers returns status 'own' with full detail", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "dup-a", loginEmail: "dup-a@example.com" });
    const existing = await seedCustomer(staffA.id, { name: "既存花子", email: "hanako-existing@example.com", phone: "090-1111-2222" });

    await sessionAs(staffA.id);
    const { checkNewCustomerDuplicate } = await import("@/actions/customerSearch");

    const byEmail = await checkNewCustomerDuplicate({ name: "別名で入力", email: "HANAKO-EXISTING@example.com", phone: "080-0000-0000" });
    expect(byEmail).toEqual({
      status: "own",
      customer: { id: existing.id, name: "既存花子", email: "hanako-existing@example.com", phone: "090-1111-2222", lastVisitDate: null, visitCount: 0 },
    });

    const byPhone = await checkNewCustomerDuplicate({ name: "別名で入力", email: "different@example.com", phone: "09011112222" });
    expect(byPhone.status).toBe("own");
  });

  it("same name alone (different contact info) is not treated as a duplicate", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "dup-b", loginEmail: "dup-b@example.com" });
    await seedCustomer(staffA.id, { name: "同姓同名太郎", email: "one@example.com", phone: "090-1111-1111" });

    await sessionAs(staffA.id);
    const { checkNewCustomerDuplicate } = await import("@/actions/customerSearch");
    const result = await checkNewCustomerDuplicate({ name: "同姓同名太郎", email: "two@example.com", phone: "090-2222-2222" });

    expect(result).toEqual({ status: "none" });
  });

  it("item 14: a contact match under a DIFFERENT staff's customer returns status 'other' with no PII at all", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "dup-c-a", loginEmail: "dup-c-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "dup-c-b", loginEmail: "dup-c-b@example.com" });
    await seedCustomer(staffB.id, { name: "他スタッフの客", email: "other-staff-customer@example.com", phone: "090-3333-4444" });

    await sessionAs(staffA.id);
    const { checkNewCustomerDuplicate } = await import("@/actions/customerSearch");
    const result = await checkNewCustomerDuplicate({ name: "適当な名前", email: "other-staff-customer@example.com", phone: "000-0000-0000" });

    expect(result).toEqual({ status: "other" });
    expect(Object.keys(result)).toEqual(["status"]);
  });
});
