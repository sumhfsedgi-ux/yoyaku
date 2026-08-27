"use server";

import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { updateMySalonNameInputSchema } from "@/lib/validation/schemas";

/**
 * No targetStaffId param - always acts on the caller's own session.staffId,
 * same pattern as actions/schedule.ts and actions/security.ts. This makes
 * "edit someone else's salon name" structurally uncallable, not just rejected.
 */

export async function getMySalonName(): Promise<string | null> {
  const session = await requireStaffSession();
  const staff = await prisma.staff.findUniqueOrThrow({
    where: { id: session.staffId },
    select: { salonName: true },
  });
  return staff.salonName;
}

export async function updateMySalonName(input: { salonName: string }) {
  const session = await requireStaffSession();
  const parsed = updateMySalonNameInputSchema.parse(input);

  await prisma.staff.update({
    where: { id: session.staffId },
    data: { salonName: parsed.salonName.length > 0 ? parsed.salonName : null },
  });
}
