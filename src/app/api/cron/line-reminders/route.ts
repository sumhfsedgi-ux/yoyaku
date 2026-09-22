import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { SALON_TIME_ZONE } from "@/lib/availability/types";
import { claimAndSendLineNotification } from "@/lib/reservations/lineNotifications";
import { getLineReminderBodyForSending } from "@/lib/line/lineTemplateSettings";
import { buildReservationEmailVariables, renderReservationEmailTemplate } from "@/lib/email/reservationEmailTemplate";

/**
 * Vercel Cron target for the day-before LINE reminder (plan §15). Scheduled
 * in vercel.json as "0 10 * * *" (10:00 UTC = 19:00 JST, Japan has no DST so
 * this offset never changes) - but see the Vercel Hobby precision note
 * below, the actual invocation time is not exact.
 *
 * Auth mirrors the same Authorization: Bearer <CRON_SECRET> convention used
 * elsewhere for Vercel Cron-only routes - this handler rejects any request
 * that doesn't present that exact value, since this path is otherwise a
 * publicly reachable URL under /api.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const mode = process.env.LINE_NOTIFICATION_MODE ?? "off";

  // Defense in depth alongside claimAndSendLineNotification's own guard (plan
  // §17 "dual guard") - when disabled, this Cron does not even query for
  // candidates, so removing the vercel.json schedule entry is not the only
  // way to stop it.
  if (mode === "off") {
    return NextResponse.json({ mode, checked: 0, sent: 0, failed: 0 });
  }

  // Phase 1 staff scope (see lib/line/staffGate.ts): without a configured
  // target staff there is no possible candidate - refuse to guess, same
  // reasoning as the missing-LINE_TEST_USER_ID case below. This is guard 1
  // of the staff restriction (a query-time filter, see below); guard 2 is
  // claimAndSendLineNotification's own DB-derived re-check at send time.
  const enabledStaffId = process.env.LINE_ENABLED_STAFF_ID;
  if (!enabledStaffId) {
    return NextResponse.json({ mode, checked: 0, sent: 0, failed: 0, note: "LINE_ENABLED_STAFF_ID not configured" });
  }

  const testUserId = process.env.LINE_TEST_USER_ID;
  if (mode === "test" && !testUserId) {
    // Refuse to guess: without a configured test recipient there is no safe
    // target in test mode - never fall back to "everyone" (plan §5/§17).
    return NextResponse.json({ mode, checked: 0, sent: 0, failed: 0, note: "LINE_TEST_USER_ID not configured" });
  }

  // "Tomorrow" is always computed relative to Asia/Tokyo, never the server's
  // local/UTC clock (plan §13/§15) - this is what actually determines which
  // reservations are eligible, independent of the Cron's own (imprecise on
  // Vercel Hobby - "19時台", not exactly 19:00) invocation time.
  const tomorrowStartJst = DateTime.now().setZone(SALON_TIME_ZONE).plus({ days: 1 }).startOf("day");
  const rangeStart = tomorrowStartJst.toJSDate();
  const rangeEnd = tomorrowStartJst.plus({ days: 1 }).toJSDate();

  const reservations = await prisma.reservation.findMany({
    where: {
      status: "CONFIRMED",
      staffId: enabledStaffId,
      startAt: { gte: rangeStart, lt: rangeEnd },
      customer: { lineUserId: mode === "test" ? testUserId : { not: null } },
      // Prisma relation filter for "no ReservationNotification row of this
      // type exists yet" - the DB-level dedupe key itself (plan §10/§14) is
      // still the @@unique([reservationId, type]) constraint enforced inside
      // claimAndSendLineNotification; this filter is only an optimization so
      // an already-sent/claimed reservation isn't re-attempted every run.
      notifications: { none: { type: "LINE_REMINDER" } },
    },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      customerNameSnapshot: true,
      customer: { select: { lineUserId: true, name: true } },
      staff: { select: { salonName: true } },
    },
  });

  const bodyTemplate = await getLineReminderBodyForSending();

  let sent = 0;
  let failed = 0;
  for (const reservation of reservations) {
    const lineUserId = reservation.customer.lineUserId;
    if (!lineUserId) continue; // narrows the type; the query already guarantees this

    const text = renderReservationEmailTemplate(
      bodyTemplate,
      buildReservationEmailVariables({
        customerName: reservation.customerNameSnapshot ?? reservation.customer.name,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        salonName: reservation.staff.salonName,
      }),
    );

    const result = await claimAndSendLineNotification({
      reservationId: reservation.id,
      type: "LINE_REMINDER",
      lineUserId,
      text,
    }).catch((err) => {
      console.error(`line reminder failed for reservation ${reservation.id}`, err);
      return { ok: false as const, reason: "SEND_FAILED" as const };
    });

    if (result.ok) sent += 1;
    else if (result.reason === "SEND_FAILED") failed += 1;
    // ALREADY_CLAIMED / MODE_* results are neither a send nor a failure -
    // they're an expected skip (a concurrent run already claimed it, or mode
    // filtering excluded it), so they are not counted at all.
  }

  return NextResponse.json({ mode, checked: reservations.length, sent, failed });
}
