"use server";

import { randomUUID } from "crypto";
import { DateTime } from "luxon";
import { resolveStaffByBookingSlug } from "@/lib/reservations/staffLookup";
import { getAvailableSlotRangeStatus } from "@/actions/availability";
import { SALON_TIME_ZONE } from "@/lib/availability/types";
import { isLineNotificationEnabledForStaff } from "@/lib/line/staffGate";
import { verifyLineIdToken } from "@/lib/line/identity";
import { prisma } from "@/lib/db/prisma";
import type { TwoWeekDayStatus } from "@/components/reserve/TwoWeekAvailabilityGrid";

// TEMPORARY (cold-start investigation, see .claude/plans): generated once per
// cold module load, then retained for as long as this container/isolate
// stays warm. Purely a debug aid to tell "the same container handled this
// call as the previous one" from "a fresh container was spun up" - never
// used for any behavior, never exposed outside RESERVATION_PERF_DEBUG-gated
// logs. Not PII, not a secret.
const PERF_INSTANCE_ID = randomUUID().slice(0, 8);
let bootstrapInvocationCount = 0;

export type GetLineBookingBootstrapResult =
  | {
      ok: true;
      bookingSlug: string;
      bookingWindowDays: number;
      salonName: string | null;
      todayISO: string;
      initialGridDays: TwoWeekDayStatus[];
      initialGridError: string | null;
      /** A returning LINE customer's name/email/phone to pre-fill the booking form, or null - see the module doc below for every case that yields null. */
      customerPrefill: { name: string; email: string; phone: string } | null;
      /**
       * TEMPORARY (perf investigation, see .claude/plans): true only when
       * RESERVATION_PERF_DEBUG=1 - this function only ever returns ok:true
       * for the LINE-enabled staff to begin with (see the staff-gate check
       * below), so no separate staff condition is needed here.
       */
      perfDebug: boolean;
      /** TEMPORARY (cold-start investigation, see .claude/plans): only present when perfDebug is true. */
      perf?: { correlationId: string };
    }
  | { ok: false; reason: "STAFF_NOT_FOUND" };

/**
 * The single Server Action app/reserve/liff/page.tsx calls, once a
 * client-side routing hint (NEXT_PUBLIC_LINE_ENABLED_BOOKING_SLUG - see
 * .claude/plans) has decided LIFF login is worth attempting for this slug
 * and a LIFF ID token is in hand. That client hint is a UI/routing
 * convenience ONLY, never a security boundary - this function independently
 * re-resolves staffId server-side from bookingSlug ONLY, from scratch, and
 * re-checks staff.active + isLineNotificationEnabledForStaff itself. A
 * tampered/stale client hint can at most cause an unnecessary LIFF login
 * attempt that this function then rejects; it can never grant access to
 * another staff's data.
 *
 * Also runs its two independent external waits - the availability grid's
 * Google Calendar FreeBusy call and the LINE ID token verification -
 * concurrently via Promise.all, since neither depends on the other's result
 * (see .claude/plans for the measured rationale).
 *
 * This is the only function allowed to produce a trusted lineUserId (via
 * verifyLineIdToken) and the only place Customer PII for this flow is read.
 *
 * Returns null customerPrefill for every case that isn't "a verified,
 * returning LINE customer with a matching Customer row": first-time booker,
 * unverified/invalid token, staff not found/inactive/not LINE-enabled, or
 * any unexpected error - the caller never learns which, so the form just
 * shows blank contact fields exactly as it always has.
 */
