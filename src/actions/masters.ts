"use server";

import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import {
  createAcquisitionSourceInputSchema,
  createConcernMasterInputSchema,
  renameAcquisitionSourceInputSchema,
  renameConcernMasterInputSchema,
  reorderMasterListInputSchema,
  setMasterActiveInputSchema,
} from "@/lib/validation/schemas";

/**
 * Self-only CRUD for the two staff-managed master lists (concerns / first-visit
 * acquisition sources). Never physically deleted - "hide" only sets active:false,
 * because VisitRecord/Customer rows may still reference an item (plan §4).
 * Every function scopes to session.staffId; there is no targetStaffId
 * parameter anywhere here (same pattern as actions/schedule.ts).
 */

async function nextSortOrder(model: "concernMaster" | "acquisitionSourceMaster", staffId: string): Promise<number> {
  const result =
    model === "concernMaster"
      ? await prisma.concernMaster.aggregate({ where: { staffId }, _max: { sortOrder: true } })
      : await prisma.acquisitionSourceMaster.aggregate({ where: { staffId }, _max: { sortOrder: true } });
  return (result._max.sortOrder ?? -1) + 1;
}

export async function listMyConcernMasters() {
  const session = await requireStaffSession();
  return prisma.concernMaster.findMany({ where: { staffId: session.staffId }, orderBy: { sortOrder: "asc" } });
}

export async function createMyConcernMaster(input: { name: string }) {
  const session = await requireStaffSession();
  const parsed = createConcernMasterInputSchema.parse(input);
  const sortOrder = await nextSortOrder("concernMaster", session.staffId);
  return prisma.concernMaster.create({ data: { staffId: session.staffId, name: parsed.name, sortOrder } });
}

export async function renameMyConcernMaster(input: { id: string; name: string }) {
  const session = await requireStaffSession();
  const parsed = renameConcernMasterInputSchema.parse(input);
  await prisma.concernMaster.updateMany({ where: { id: parsed.id, staffId: session.staffId }, data: { name: parsed.name } });
}

export async function setMyConcernMasterActive(input: { id: string; active: boolean }) {
  const session = await requireStaffSession();
  const parsed = setMasterActiveInputSchema.parse(input);
  await prisma.concernMaster.updateMany({ where: { id: parsed.id, staffId: session.staffId }, data: { active: parsed.active } });
}

export async function reorderMyConcernMasters(orderedIds: string[]) {
  const session = await requireStaffSession();
  const parsed = reorderMasterListInputSchema.parse({ orderedIds });
  await prisma.$transaction(
    parsed.orderedIds.map((id, index) =>
      prisma.concernMaster.updateMany({ where: { id, staffId: session.staffId }, data: { sortOrder: index } }),
    ),
  );
}

export async function listMyAcquisitionSources() {
  const session = await requireStaffSession();
  return prisma.acquisitionSourceMaster.findMany({ where: { staffId: session.staffId }, orderBy: { sortOrder: "asc" } });
}

export async function createMyAcquisitionSource(input: { name: string }) {
  const session = await requireStaffSession();
  const parsed = createAcquisitionSourceInputSchema.parse(input);
  const sortOrder = await nextSortOrder("acquisitionSourceMaster", session.staffId);
  return prisma.acquisitionSourceMaster.create({ data: { staffId: session.staffId, name: parsed.name, sortOrder } });
}

export async function renameMyAcquisitionSource(input: { id: string; name: string }) {
  const session = await requireStaffSession();
  const parsed = renameAcquisitionSourceInputSchema.parse(input);
  await prisma.acquisitionSourceMaster.updateMany({ where: { id: parsed.id, staffId: session.staffId }, data: { name: parsed.name } });
}

export async function setMyAcquisitionSourceActive(input: { id: string; active: boolean }) {
  const session = await requireStaffSession();
  const parsed = setMasterActiveInputSchema.parse(input);
  await prisma.acquisitionSourceMaster.updateMany({ where: { id: parsed.id, staffId: session.staffId }, data: { active: parsed.active } });
}

export async function reorderMyAcquisitionSources(orderedIds: string[]) {
  const session = await requireStaffSession();
  const parsed = reorderMasterListInputSchema.parse({ orderedIds });
  await prisma.$transaction(
    parsed.orderedIds.map((id, index) =>
      prisma.acquisitionSourceMaster.updateMany({ where: { id, staffId: session.staffId }, data: { sortOrder: index } }),
    ),
  );
}
