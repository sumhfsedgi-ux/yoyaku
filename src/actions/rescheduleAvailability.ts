"use server";

import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { assertOwnsReservation } from "@/lib/auth/authorization";
import { computeAvailableSlots } from "@/lib/availability/engine";
import { prismaAvailabilityDeps } from "@/lib/availability/data";
import { getOccupiedRange } from "@/lib/availability/rules";

/** Slot listing for the reschedule dialog - same engine call as the public flow, plus self-exclusion (see engine.ts docs). */
export async function getReschedulableSlots(reservationId: string, dateISO: string) {
  const session = await requireStaffSession();

  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
  if (!reservation) return { ok: false as const, slots: [], reason: "NOT_FOUND" };
  assertOwnsReservation(session.staffId, reservation);

  // The reservation's own Google event is synced at its buffered occupied
  // window (see syncReservationToCalendarBestEffort), not its raw
  // startAt/endAt - the exclusion filter must match that same window.
  const { occupiedStart, occupiedEnd } = getOccupiedRange(reservation.startAt, reservation.endAt);

  return computeAvailableSlots(
    {
      staffId: reservation.staffId,
      dateISO,
      excludeReservationId: reservation.id,
      excludeCalendarBusyInterval: { start: occupiedStart, end: occupiedEnd },
    },
    prismaAvailabilityDeps,
  );
}
