import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getLineMessagingService } from "@/lib/line/messaging/factory";
import { isLineNotificationEnabledForStaff } from "@/lib/line/staffGate";
import { isLineRecipientAllowedInCurrentMode } from "@/lib/line/staffRecipients";
import { isUniqueConstraintViolation } from "./errors";

export type LineNotificationType = "LINE_CONFIRMATION" | "LINE_REMINDER" | "STAFF_NEW_RESERVATION";

/**
 * "" for LINE_CONFIRMATION/LINE_REMINDER - these have exactly one possible
 * recipient (the reservation's own customer), so (reservationId, type) alone
 * already identifies "who" and this preserves their dedupe behavior exactly
 * as it was before recipientKey existed. STAFF_NEW_RESERVATION is the first
 * type with more than one simultaneous recipient per reservation, so it
 * needs a per-recipient key - a SHA-256 hash of the LINE userId rather than
 * the raw id itself, so ReservationNotification (a table other staff-facing
 * code already reads, see lib/reservations/queries.ts) never stores a staff
 * member's actual LINE identity. The hash is deterministic (same userId ->
 * same key every time), which is all the @@unique constraint needs to dedupe
 * correctly.
 */
function recipientKeyFor(type: LineNotificationType, lineUserId: string): string {
  if (type !== "STAFF_NEW_RESERVATION") return "";
  return createHash("sha256").update(lineUserId).digest("hex");
}

export type ClaimAndSendLineNotificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "RESERVATION_NOT_FOUND" | "STAFF_NOT_ENABLED" | "MODE_OFF" | "MODE_TEST_NON_TEST_RECIPIENT" | "ALREADY_CLAIMED" | "SEND_FAILED";
      error?: string;
    };

/**
 * The single shared entry point for sending a LINE push tied to a
 * Reservation, used by BOTH the post-booking confirmation best-effort call
 * (lib/reservations/service.ts) and the day-before reminder Cron
 * (app/api/cron/line-reminders/route.ts). All LINE-send behavior funnels
 * through here so there is exactly one place implementing:
 *
 *  1. Target selection guard (mode-based, BEFORE any ReservationNotification
 *     row is created - see plan §17 "dual guard", guard 1):
 *       - off: never claims, never sends. Returns immediately.
 *       - test: claims/sends ONLY when lineUserId is allowed under the
 *         current mode - see lib/line/staffRecipients.ts's
 *         isLineRecipientAllowedInCurrentMode, the single shared policy this
 *         guard and lib/line/messaging/real.ts's guard 2 both call (so
 *         LINE_TEST_USER_ID for customer sends and
 *         LINE_STAFF_NOTIFICATION_USER_IDS for STAFF_NEW_RESERVATION sends
 *         stay usable in test mode without duplicating that allow-list logic
 *         in two places). Every other recipient is skipped WITHOUT creating
 *         a row, so test runs never litter the table with FAILED rows for
 *         ordinary customers (plan §17/§5).
 *       - production: always proceeds to claim.
 *     LineMessagingService's real implementation independently re-checks the
 *     same mode as guard 2 (lib/line/messaging/real.ts) - this function does
 *     not rely on that alone.
 *
 *  2. DB-level dedupe/claim (plan §10/§14): a single atomic `create` against
 *     the @@unique([reservationId, type, recipientKey]) constraint on
 *     ReservationNotification. Exactly one concurrent caller's create
 *     succeeds (status: PENDING); every other caller (a Cron re-run, a race
 *     with a manual trigger, a second staff recipient under the same type,
 *     etc.) hits the unique-constraint violation and skips - never relies on
 *     an in-memory flag. See recipientKeyFor() above for what recipientKey
 *     actually is per type.
 *
 *  3. LINE Platform-level dedupe: a UUID `retryKey` is generated once at claim
 *     time and sent as X-Line-Retry-Key on every send attempt against this
 *     row, so even if this function were ever called again for the same row
 *     (a future manual resend - not built in Phase 1), the LINE Platform
 *     itself would refuse to deliver the message twice.
 *
 *  4. Never throws - all outcomes (skip, claim conflict, send success,
 *     send failure) resolve to a typed result. Booking/Cron callers must
 *     never let this affect their own success path.
 *
 *  0. Staff scope guard, checked BEFORE anything else: Phase 1 restricts
 *     LINE entirely to one staff member (see lib/line/staffGate.ts) -
 *     whoever owns the Messaging API/LINE Login/LIFF setup this app is
 *     configured against. This function deliberately does NOT accept a
 *     `staffId` parameter from the caller - trusting a caller-supplied value
 *     would let a bug (or a future careless call site) send LINE for the
 *     wrong staff. Instead it re-reads the Reservation's OWN staffId
 *     straight from the database by `reservationId` and gates on that - the
 *     only source of truth. This same DB read is what makes the Cron's
 *     staff restriction "double-guarded" for free: the Cron's own query
 *     filter is guard 1, this internal DB-derived check is guard 2, and
 *     callers never need to pass or duplicate the staffId check themselves.
 */
