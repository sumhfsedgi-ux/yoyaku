import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resetDb, seedConcernMaster, seedStaff } from "../../helpers/db";

/** ConcernMaster is self-only, same as ConcernMaster's sibling AcquisitionSourceMaster (spec scenario 3). */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

async function sessionAs(staffId: string) {
  const { getServerSession } = await import("next-auth");
  vi.mocked(getServerSession).mockResolvedValue({
    user: { name: "Test", email: "test@example.com" },
    staffId,
    mustChangePassword: false,
  } as never);
}

describe("ConcernMaster is strictly self-only", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("listMyConcernMasters never returns another staff's items", async () => {
    const staffA = await seedStaff({ displayName: "A", bookingSlug: "cm-list-a", loginEmail: "cm-list-a@example.com" });
    const staffB = await seedStaff({ displayName: "B", bookingSlug: "cm-list-b", loginEmail: "cm-list-b@example.com" });
    const concernA = await seedConcernMaster(staffA.id, { name: "便秘" });
    await seedConcernMaster(staffB.id, { name: "冷え" });

    await sessionAs(staffA.id);
    const { listMyConcernMasters } = await import("@/actions/masters");
    const result = await listMyConcernMasters();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(concernA.id);
  });

  it("renameMyConcernMaster silently no-ops when staff B targets staff A's item", async () => {
    const staffA = await seedStaff({ displayName: "A", bookingSlug: "cm-rename-a", loginEmail: "cm-rename-a@example.com" });
    const staffB = await seedStaff({ displayName: "B", bookingSlug: "cm-rename-b", loginEmail: "cm-rename-b@example.com" });
    const concernA = await seedConcernMaster(staffA.id, { name: "便秘" });

    await sessionAs(staffB.id);
    const { renameMyConcernMaster } = await import("@/actions/masters");
    await renameMyConcernMaster({ id: concernA.id, name: "改ざん" });

    const unchanged = await prisma.concernMaster.findUnique({ where: { id: concernA.id } });
    expect(unchanged?.name).toBe("便秘");
  });

  it("setMyConcernMasterActive silently no-ops when staff B targets staff A's item", async () => {
    const staffA = await seedStaff({ displayName: "A", bookingSlug: "cm-hide-a", loginEmail: "cm-hide-a@example.com" });
    const staffB = await seedStaff({ displayName: "B", bookingSlug: "cm-hide-b", loginEmail: "cm-hide-b@example.com" });
    const concernA = await seedConcernMaster(staffA.id, { active: true });

    await sessionAs(staffB.id);
    const { setMyConcernMasterActive } = await import("@/actions/masters");
    await setMyConcernMasterActive({ id: concernA.id, active: false });

    const unchanged = await prisma.concernMaster.findUnique({ where: { id: concernA.id } });
    expect(unchanged?.active).toBe(true);
  });

  it("reorderMyConcernMasters only reorders the caller's own rows even if another staff's id is included", async () => {
    const staffA = await seedStaff({ displayName: "A", bookingSlug: "cm-reorder-a", loginEmail: "cm-reorder-a@example.com" });
    const staffB = await seedStaff({ displayName: "B", bookingSlug: "cm-reorder-b", loginEmail: "cm-reorder-b@example.com" });
    const concernA1 = await seedConcernMaster(staffA.id, { sortOrder: 0 });
    const concernA2 = await seedConcernMaster(staffA.id, { sortOrder: 1 });
    const concernB = await seedConcernMaster(staffB.id, { sortOrder: 0 });

    await sessionAs(staffA.id);
    const { reorderMyConcernMasters } = await import("@/actions/masters");
    await reorderMyConcernMasters([concernA2.id, concernB.id, concernA1.id]);

    const reorderedA2 = await prisma.concernMaster.findUnique({ where: { id: concernA2.id } });
    const reorderedA1 = await prisma.concernMaster.findUnique({ where: { id: concernA1.id } });
    const unchangedB = await prisma.concernMaster.findUnique({ where: { id: concernB.id } });
    expect(reorderedA2?.sortOrder).toBe(0);
    expect(reorderedA1?.sortOrder).toBe(2);
    expect(unchangedB?.sortOrder).toBe(0);
  });

  it("createMyConcernMaster always attaches the caller's own staffId, never a client-supplied one", async () => {
    const staffA = await seedStaff({ displayName: "A", bookingSlug: "cm-create-a", loginEmail: "cm-create-a@example.com" });

    await sessionAs(staffA.id);
    const { createMyConcernMaster } = await import("@/actions/masters");
    const created = await createMyConcernMaster({ name: "肌荒れ" });

    expect(created.staffId).toBe(staffA.id);
  });
});
