"use server";

import { DateTime } from "luxon";
import { resolveStaffByBookingSlug } from "@/lib/reservations/staffLookup";
import { getAvailableSlotRangeStatus } from "@/actions/availability";
import { SALON_TIME_ZONE } from "@/lib/availability/types";
import { isLineNotificationEnabledForStaff } from "@/lib/line/staffGate";
import type { TwoWeekDayStatus } from "@/components/reserve/TwoWeekAvailabilityGrid";

export type GetStaffBookingPageDataResult =
  | {
      ok: true;
      bookingSlug: string;
      bookingWindowDays: number;
      salonName: string | null;
      todayISO: string;
      initialGridDays: TwoWeekDayStatus[];
      initialGridError: string | null;
      /**
       * Phase 1 staff scope (see lib/line/staffGate.ts) - false for every
       * staff except the one this app's LINE setup is configured for.
       * app/reserve/liff/page.tsx uses this to decide whether to attempt
       * LIFF login at all: false means it redirects straight to the plain
       * /reserve/[slug] page instead, so LINE identity is never touched for
       * an ineligible staff even at the client.
       */
      lineEnabled: boolean;
    }
  | { ok: false; reason: "STAFF_NOT_FOUND" };

/**
 * The /reserve/liff entry point's equivalent of what app/reserve/[slug]/page.tsx
 * computes server-side during its own render - resolve the staff by
 * bookingSlug and precompute the first 2-week availability grid. Pulled out
 * into its own callable Server Action because /reserve/liff cannot know
 * `slug` until AFTER liff.init() resolves client-side (see plan §11 - LIFF's
 * liff.state redirect handling means reading the query string before init
 * completes is unreliable), so this page can never be a plain Server
 * Component the way /reserve/[slug] is - the slug-dependent data has to be
 * fetched from the client, once the slug is actually known.
 *
 * Deliberately resolves staffId server-side from `bookingSlug` only, exactly
 * like resolveStaffByBookingSlug's other callers - nothing here accepts a
 * staffId from the client.
 */
export async function getStaffBookingPageData(bookingSlug: string): Promise<GetStaffBookingPageDataResult> {
  const staff = await resolveStaffByBookingSlug(bookingSlug);
  if (!staff || !staff.active) return { ok: false, reason: "STAFF_NOT_FOUND" };

  const todayISO = DateTime.now().setZone(SALON_TIME_ZONE).toISODate()!;
  const initialGrid = await getAvailableSlotRangeStatus(bookingSlug, todayISO);

  return {
    ok: true,
    bookingSlug: staff.bookingSlug,
    bookingWindowDays: staff.bookingWindowDays,
    salonName: staff.salonName,
    todayISO,
    initialGridDays: initialGrid.ok ? initialGrid.days : [],
    initialGridError: initialGrid.ok ? null : (initialGrid.reason ?? "UNKNOWN"),
    lineEnabled: isLineNotificationEnabledForStaff(staff.id),
  };
}