export async function claimAndSendLineNotification(params: {
  reservationId: string;
  type: LineNotificationType;
  lineUserId: string;
  text: string;
}): Promise<ClaimAndSendLineNotificationResult> {
  const reservation = await prisma.reservation.findUnique({ where: { id: params.reservationId }, select: { staffId: true } });
  if (!reservation) return { ok: false, reason: "RESERVATION_NOT_FOUND" };
  if (!isLineNotificationEnabledForStaff(reservation.staffId)) return { ok: false, reason: "STAFF_NOT_ENABLED" };

  const mode = process.env.LINE_NOTIFICATION_MODE ?? "off";
  if (mode === "off") return { ok: false, reason: "MODE_OFF" };
  if (!isLineRecipientAllowedInCurrentMode(params.lineUserId)) {
    return { ok: false, reason: "MODE_TEST_NON_TEST_RECIPIENT" };
  }

  const recipientKey = recipientKeyFor(params.type, params.lineUserId);

  const retryKey = randomUUID();
  try {
    await prisma.reservationNotification.create({
      data: { reservationId: params.reservationId, type: params.type, recipientKey, status: "PENDING", retryKey },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return { ok: false, reason: "ALREADY_CLAIMED" };
    throw err;
  }

  const result = await getLineMessagingService().pushMessage({ to: params.lineUserId, text: params.text, retryKey });

  if (result.ok) {
    await prisma.reservationNotification.update({
      where: { reservationId_type_recipientKey: { reservationId: params.reservationId, type: params.type, recipientKey } },
      data: { status: "SENT", sentAt: new Date() },
    });
    return { ok: true };
  }

  await prisma.reservationNotification.update({
    where: { reservationId_type_recipientKey: { reservationId: params.reservationId, type: params.type, recipientKey } },
    data: { status: "FAILED", errorMessage: result.error.slice(0, 500) },
  });
  return { ok: false, reason: "SEND_FAILED", error: result.error };
}

/**
 * Resets a reservation's LINE_REMINDER claim so a reschedule to a different
 * day becomes eligible for a fresh reminder at its new date (plan §12/§16).
 * Only ever removes LINE_REMINDER rows - LINE_CONFIRMATION is never reset by
 * a reschedule (Phase 1 does not resend a confirmation on change). Best
 * effort, same as the Calendar resync call sitting alongside it in
 * rescheduleReservation - never throws outward.
 *
 * Same staff-scope discipline as claimAndSendLineNotification above: reads
 * the reservation's own staffId from the database rather than accepting one
 * from the caller. For a non-enabled staff no LINE_REMINDER row could ever
 * have been created in the first place, so this is a no-op for them either way.
 */
export async function resetLineReminderClaim(reservationId: string): Promise<void> {
  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { staffId: true } });
  if (!reservation || !isLineNotificationEnabledForStaff(reservation.staffId)) return;
  await prisma.reservationNotification.deleteMany({ where: { reservationId, type: "LINE_REMINDER" } });
}