export async function getLineBookingBootstrap(
  bookingSlug: string,
  lineIdToken: string,
): Promise<GetLineBookingBootstrapResult> {
  const perfDebug = process.env.RESERVATION_PERF_DEBUG === "1";
  const correlationId = perfDebug ? randomUUID().slice(0, 8) : "";
  const invocation = perfDebug ? (bootstrapInvocationCount += 1) : 0;
  const tStart = perfDebug ? performance.now() : 0;

  try {
    const tStaffDbStart = perfDebug ? performance.now() : 0;
    const staff = await resolveStaffByBookingSlug(bookingSlug);
    if (perfDebug) {
      console.log(`[perf:bootstrap:${correlationId}] staffDb ${(performance.now() - tStaffDbStart).toFixed(1)}ms`);
    }
    if (!staff || !staff.active) return { ok: false, reason: "STAFF_NOT_FOUND" };
    if (!isLineNotificationEnabledForStaff(staff.id)) return { ok: false, reason: "STAFF_NOT_FOUND" };

    const todayISO = DateTime.now().setZone(SALON_TIME_ZONE).toISODate()!;

    // Each wrapped in its own IIFE purely to attach duration logging without
    // altering when the real call starts - an async function body runs
    // synchronously up to its first await, so both underlying calls still
    // start in the same tick as before; the Promise.all concurrency
    // guarantee (and its regression test) is unaffected.
    const availabilityPromise = (async () => {
      const t0 = perfDebug ? performance.now() : 0;
      const result = await getAvailableSlotRangeStatus(bookingSlug, todayISO);
      if (perfDebug) {
        console.log(`[perf:bootstrap:${correlationId}] availability ${(performance.now() - t0).toFixed(1)}ms ok=${result.ok}`);
      }
      return result;
    })();

    const verifyPromise = (async () => {
      const t0 = perfDebug ? performance.now() : 0;
      const result = await verifyLineIdToken(lineIdToken);
      if (perfDebug) {
        console.log(`[perf:bootstrap:${correlationId}] verify ${(performance.now() - t0).toFixed(1)}ms ok=${result.ok}`);
      }
      return result;
    })();

    const [initialGrid, verified] = await Promise.all([availabilityPromise, verifyPromise]);

    // Only the customer prefill lookup degrades gracefully to null on
    // failure - a LINE-linking issue must never break the booking flow. The
    // availability grid above is NOT wrapped this way - a genuine failure
    // there should propagate and show the error screen, since there is no
    // meaningful page without it.
    let customerPrefill: { name: string; email: string; phone: string } | null = null;
    if (verified.ok) {
      try {
        const dbStart = perfDebug ? performance.now() : 0;
        const customer = await prisma.customer.findUnique({
          where: { ownerStaffId_lineUserId: { ownerStaffId: staff.id, lineUserId: verified.lineUserId } },
          select: { name: true, email: true, phone: true },
        });
        if (perfDebug) {
          console.log(`[perf:bootstrap:${correlationId}] customerDb ${(performance.now() - dbStart).toFixed(1)}ms found=${!!customer}`);
        }
        if (customer) customerPrefill = { name: customer.name, email: customer.email, phone: customer.phone };
      } catch {
        // PII-free, fixed message only - never the token, DB value, or error object itself.
        console.warn("[LINE_CUSTOMER_PREFILL_FAILED]");
      }
    }

    return {
      ok: true,
      bookingSlug: staff.bookingSlug,
      bookingWindowDays: staff.bookingWindowDays,
      salonName: staff.salonName,
      todayISO,
      initialGridDays: initialGrid.ok ? initialGrid.days : [],
      initialGridError: initialGrid.ok ? null : (initialGrid.reason ?? "UNKNOWN"),
      customerPrefill,
      perfDebug,
      ...(perfDebug ? { perf: { correlationId } } : {}),
    };
  } finally {
    // TEMPORARY (cold-start investigation, see .claude/plans): duration-only,
    // no PII/bookingSlug/staffId. instance/invocation let us tell whether
    // this container had already served a prior request.
    if (perfDebug) {
      console.log(
        `[perf:bootstrap:${correlationId}] instance=${PERF_INSTANCE_ID} invocation=${invocation} total=${(performance.now() - tStart).toFixed(1)}`,
      );
    }
  }
}
