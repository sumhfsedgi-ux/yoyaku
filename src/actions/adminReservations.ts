"use server";

import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { assertOwnsReservation } from "@/lib/auth/authorization";
import { cancelReservation, createReservation, resyncReservationCalendarEvent } from "@/lib/reservations/service";
import type { CreateReservationResult } from "@/lib/reservations/service";
import { getReservationDetail as getReservationDetailQuery, listReservationsForDay as listReservationsForDayQuery } from "@/lib/reservations/queries";
import { createReservationInputSchema } from "@/lib/validation/schemas";

export async function listReservationsForDay(dateISO: string) {
  const session = await requireStaffSession();
  return listReservationsForDayQuery(dateISO, session.staffId);
}

export async function getReservationDetail(reservationId: string) {
  const session = await requireStaffSession();
  return getReservationDetailQuery(reservationId, session.staffId);
}

export type CreateManualReservationInput =
  | { startAtUtcIso: string; customerMode: "new"; customer: { name: string; email: string; phone: string } }
  | {
      startAtUtcIso: string;
      customerMode: "existing";
      customerId: string;
      /** "今回の予約情報だけ変更する" - never written to the Customer master row. */
      contactOverride?: { name: string; email: string; phone: string };
    };

/**
 * Manual (LINE/phone/in-person) bookings are always created under the
 * CALLER's own staffId - there is deliberately no staffId field on
 * CreateManualReservationInput, so "register this booking under a different
 * staff member" is not an API call that can even be constructed (same
 * pattern as actions/security.ts's updateOwnCredentials). This one line is
 * also what makes the Customer.ownerStaffId, the Google Calendar event's
 * staffDisplayName, and the staff-notification email recipient all correctly
 * resolve to the caller too - see createReservation/
 * syncReservationToCalendarBestEffort/sendBookingNotificationsBestEffort in
 * lib/reservations/service.ts, which all derive from this same staffId. The
 * same guarantee applies to customerMode: "existing" - createReservation
 * re-verifies the customerId belongs to this same staffId before using it
 * (see plan), so a forged/foreign customerId can't slip through even though
 * it's accepted as a plain string here.
 * Room-wide double-booking checks are unaffected: validateSlotBookable's
 * room-reservation lookup is keyed by roomId, never by staffId.
 */
export async function createManualReservation(input: CreateManualReservationInput): Promise<CreateReservationResult> {
  const session = await requireStaffSession();
  const parsed = createReservationInputSchema.safeParse({
    staffId: session.staffId,
    startAtUtcIso: input.startAtUtcIso,
    source: "STAFF_MANUAL",
    createdByStaffId: session.staffId,
    ...(input.customerMode === "new"
      ? { customer: input.customer }
      : { customerId: input.customerId, contactOverride: input.contactOverride }),
  });
  if (!parsed.success) return { ok: false, reason: "VALIDATION_ERROR" };

  return createReservation(parsed.data);
}

/**
 * Cancelling and resyncing are only ever surfaced in the UI on a staff
 * member's OWN reservation detail page (see app/(admin)/reservations/[id]),
 * but - same as rescheduleReservationAction - that's a UI placement fact, not
 * a security control: both are directly callable with an arbitrary
 * reservationId, so ownership must be re-checked here too, not just
 * inherited from wherever the button happened to be rendered.
 */
export async function cancelReservationAction(reservationId: string) {
  const session = await requireStaffSession();
  const existing = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { staffId: true } });
  if (!existing) return { ok: false as const, reason: "NOT_FOUND" as const };
  assertOwnsReservation(session.staffId, existing);

  return cancelReservation(reservationId, session.staffId);
}

export async function resyncCalendarEventAction(reservationId: string) {
  const session = await requireStaffSession();
  const existing = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { staffId: true } });
  if (!existing) return { ok: false as const, reason: "NOT_FOUND" as const };
  assertOwnsReservation(session.staffId, existing);

  return resyncReservationCalendarEvent(reservationId);
}
