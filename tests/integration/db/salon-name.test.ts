import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resetDb, seedStaff } from "../../helpers/db";

/**
 * salonName is per-staff, not a shared/global setting. updateMySalonName has
 * no targetStaffId param - it always resolves the row via requireStaffSession(),
 * same technique as manual-reservation-self-only.test.ts.
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

describe("Per-staff salonName", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("staff A and staff B can each set their own salonName independently", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "salon-a", loginEmail: "salon-a@example.com" });
    const staffB = await seedStaff({ displayName: "スタッフB", bookingSlug: "salon-b", loginEmail: "salon-b@example.com" });

    const { updateMySalonName, getMySalonName } = await import("@/actions/profile");

    await sessionAs(staffA.id);
    await updateMySalonName({ salonName: "腸もみサロン ゆきの" });

    await sessionAs(staffB.id);
    await updateMySalonName({ salonName: "○○ Beauty Salon" });

    const rowA = await prisma.staff.findUniqueOrThrow({ where: { id: staffA.id } });
    const rowB = await prisma.staff.findUniqueOrThrow({ where: { id: staffB.id } });
    expect(rowA.salonName).toBe("腸もみサロン ゆきの");
    expect(rowB.salonName).toBe("○○ Beauty Salon");

    // getMySalonName only ever returns the caller's own value.
    await sessionAs(staffA.id);
    expect(await getMySalonName()).toBe("腸もみサロン ゆきの");
    await sessionAs(staffB.id);
    expect(await getMySalonName()).toBe("○○ Beauty Salon");
  });

  it("staff A calling updateMySalonName can never touch staff B's row - there is no staffId param to forge", async () => {
    const staffA = await seedStaff({ displayName: "スタッフA", bookingSlug: "salon-forge-a", loginEmail: "salon-forge-a@example.com" });
    const staffB = await seedStaff({
      displayName: "スタッフB",
      bookingSlug: "salon-forge-b",
      loginEmail: "salon-forge-b@example.com",
      salonName: "△△ Salon",
    });

    await sessionAs(staffA.id);
    const { updateMySalonName } = await import("@/actions/profile");
    await updateMySalonName({ salonName: "乗っ取りサロン" });

    const rowB = await prisma.staff.findUniqueOrThrow({ where: { id: staffB.id } });
    expect(rowB.salonName).toBe("△△ Salon");
  });

  it("unset salonName is null, not an empty string or placeholder, and saving an empty value clears it back to null", async () => {
    const staff = await seedStaff({ bookingSlug: "salon-unset", loginEmail: "salon-unset@example.com" });
    const { getMySalonName, updateMySalonName } = await import("@/actions/profile");

    await sessionAs(staff.id);
    expect(await getMySalonName()).toBeNull();

    await updateMySalonName({ salonName: "一時的な名前" });
    expect(await getMySalonName()).toBe("一時的な名前");

    await updateMySalonName({ salonName: "" });
    expect(await getMySalonName()).toBeNull();
  });

  it("/reserve/[slug] lookup returns each staff's own salonName by bookingSlug", async () => {
    await seedStaff({ displayName: "スタッフA", bookingSlug: "salon-reserve-a", loginEmail: "salon-reserve-a@example.com", salonName: "腸もみサロン ゆきの" });
    await seedStaff({ displayName: "スタッフB", bookingSlug: "salon-reserve-b", loginEmail: "salon-reserve-b@example.com", salonName: "○○ Beauty Salon" });
    await seedStaff({ displayName: "スタッフC", bookingSlug: "salon-reserve-c", loginEmail: "salon-reserve-c@example.com" });

    const a = await prisma.staff.findUnique({ where: { bookingSlug: "salon-reserve-a" }, select: { salonName: true } });
    const b = await prisma.staff.findUnique({ where: { bookingSlug: "salon-reserve-b" }, select: { salonName: true } });
    const c = await prisma.staff.findUnique({ where: { bookingSlug: "salon-reserve-c" }, select: { salonName: true } });

    expect(a?.salonName).toBe("腸もみサロン ゆきの");
    expect(b?.salonName).toBe("○○ Beauty Salon");
    expect(c?.salonName).toBeNull();
  });
});
