"use server";

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { updateOwnCredentialsInputSchema } from "@/lib/validation/schemas";

export type UpdateOwnCredentialsResult =
  | { ok: true }
  | { ok: false; reason: "WRONG_PASSWORD" | "EMAIL_TAKEN" | "VALIDATION_ERROR" };

/**
 * Updates the CALLER's own login email/password only - there is no
 * targetStaffId parameter anywhere in this function's signature, which is
 * what makes "change someone else's credentials" not just rejected but
 * structurally impossible to even call (see plan §10 / lib/auth/authorization.ts).
 * Requires re-entering the current password, standard practice for a
 * credentials change. Also rate-limited, since this is effectively a
 * password-guessing surface for an authenticated attacker who has stolen a
 * session but not the account password.
 */
export async function updateOwnCredentials(rawInput: {
  currentPassword: string;
  newLoginEmail?: string;
  newPassword?: string;
}): Promise<UpdateOwnCredentialsResult> {
  const session = await requireStaffSession();

  const parsed = updateOwnCredentialsInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, reason: "VALIDATION_ERROR" };
  const input = parsed.data;

  const rateLimit = await checkRateLimit({ key: `credentials:${session.staffId}`, limit: 10, windowSeconds: 15 * 60 });
  if (!rateLimit.ok) return { ok: false, reason: "WRONG_PASSWORD" };

  const staff = await prisma.staff.findUniqueOrThrow({ where: { id: session.staffId } });
  const currentMatches = await bcrypt.compare(input.currentPassword, staff.passwordHash);
  if (!currentMatches) return { ok: false, reason: "WRONG_PASSWORD" };

  if (input.newLoginEmail) {
    const existing = await prisma.staff.findUnique({ where: { loginEmail: input.newLoginEmail } });
    if (existing && existing.id !== session.staffId) return { ok: false, reason: "EMAIL_TAKEN" };
  }

  await prisma.staff.update({
    where: { id: session.staffId },
    data: {
      loginEmail: input.newLoginEmail,
      passwordHash: input.newPassword ? await bcrypt.hash(input.newPassword, 10) : undefined,
      mustChangePassword: input.newPassword ? false : undefined,
    },
  });

  return { ok: true };
}
