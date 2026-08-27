"use server";

import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/authorization";
import { getCustomerDetail as getCustomerDetailQuery, listCustomers as listCustomersQuery } from "@/lib/customers/queries";
import { updateCustomerFirstVisitInputSchema, customerInputSchema } from "@/lib/validation/schemas";
import { normalizePhoneDigits } from "@/lib/customers/normalize";

export async function listMyCustomers() {
  const session = await requireStaffSession();
  return listCustomersQuery(session.staffId);
}

export async function getMyCustomerDetail(customerId: string) {
  const session = await requireStaffSession();
  return getCustomerDetailQuery(customerId, session.staffId);
}

export interface UpdateCustomerFirstVisitInput {
  customerId: string;
  firstVisitDateISO: string | null;
  firstVisitAcquisitionSourceId: string | null;
}

/**
 * "訂正用" entry point for firstVisitDate/firstVisitAcquisitionSourceId - see
 * plan §3. Normal recording happens automatically from the customer's first
 * VisitRecord (actions/visitRecords.ts); this action exists for backfilling
 * an existing customer or fixing a mistake.
 */
export async function updateMyCustomerFirstVisitInfo(input: UpdateCustomerFirstVisitInput) {
  const session = await requireStaffSession();
  const parsed = updateCustomerFirstVisitInputSchema.parse(input);

  if (parsed.firstVisitAcquisitionSourceId) {
    const source = await prisma.acquisitionSourceMaster.findFirst({
      where: { id: parsed.firstVisitAcquisitionSourceId, staffId: session.staffId },
      select: { id: true },
    });
    if (!source) throw new ForbiddenError();
  }

  const result = await prisma.customer.updateMany({
    where: { id: parsed.customerId, ownerStaffId: session.staffId },
    data: {
      firstVisitDate: parsed.firstVisitDateISO ? new Date(`${parsed.firstVisitDateISO}T00:00:00.000Z`) : null,
      firstVisitAcquisitionSourceId: parsed.firstVisitAcquisitionSourceId,
    },
  });
  if (result.count === 0) throw new ForbiddenError();
}

export interface UpdateCustomerContactInfoInput {
  customerId: string;
  name: string;
  email: string;
  phone: string;
}

export type UpdateCustomerContactInfoResult =
  | { ok: true }
  | { ok: false; reason: "VALIDATION_ERROR" }
  | { ok: false; reason: "DUPLICATE_EMAIL" };

/**
 * Edits the Customer MASTER row's name/email/phone - distinct from
 * updateMyCustomerFirstVisitInfo above (which only ever touches
 * firstVisitDate/firstVisitAcquisitionSourceId). Only reachable from an
 * explicit "顧客情報を更新する" confirmation in the manual-reservation flow's
 * customer picker - selecting an existing customer for a booking must never
 * silently reach this. The duplicate-email check is a pre-check (not a
 * caught P2002) because this driver-adapter setup's constraint-violation
 * error shape has proven unstable across versions - see errors.ts.
 */
export async function updateMyCustomerContactInfo(input: UpdateCustomerContactInfoInput): Promise<UpdateCustomerContactInfoResult> {
  const session = await requireStaffSession();
  const parsed = customerInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "VALIDATION_ERROR" };

  const conflict = await prisma.customer.findFirst({
    where: { ownerStaffId: session.staffId, email: parsed.data.email, NOT: { id: input.customerId } },
    select: { id: true },
  });
  if (conflict) return { ok: false, reason: "DUPLICATE_EMAIL" };

  const result = await prisma.customer.updateMany({
    where: { id: input.customerId, ownerStaffId: session.staffId },
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone,
      phoneDigits: normalizePhoneDigits(parsed.data.phone),
    },
  });
  if (result.count === 0) throw new ForbiddenError();
  return { ok: true };
}
