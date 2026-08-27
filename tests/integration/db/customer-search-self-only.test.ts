import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resetDb, seedCustomer, seedStaff } from "../../helpers/db";

/**
 * searchMyCustomers (spec items 1,2,4,5,6,8 - see plan §8): the registered-
 * customer picker in the manual-reservation flow. staffId always comes from
 * the mocked session, never from a parameter - so "pass another staff's id"
 * is not an API call this function can even accept (see also item 8's other
 * half, covered in manual-reservation-existing-customer.test.ts, for the
 * createReservation-side customerId re-verification).
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

describe("searchMyCustomers", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("item 1: with no query, returns only the caller's own customers", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "search-a", loginEmail: "search-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "search-b", loginEmail: "search-b@example.com" });
    await seedCustomer(staffA.id, { name: "自分の客" });
    await seedCustomer(staffB.id, { name: "他人の客" });

    await sessionAs(staffA.id);
    const { searchMyCustomers } = await import("@/actions/customerSearch");
    const result = await searchMyCustomers("");

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("自分の客");
  });

  it("item 2: matches by name", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "search-c", loginEmail: "search-c@example.com" });
    await seedCustomer(staffA.id, { name: "山田花子" });
    await seedCustomer(staffA.id, { name: "鈴木一郎" });

    await sessionAs(staffA.id);
    const { searchMyCustomers } = await import("@/actions/customerSearch");
    const result = await searchMyCustomers("山田");

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("山田花子");
  });

  it("item 4: matches by phone number regardless of hyphens, in either direction", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "search-d", loginEmail: "search-d@example.com" });
    await seedCustomer(staffA.id, { name: "電話太郎", phone: "090-1234-5678" });

    await sessionAs(staffA.id);
    const { searchMyCustomers } = await import("@/actions/customerSearch");

    const withoutHyphens = await searchMyCustomers("09012345678");
    expect(withoutHyphens.items.map((r) => r.name)).toContain("電話太郎");

    const withHyphens = await searchMyCustomers("1234-5678");
    expect(withHyphens.items.map((r) => r.name)).toContain("電話太郎");
  });

  it("item 5: matches by email", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "search-e", loginEmail: "search-e@example.com" });
    await seedCustomer(staffA.id, { name: "メール太郎", email: "unique-search-target@example.com" });

    await sessionAs(staffA.id);
    const { searchMyCustomers } = await import("@/actions/customerSearch");
    const result = await searchMyCustomers("unique-search-target");

    expect(result.items.map((r) => r.name)).toContain("メール太郎");
  });

  it("item 6: an exact-match customer belonging to a different staff never appears", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "search-f-a", loginEmail: "search-f-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "search-f-b", loginEmail: "search-f-b@example.com" });
    await seedCustomer(staffB.id, { name: "完全一致太郎", email: "exact-match@example.com", phone: "090-9999-0000" });

    await sessionAs(staffA.id);
    const { searchMyCustomers } = await import("@/actions/customerSearch");

    const byName = await searchMyCustomers("完全一致太郎");
    const byEmail = await searchMyCustomers("exact-match@example.com");
    const byPhone = await searchMyCustomers("09099990000");

    expect(byName.items).toHaveLength(0);
    expect(byEmail.items).toHaveLength(0);
    expect(byPhone.items).toHaveLength(0);
  });

  it("row shape never carries the full phone or email, only the last 4 digits of phone", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "search-g", loginEmail: "search-g@example.com" });
    await seedCustomer(staffA.id, { name: "絞り込み太郎", phone: "090-1234-5678", email: "should-not-leak@example.com" });

    await sessionAs(staffA.id);
    const { searchMyCustomers } = await import("@/actions/customerSearch");
    const result = await searchMyCustomers("絞り込み");

    expect(result.items[0]).not.toHaveProperty("email");
    expect(result.items[0]).not.toHaveProperty("phone");
    expect(result.items[0].phoneLast4).toBe("5678");
  });
});
