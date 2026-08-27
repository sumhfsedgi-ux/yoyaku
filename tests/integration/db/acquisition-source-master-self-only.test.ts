import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resetDb, seedAcquisitionSourceMaster, seedStaff } from "../../helpers/db";

/** AcquisitionSourceMaster is self-only (spec scenario 4) - same shape as ConcernMaster's tests. */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

async function sessionAs(staffId: string) {
  const { getServerSession } = await import("next-auth");
  vi.mocked(getServerSession).mockResolvedValue({
    user: { name: "Test", email: "test@example.com" },
    staffId,
    mustChangePassword: false,
  } as never);
}

describe("AcquisitionSourceMaster is strictly self-only", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("listMyAcquisitionSources never returns another staff's items", async () => {
    const staffA = await seedStaff({ displayName: "A", bookingSlug: "asm-list-a", loginEmail: "asm-list-a@example.com" });
    const staffB = await seedStaff({ displayName: "B", bookingSlug: "asm-list-b", loginEmail: "asm-list-b@example.com" });
    const sourceA = await seedAcquisitionSourceMaster(staffA.id, { name: "Threads" });
    await seedAcquisitionSourceMaster(staffB.id, { name: "Instagram" });

    await sessionAs(staffA.id);
    const { listMyAcquisitionSources } = await import("@/actions/masters");
    const result = await listMyAcquisitionSources();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(sourceA.id);
  });

  it("renameMyAcquisitionSource silently no-ops when staff B targets staff A's item", async () => {
    const staffA = await seedStaff({ displayName: "A", bookingSlug: "asm-rename-a", loginEmail: "asm-rename-a@example.com" });
    const staffB = await seedStaff({ displayName: "B", bookingSlug: "asm-rename-b", loginEmail: "asm-rename-b@example.com" });
    const sourceA = await seedAcquisitionSourceMaster(staffA.id, { name: "Threads" });

    await sessionAs(staffB.id);
    const { renameMyAcquisitionSource } = await import("@/actions/masters");
    await renameMyAcquisitionSource({ id: sourceA.id, name: "改ざん" });

    const unchanged = await prisma.acquisitionSourceMaster.findUnique({ where: { id: sourceA.id } });
    expect(unchanged?.name).toBe("Threads");
  });

  it("setMyAcquisitionSourceActive silently no-ops when staff B targets staff A's item", async () => {
    const staffA = await seedStaff({ displayName: "A", bookingSlug: "asm-hide-a", loginEmail: "asm-hide-a@example.com" });
    const staffB = await seedStaff({ displayName: "B", bookingSlug: "asm-hide-b", loginEmail: "asm-hide-b@example.com" });
    const sourceA = await seedAcquisitionSourceMaster(staffA.id, { active: true });

    await sessionAs(staffB.id);
    const { setMyAcquisitionSourceActive } = await import("@/actions/masters");
    await setMyAcquisitionSourceActive({ id: sourceA.id, active: false });

    const unchanged = await prisma.acquisitionSourceMaster.findUnique({ where: { id: sourceA.id } });
    expect(unchanged?.active).toBe(true);
  });

  it("reorderMyAcquisitionSources only reorders the caller's own rows even if another staff's id is included", async () => {
    const staffA = await seedStaff({ displayName: "A", bookingSlug: "asm-reorder-a", loginEmail: "asm-reorder-a@example.com" });
    const staffB = await seedStaff({ displayName: "B", bookingSlug: "asm-reorder-b", loginEmail: "asm-reorder-b@example.com" });
    const sourceA1 = await seedAcquisitionSourceMaster(staffA.id, { sortOrder: 0 });
    const sourceA2 = await seedAcquisitionSourceMaster(staffA.id, { sortOrder: 1 });
    const sourceB = await seedAcquisitionSourceMaster(staffB.id, { sortOrder: 0 });

    await sessionAs(staffA.id);
    const { reorderMyAcquisitionSources } = await import("@/actions/masters");
    await reorderMyAcquisitionSources([sourceA2.id, sourceB.id, sourceA1.id]);

    const reorderedA2 = await prisma.acquisitionSourceMaster.findUnique({ where: { id: sourceA2.id } });
    const reorderedA1 = await prisma.acquisitionSourceMaster.findUnique({ where: { id: sourceA1.id } });
    const unchangedB = await prisma.acquisitionSourceMaster.findUnique({ where: { id: sourceB.id } });
    expect(reorderedA2?.sortOrder).toBe(0);
    expect(reorderedA1?.sortOrder).toBe(2);
    expect(unchangedB?.sortOrder).toBe(0);
  });
});
