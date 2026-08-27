"use server";

import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { searchCustomersForBooking } from "@/lib/customers/search";
import { customerInputSchema } from "@/lib/validation/schemas";
import { normalizeEmail, normalizePhoneDigits } from "@/lib/customers/normalize";

export async function searchMyCustomers(query: string, offset = 0) {
  const session = await requireStaffSession();
  return searchCustomersForBooking(session.staffId, query.trim().slice(0, 200), Math.max(0, offset));
}

export type DuplicateCheckResult =
  | { status: "none" }
  | { status: "own"; customer: { id: string; name: string; email: string; phone: string; lastVisitDate: Date | null; visitCount: number } }
  | { status: "other" };

/**
 * Checked before creating a brand-new Customer in the manual-reservation
 * flow, salon-wide (this app has no multi-tenant concept - see plan §0 - so
 * "salon-wide" here means every Customer row, not just the caller's own).
 * A match owned by someone else returns {status:"other"} with zero PII - no
 * name/phone/email/staff/visit-history - by construction (the type carries
 * nothing else), not merely by convention.
 */
export async function checkNewCustomerDuplicate(input: { name: string; email: string; phone: string }): Promise<DuplicateCheckResult> {
  const session = await requireStaffSession();
  const parsed = customerInputSchema.safeParse(input);
  if (!parsed.success) return { status: "none" };

  const match = await prisma.customer.findFirst({
    where: {
      OR: [
        { email: { equals: normalizeEmail(parsed.data.email), mode: "insensitive" } },
        { phoneDigits: normalizePhoneDigits(parsed.data.phone) },
      ],
    },
    select: { id: true, ownerStaffId: true, name: true, email: true, phone: true },
  });
  if (!match) return { status: "none" };
  if (match.ownerStaffId !== session.staffId) return { status: "other" };

  const [stats] = await prisma.reservation.groupBy({
    by: ["customerId"],
    where: { customerId: match.id, status: "CONFIRMED" },
    _count: { _all: true },
    _max: { startAt: true },
  });

  return {
    status: "own",
    customer: {
      id: match.id,
      name: match.name,
      email: match.email,
      phone: match.phone,
      lastVisitDate: stats?._max.startAt ?? null,
      visitCount: stats?._count._all ?? 0,
    },
  };
}
