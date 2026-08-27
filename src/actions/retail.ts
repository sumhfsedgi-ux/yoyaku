"use server";

import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { assertOwnsCustomer, assertOwnsRetailSale, ForbiddenError } from "@/lib/auth/authorization";
import { getAllTimeRetailAnalytics, getMonthlyRetailAnalytics, listRetailSales, listRecentProductNames } from "@/lib/retail/queries";
import { createRetailSaleInputSchema, updateRetailSaleInputSchema } from "@/lib/validation/schemas";

/** Always self-only - the analytics page's retail section only ever shows the caller's own figures. */
export async function getMyMonthlyRetailAnalytics(year: number, month: number) {
  const session = await requireStaffSession();
  return getMonthlyRetailAnalytics(year, month, session.staffId);
}

/** Always self-only - lifetime totals for the analytics page's 全期間 mode. */
export async function getMyAllTimeRetailAnalytics() {
  const session = await requireStaffSession();
  return getAllTimeRetailAnalytics(session.staffId);
}

/** Always self-only - backs the /retail screen's own list (plan §7). */
export async function listMyRetailSales(year: number, month: number) {
  const session = await requireStaffSession();
  return listRetailSales(year, month, session.staffId);
}

export async function listMyRetailProductSuggestions() {
  const session = await requireStaffSession();
  return listRecentProductNames(session.staffId);
}

async function assertCustomerOwnedByCaller(staffId: string, customerId: string | null): Promise<void> {
  if (!customerId) return;
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { ownerStaffId: true } });
  if (!customer) throw new ForbiddenError();
  assertOwnsCustomer(staffId, customer);
}

export type CreateRetailSaleResult = { ok: true } | { ok: false; reason: "VALIDATION_ERROR" | "CUSTOMER_NOT_FOUND" };

export async function createMyRetailSale(rawInput: unknown): Promise<CreateRetailSaleResult> {
  const session = await requireStaffSession();
  const parsed = createRetailSaleInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, reason: "VALIDATION_ERROR" };
  const input = parsed.data;

  try {
    await assertCustomerOwnedByCaller(session.staffId, input.customerId);
  } catch {
    return { ok: false, reason: "CUSTOMER_NOT_FOUND" };
  }

  await prisma.retailSale.create({
    data: {
      staffId: session.staffId,
      customerId: input.customerId,
      soldAt: new Date(`${input.soldAtISO}T00:00:00.000Z`),
      totalAmount: input.totalAmount,
      memo: input.memo,
      items: { create: input.items.map((i) => ({ productName: i.productName, quantity: i.quantity })) },
    },
  });
  return { ok: true };
}

export type UpdateRetailSaleResult = CreateRetailSaleResult;

export async function updateMyRetailSale(rawInput: unknown): Promise<UpdateRetailSaleResult> {
  const session = await requireStaffSession();
  const parsed = updateRetailSaleInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, reason: "VALIDATION_ERROR" };
  const input = parsed.data;

  try {
    await assertCustomerOwnedByCaller(session.staffId, input.customerId);
  } catch {
    return { ok: false, reason: "CUSTOMER_NOT_FOUND" };
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.retailSale.findUnique({ where: { id: input.id }, select: { staffId: true } });
    if (!existing) throw new ForbiddenError();
    assertOwnsRetailSale(session.staffId, existing);

    await tx.retailSaleItem.deleteMany({ where: { retailSaleId: input.id } });
    await tx.retailSale.update({
      where: { id: input.id },
      data: {
        customerId: input.customerId,
        soldAt: new Date(`${input.soldAtISO}T00:00:00.000Z`),
        totalAmount: input.totalAmount,
        memo: input.memo,
        items: { create: input.items.map((i) => ({ productName: i.productName, quantity: i.quantity })) },
      },
    });
  });
  return { ok: true };
}

/** Status-flip only (never a physical delete) - keeps history, same as Reservation cancellation. Phase 1 has no "un-cancel". */
export async function cancelMyRetailSale(id: string): Promise<void> {
  const session = await requireStaffSession();
  const result = await prisma.retailSale.updateMany({
    where: { id, staffId: session.staffId, status: "COMPLETED" },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByStaffId: session.staffId },
  });
  if (result.count === 0) throw new ForbiddenError();
}
