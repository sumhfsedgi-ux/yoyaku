"use server";

import { requireStaffSession } from "@/lib/auth/session";
import { computeAvailableSlots, computeAvailabilityForRange } from "@/lib/availability/engine";
import { prismaAvailabilityDeps } from "@/lib/availability/data";
import { computeEndDateISO } from "@/lib/reserve/dateGrid";

/**
 * Manual bookings are always for the CALLER's own staffId - there is no
 * staffId parameter here, same "no target id to even pass" pattern as
 * actions/security.ts's updateOwnCredentials. See ManualReservationForm.tsx.
 */
export async function getSlotsForManualBooking(dateISO: string) {
  const session = await requireStaffSession();
  return computeAvailableSlots({ staffId: session.staffId, dateISO }, prismaAvailabilityDeps);
}

/**
 * Backs the manual-booking page's 14-day date grid. Same self-only lockdown
 * as getSlotsForManualBooking (staffId always comes from the session), and
 * the room-wide effect of other staff's reservations/Google Calendar busy
 * feeds into the ○/× the same way it always has for this staff's own slot
 * computation - it just never surfaces which staff or why.
 */
export async function getSlotRangeStatusForManualBooking(startDateISO: string) {
  const session = await requireStaffSession();
  const endDateISO = computeEndDateISO(startDateISO);
  return computeAvailabilityForRange({ staffId: session.staffId, startDateISO, endDateISO }, prismaAvailabilityDeps);
}
