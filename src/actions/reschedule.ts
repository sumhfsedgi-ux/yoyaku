"use server";

import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { assertOwnsReservation } from "@/lib/auth/authorization";
import { rescheduleReservation } from "@/lib/reservations/service";
import type { RescheduleReservationResult } from "@/lib/reservations/service";

/**
 * Per plan §13 UI routes, the "日時変更" (reschedule) action is only ever
 * surfaced on a staff member's OWN reservation detail page - enforced here
 * too, not just by UI placement, since this Server Action is directly
 * callable with an arbitrary reservationId.
 */
export async function rescheduleReservationAction(
  reservationId: string,
  newStartAtUtcIso: string,
): Promise<RescheduleReservationResult | { ok: false; reason: "NOT_FOUND" }> {
  const session = await requireStaffSession();

  const existing = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { staffId: true } });
  if (!existing) return { ok: false, reason: "NOT_FOUND" };
  assertOwnsReservation(session.staffId, existing);

  return rescheduleReservation({ reservationId, newStartAtUtcIso });
}
