"use server";

import { DateTime } from "luxon";
import { resolveStaffByBookingSlug } from "@/lib/reservations/staffLookup";
import { getAvailableSlotRangeStatus } from "@/actions/availability";
import { SALON_TIME_ZONE } from "@/lib/availability/types";
import { isLineNotificationEnabledForStaff } from "@/lib/line/staffGate";
import { verifyLineIdToken } from "@/lib/line/identity";
import { prisma } from "@/lib/db/prisma";
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
      /**
       * TEMPORARY (perf investigation, see .claude/plans): true only when
       * RESERVATION_PERF_DEBUG=1 AND this is the LINE-enabled staff - never
       * shown to ordinary customers/staff. app/reserve/liff/page.tsx uses
       * this to decide whether to run its own client-side phase timing and
       * render a duration-only debug panel (no PII).
       */
      perfDebug: boolean;
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
  const perfStart = process.env.RESERVATION_PERF_DEBUG === "1" ? performance.now() : 0;

  const staff = await resolveStaffByBookingSlug(bookingSlug);
  if (!staff || !staff.active) return { ok: false, reason: "STAFF_NOT_FOUND" };

  const lineEnabled = isLineNotificationEnabledForStaff(staff.id);
  const perfDebug = process.env.RESERVATION_PERF_DEBUG === "1" && lineEnabled;

  const todayISO = DateTime.now().setZone(SALON_TIME_ZONE).toISODate()!;
  const initialGrid = await getAvailableSlotRangeStatus(bookingSlug, todayISO);

  if (perfDebug) console.log(`[perf:staffdata] total ${(performance.now() - perfStart).toFixed(1)}ms`);

  return {
    ok: true,
    bookingSlug: staff.bookingSlug,
    bookingWindowDays: staff.bookingWindowDays,
    salonName: staff.salonName,
    todayISO,
    initialGridDays: initialGrid.ok ? initialGrid.days : [],
    initialGridError: initialGrid.ok ? null : (initialGrid.reason ?? "UNKNOWN"),
    lineEnabled,
    perfDebug,
  };
}

/**
 * Returns a returning LINE customer's name/email/phone to pre-fill the
 * booking form, or null for every other case (first-time booker, unverified/
 * invalid token, staff not LINE-enabled, staff not found/inactive, no
 * matching Customer row, or any unexpected error) - the caller never learns
 * WHY there's no pre-fill, only that there isn't one, so the form just shows
 * blank fields exactly as it always has.
 *
 * Deliberately resolves staffId server-side from bookingSlug only (same
 * pattern as getStaffBookingPageData above) and derives lineUserId only from
 * verifyLineIdToken's own verification of lineIdToken - never from any
 * client-supplied identifier. Customer lookup is scoped by
 * (ownerStaffId, lineUserId) together via the @@unique compound key, so one
 * staff's LINE customer can never surface another staff's data.
 */
export async function getLineCustomerPrefill(
  bookingSlug: string,
  lineIdToken: string,
): Promise<{ name: string; email: string; phone: string } | null> {
  if (!bookingSlug || !lineIdToken) return null;

  const perfDebug = process.env.RESERVATION_PERF_DEBUG === "1";
  const perfStart = perfDebug ? performance.now() : 0;

  try {
    const staff = await resolveStaffByBookingSlug(bookingSlug);
    if (!staff || !staff.active) return null;

    if (!isLineNotificationEnabledForStaff(staff.id)) return null;

    const verified = await verifyLineIdToken(lineIdToken);
    if (!verified.ok) return null;

    const dbStart = perfDebug ? performance.now() : 0;
    const customer = await prisma.customer.findUnique({
      where: { ownerStaffId_lineUserId: { ownerStaffId: staff.id, lineUserId: verified.lineUserId } },
      select: { name: true, email: true, phone: true },
    });
    if (perfDebug) console.log(`[perf:db:customer] ${(performance.now() - dbStart).toFixed(1)}ms found=${!!customer}`);
    if (!customer) return null;

    return { name: customer.name, email: customer.email, phone: customer.phone };
  } catch {
    // Never surface a failure here as anything but "no prefill". A fixed,
    // PII-free message only - no token/email/phone/lineUserId/DB value/error
    // object, since a caught error's own message could echo one of those.
    console.warn("[LINE_CUSTOMER_PREFILL_FAILED]");
    return null;
  } finally {
    if (perfDebug) console.log(`[perf:prefill] total ${(performance.now() - perfStart).toFixed(1)}ms`);
  }
}
