"use server";

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { createStaffInputSchema, updateStaffProfileInputSchema } from "@/lib/validation/schemas";

/**
 * Staff roster management: add / rename / activate / deactivate. Per plan
 * §10, this is shared among ALL staff (not self-only) - it's an operational
 * concern, not personal data. Notably these functions never touch loginEmail
 * or passwordHash; that's actions/security.ts's job, and only for the
 * caller's own account. Soft-delete only (`active` flag) - never a physical
 * delete, since Reservation/Customer rows reference Staff by id.
 */

export async function listStaff() {
  await requireStaffSession();
  return prisma.staff.findMany({
    select: { id: true, displayName: true, bookingSlug: true, loginEmail: true, active: true, mustChangePassword: true },
    orderBy: { createdAt: "asc" },
  });
}

export interface CreateStaffInput {
  displayName: string;
  bookingSlug: string;
  loginEmail: string;
  initialPassword: string;
}

export async function createStaff(rawInput: CreateStaffInput) {
  await requireStaffSession();
  const input = createStaffInputSchema.parse(rawInput);
  const passwordHash = await bcrypt.hash(input.initialPassword, 10);
  // Deliberately select-out passwordHash: Server Action return values are
  // serialized straight to the caller's browser, so returning the raw Prisma
  // record here would ship the (hashed, but still secret) password over the
  // wire on every staff-creation call - see plan §20's "never return
  // tokens/secrets to the frontend" principle, which applies just as much here.
  return prisma.staff.create({
    data: {
      displayName: input.displayName,
      bookingSlug: input.bookingSlug,
      loginEmail: input.loginEmail,
      passwordHash,
      mustChangePassword: true,
      active: true,
      bookingCutoffType: "HOURS_BEFORE",
      bookingCutoffHours: 3,
      bookingWindowDays: 30,
    },
    select: { id: true, displayName: true, bookingSlug: true, loginEmail: true, active: true, mustChangePassword: true },
  });
}

export interface UpdateStaffProfileInput {
  targetStaffId: string;
  displayName?: string;
  bookingSlug?: string;
  active?: boolean;
}

/** Deliberately has no loginEmail/password fields - see actions/security.ts for those. */
export async function updateStaffProfile(rawInput: UpdateStaffProfileInput) {
  await requireStaffSession();
  const input = updateStaffProfileInputSchema.parse(rawInput);
  // See createStaff() above for why passwordHash must never appear in a
  // Server Action's return value.
  return prisma.staff.update({
    where: { id: input.targetStaffId },
    data: {
      displayName: input.displayName,
      bookingSlug: input.bookingSlug,
      active: input.active,
    },
    select: { id: true, displayName: true, bookingSlug: true, loginEmail: true, active: true, mustChangePassword: true },
  });
}
