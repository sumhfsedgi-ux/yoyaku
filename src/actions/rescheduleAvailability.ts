"use server";

import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { assertOwnsReservation } from "@/lib/auth/authorization";
import { computeAvailableSlots } from "@/lib/availability/engine";
import { prismaAvailabilityDeps } from "@/lib/availability/data";

/** Slot listing for the reschedule dialog - same engine call as the public flow, plus self-exclusion (see engine.ts docs). */
export async function getReschedulableSlots(reservationId: string, dateISO: string) {
  const session = await requireStaffSession();

  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
  if (!reservation) return { ok: false as const, slots: [], reason: "NOT_FOUND" };
  assertOwnsReservation(session.staffId, reservation);

  return computeAvailableSlots(
    {
      staffId: reservation.staffId,
      dateISO,
      excludeReservationId: reservation.id,
      excludeCalendarBusyInterval: { start: reservation.startAt, end: reservation.endAt },
    },
    prismaAvailabilityDeps,
  );
}
