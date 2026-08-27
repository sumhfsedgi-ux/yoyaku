"use server";

import type { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { assertOwnsCustomer, assertOwnsReservation, assertOwnsVisitRecord } from "@/lib/auth/authorization";
import { createVisitRecordInputSchema, updateVisitRecordInputSchema } from "@/lib/validation/schemas";
import type { VisitRecordListItem } from "@/lib/customers/queries";

/**
 * Phase 1 deliberately implements create/update only - no delete. VisitRecord
 * is the source of truth for revenue/visit-count/acquisition/concern
 * analytics (plan §5), so mistakes are corrected via update, not by removing
 * rows. A future void/deactivate mechanism (not physical delete) can be
 * considered separately if this turns out to be needed.
 */

class NotFoundSignal extends Error {}
class ValidationSignal extends Error {}
class AlreadyRecordedSignal extends Error {}

export type CreateVisitRecordInput = z.infer<typeof createVisitRecordInputSchema>;
export type UpdateVisitRecordInput = z.infer<typeof updateVisitRecordInputSchema>;

export type CreateVisitRecordResult =
  | { ok: true; visitRecordId: string }
  | { ok: false; reason: "VALIDATION_ERROR" | "NOT_FOUND" | "ALREADY_RECORDED" };
export type UpdateVisitRecordResult = { ok: true } | { ok: false; reason: "VALIDATION_ERROR" | "NOT_FOUND" };

/**
 * Creates a VisitRecord and, only when this is the customer's first-ever
 * VisitRecord (customer.firstVisitDate is still null - checked server-side,
 * never trusting the form's UI-only guard), atomically sets
 * Customer.firstVisitDate to this visit's own visitDate and, if supplied and
 * valid, firstVisitAcquisitionSourceId. See plan §3/§7. A 2nd+ visit never
 * touches either field, even if the caller sends firstVisitAcquisitionSourceId.
 */
export async function createMyVisitRecord(rawInput: CreateVisitRecordInput): Promise<CreateVisitRecordResult> {
  const session = await requireStaffSession();
  const parsed = createVisitRecordInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, reason: "VALIDATION_ERROR" };
  const input = parsed.data;

  try {
    const visitRecordId = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: input.customerId },
        select: { ownerStaffId: true, firstVisitDate: true },
      });
      if (!customer) throw new NotFoundSignal();
      assertOwnsCustomer(session.staffId, customer);

      if (input.reservationId) {
        const reservation = await tx.reservation.findUnique({
          where: { id: input.reservationId },
          select: { staffId: true, customerId: true },
        });
        if (!reservation) throw new NotFoundSignal();
        assertOwnsReservation(session.staffId, reservation);
        if (reservation.customerId !== input.customerId) throw new ValidationSignal();

        // reservationId is @unique on VisitRecord - checked explicitly (rather
        // than catching the resulting P2002 below) so a double-submit on the
        // same reservation gets a clear result instead of a raw DB error.
        const alreadyRecorded = await tx.visitRecord.findUnique({ where: { reservationId: input.reservationId }, select: { id: true } });
        if (alreadyRecorded) throw new AlreadyRecordedSignal();
      }

      if (input.concernIds.length > 0) {
        const ownedCount = await tx.concernMaster.count({ where: { id: { in: input.concernIds }, staffId: session.staffId } });
        if (ownedCount !== input.concernIds.length) throw new ValidationSignal();
      }

      const isFirstVisit = customer.firstVisitDate === null;
      let firstVisitAcquisitionSourceId: string | null = null;
      if (isFirstVisit && input.firstVisitAcquisitionSourceId) {
        const source = await tx.acquisitionSourceMaster.findFirst({
          where: { id: input.firstVisitAcquisitionSourceId, staffId: session.staffId },
          select: { id: true },
        });
        if (source) firstVisitAcquisitionSourceId = source.id;
      }

      const visitDate = new Date(`${input.visitDateISO}T00:00:00.000Z`);

      const visitRecord = await tx.visitRecord.create({
        data: {
          staffId: session.staffId,
          customerId: input.customerId,
          reservationId: input.reservationId,
          visitDate,
          amount: input.amount,
          concernDetail: input.concernDetail,
          customerImpression: input.customerImpression,
          staffComment: input.staffComment,
          nextVisitMemo: input.nextVisitMemo,
          concerns: { connect: input.concernIds.map((id) => ({ id })) },
        },
      });

      if (isFirstVisit) {
        await tx.customer.update({
          where: { id: input.customerId },
          data: { firstVisitDate: visitDate, firstVisitAcquisitionSourceId },
        });
      }

      return visitRecord.id;
    });

    return { ok: true, visitRecordId };
  } catch (err) {
    if (err instanceof NotFoundSignal) return { ok: false, reason: "NOT_FOUND" };
    if (err instanceof ValidationSignal) return { ok: false, reason: "VALIDATION_ERROR" };
    if (err instanceof AlreadyRecordedSignal) return { ok: false, reason: "ALREADY_RECORDED" };
    throw err;
  }
}

/** Never touches Customer.firstVisitDate/firstVisitAcquisitionSourceId - only createMyVisitRecord's first-visit path does. */
export async function updateMyVisitRecord(rawInput: UpdateVisitRecordInput): Promise<UpdateVisitRecordResult> {
  const session = await requireStaffSession();
  const parsed = updateVisitRecordInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, reason: "VALIDATION_ERROR" };
  const input = parsed.data;

  const existing = await prisma.visitRecord.findUnique({ where: { id: input.id }, select: { staffId: true } });
  if (!existing) return { ok: false, reason: "NOT_FOUND" };
  assertOwnsVisitRecord(session.staffId, existing);

  if (input.concernIds.length > 0) {
    const ownedCount = await prisma.concernMaster.count({ where: { id: { in: input.concernIds }, staffId: session.staffId } });
    if (ownedCount !== input.concernIds.length) return { ok: false, reason: "VALIDATION_ERROR" };
  }

  await prisma.visitRecord.update({
    where: { id: input.id },
    data: {
      visitDate: new Date(`${input.visitDateISO}T00:00:00.000Z`),
      amount: input.amount,
      concernDetail: input.concernDetail,
      customerImpression: input.customerImpression,
      staffComment: input.staffComment,
      nextVisitMemo: input.nextVisitMemo,
      concerns: { set: input.concernIds.map((id) => ({ id })) },
    },
  });

  return { ok: true };
}

export async function getMyVisitRecordForReservation(reservationId: string): Promise<VisitRecordListItem | null> {
  const session = await requireStaffSession();
  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { staffId: true } });
  if (!reservation) return null;
  assertOwnsReservation(session.staffId, reservation);

  return prisma.visitRecord.findUnique({
    where: { reservationId },
    select: {
      id: true,
      reservationId: true,
      visitDate: true,
      amount: true,
      concerns: { select: { id: true, name: true } },
      concernDetail: true,
      customerImpression: true,
      staffComment: true,
      nextVisitMemo: true,
    },
  });
}
