import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db/prisma";
import { validateSlotBookable } from "@/lib/availability/engine";
import { prismaAvailabilityDeps } from "@/lib/availability/data";
import { SERVICE_DURATION_MINUTES } from "@/lib/availability/types";
import { getOccupiedRange } from "@/lib/availability/rules";
import { getCalendarService } from "@/lib/google/calendar/factory";
import { getGmailService } from "@/lib/google/gmail/factory";
import { resolveRoomCalendarId } from "@/lib/google/roomCalendar";
import { buildCustomerConfirmationEmail, buildStaffNotificationEmail } from "@/lib/google/gmail/templates";
import { getReservationConfirmationBodyForSending } from "@/lib/email/emailTemplateSettings";
import { buildReservationEmailVariables, renderReservationEmailTemplate } from "@/lib/email/reservationEmailTemplate";
import { verifyLineIdToken } from "@/lib/line/identity";
import { isLineNotificationEnabledForStaff } from "@/lib/line/staffGate";
import { getStaffNotificationRecipientIds } from "@/lib/line/staffRecipients";
import { DEFAULT_STAFF_NEW_RESERVATION_MESSAGE } from "@/lib/line/lineTemplate";
import { createReservationInputSchema, rescheduleReservationInputSchema } from "@/lib/validation/schemas";
import { normalizePhoneDigits } from "@/lib/customers/normalize";
import { isExclusionConstraintViolation, isUniqueConstraintViolation } from "./errors";
import { claimAndSendLineNotification, resetLineReminderClaim } from "./lineNotifications";

const SERVICE_DURATION_MS = SERVICE_DURATION_MINUTES * 60 * 1000;

/**
 * Decides the lineUserId value (if any) to write on the Customer row matched
 * by (ownerStaffId, email) during the booking upsert - see createReservation.
 * Returns undefined when the field should be left untouched (no verified
 * LINE identity, or a conflict that must not overwrite an existing link).
 *
 * Conflict rules (plan §12, never overwrite, never fail the booking):
 *  - This customer (by email) has no lineUserId yet -> set it.
 *  - This customer already has exactly this lineUserId -> no-op (harmless to re-set).
 *  - This customer already has a DIFFERENT lineUserId -> leave it, skip.
 *  - A DIFFERENT customer row under this same staff already owns this
 *    lineUserId (e.g. the same LINE user previously booked under another
 *    email) -> skip, never merge two Customer rows.
 *
 * This is a best-effort pre-check only - it cannot fully close a race
 * between two concurrent requests. The caller must additionally catch a
 * unique-constraint violation on the actual write and retry without
 * lineUserId (see isUniqueConstraintViolation) so the reservation itself
 * never fails because of this.
 */
async function resolveLineUserIdForCustomerUpsert(
  tx: Prisma.TransactionClient,
  ownerStaffId: string,
  email: string,
  verifiedLineUserId: string,
): Promise<string | undefined> {
  const [existingByEmail, existingByLineUserId] = await Promise.all([
    tx.customer.findUnique({ where: { ownerStaffId_email: { ownerStaffId, email } }, select: { lineUserId: true } }),
    tx.customer.findFirst({ where: { ownerStaffId, lineUserId: verifiedLineUserId }, select: { email: true } }),
  ]);

  if (existingByLineUserId && existingByLineUserId.email !== email) return undefined;
  if (existingByEmail?.lineUserId && existingByEmail.lineUserId !== verifiedLineUserId) return undefined;
  return verifiedLineUserId;
}

export interface CreateReservationInput {
  staffId: string;
  startAtUtcIso: string;
  source: "CUSTOMER_ONLINE" | "STAFF_MANUAL";
  createdByStaffId?: string;
  /** New-customer path (unchanged). Exactly one of `customer`/`customerId` must be set. */
  customer?: { name: string; email: string; phone: string };
  /** Existing-customer path: an id already owned by `staffId` - never mutated, never upserted. */
  customerId?: string;
  /** Only used alongside customerId - overrides this reservation's contact snapshot without touching the Customer master row. */
  contactOverride?: { name: string; email: string; phone: string };
  /** Honeypot - must be empty. A non-empty value silently no-ops the booking. */
  website?: string;
  /**
   * Raw LIFF/LINE Login ID Token from the /reserve/liff entry point - NEVER a
   * lineUserId string itself (see lib/line/identity.ts's verifyLineIdToken,
   * the only place a trusted userId is derived from this). Only meaningful
   * alongside `customer` (the plain `/reserve/[slug]` link never carries
   * one). A missing/invalid token silently proceeds with no LINE identity -
   * it never fails the booking.
   */
  lineIdToken?: string;
}

export type CreateReservationResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "SLOT_UNAVAILABLE" }
  | { ok: false; reason: "CALENDAR_UNAVAILABLE" }
  | { ok: false; reason: "CONCURRENT_BOOKING" }
  | { ok: false; reason: "STAFF_NOT_FOUND" | "STAFF_INACTIVE" | "ROOM_NOT_FOUND" }
  | { ok: false; reason: "CUSTOMER_NOT_FOUND" }
  | { ok: false; reason: "VALIDATION_ERROR" };

/**
 * Best-effort Calendar sync + Gmail notifications after a reservation is
 * committed to the DB. Never throws and never affects the caller's result -
 * Calendar/Gmail are explicitly NOT in the critical path of the booking
 * response (see plan §5/§23). Failures are recorded on the reservation row
 * (googleSyncStatus) so staff can see and manually resync later.
 *
 * Pushes the BUFFERED occupied window (actual service time ±15min), not the
 * raw reservation.startAt/endAt, so a staff member looking directly at Google
 * Calendar sees the setup/cleanup buffer visually blocked too - see
 * getOccupiedRange. rescheduleReservation's self-exclusion filter must stay
 * in sync with this (compares against the same buffered window).
 */
async function syncReservationToCalendarBestEffort(reservationId: string): Promise<void> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { staff: true },
  });
  if (!reservation) return;

  const calendarId = await resolveRoomCalendarId(reservation.roomId);
  if (!calendarId) {
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { googleSyncStatus: "FAILED", googleSyncError: "part not configured for this room" },
    });
    return;
  }

  const { occupiedStart, occupiedEnd } = getOccupiedRange(reservation.startAt, reservation.endAt);

  const calendarService = getCalendarService();
  const result = reservation.googleEventId
    ? await calendarService.updateEvent(calendarId, reservation.googleEventId, {
        staffDisplayName: reservation.staff.displayName,
        startAt: occupiedStart,
        endAt: occupiedEnd,
      })
    : await calendarService.createEvent(calendarId, {
        reservationId: reservation.id,
        staffDisplayName: reservation.staff.displayName,
        startAt: occupiedStart,
        endAt: occupiedEnd,
      });

  if (result.ok) {
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { googleEventId: result.googleEventId, googleSyncStatus: "SYNCED", googleSyncError: null },
    });
  } else {
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { googleSyncStatus: "FAILED", googleSyncError: result.error.slice(0, 500) },
    });
  }
}

async function sendBookingNotificationsBestEffort(reservationId: string): Promise<void> {
  const [reservation, bodyTemplate] = await Promise.all([
    prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { staff: true, customer: true },
    }),
    getReservationConfirmationBodyForSending(),
  ]);
  if (!reservation) return;

  // Prefer this reservation's own contact snapshot over the (possibly since-
  // edited, or deliberately reservation-only-overridden) Customer master row -
  // see CreateReservationInput.contactOverride. Falls back to the live
  // customer relation for reservations created before these columns existed.
  const contact = {
    name: reservation.customerNameSnapshot ?? reservation.customer.name,
    email: reservation.customerEmailSnapshot ?? reservation.customer.email,
    phone: reservation.customerPhoneSnapshot ?? reservation.customer.phone,
  };

  // Single shared confirmation body/variables: the same {{tag}} template is
  // sent as-is to Gmail (customer email) below AND, for LINE-linked
  // customers, rendered again as the LINE push text further down - one text
  // for staff to maintain in Settings, not two copies that can drift apart
  // (see LineTemplateSettings's schema doc comment).
  const confirmationVariables = buildReservationEmailVariables({
    customerName: contact.name,
    startAt: reservation.startAt,
    endAt: reservation.endAt,
    salonName: reservation.staff.salonName,
  });

  const gmail = getGmailService();

  // Each send is independent: a failure sending the customer's confirmation
  // must not also suppress the staff notification (and vice versa) - unlike
  // Calendar sync, there is no persisted status for these, so a failure here
  // is only ever visible in server logs.
  await gmail
    .sendEmail(buildCustomerConfirmationEmail({ to: contact.email, bodyTemplate, variables: confirmationVariables }))
    .catch((err) => console.error(`booking notification: customer confirmation email failed for reservation ${reservationId}`, err));

  await gmail
    .sendEmail(
      buildStaffNotificationEmail({
        to: reservation.staff.loginEmail,
        staffDisplayName: reservation.staff.displayName,
        customerName: contact.name,
        customerEmail: contact.email,
        customerPhone: contact.phone,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
      }),
    )
    .catch((err) => console.error(`booking notification: staff notification email failed for reservation ${reservationId}`, err));

  // LINE confirmation - purely additive alongside Gmail above, never in place
  // of it (see plan §2/§28): a customer with no linked LINE account is simply
  // skipped here and only ever receives the Gmail confirmation. Uses the
  // SAME bodyTemplate/confirmationVariables as the Gmail send above (see
  // comment further up) - not a separately-edited LINE-only body. Awaited
  // (not fire-and-forget) for the same reason Gmail is awaited - a Vercel
  // function can be frozen once the response is sent (plan §23/§29). Never
  // throws - claimAndSendLineNotification's own off/test-mode gating and DB
  // claim guarantee this can never double-send or affect the booking result.
  if (reservation.customer.lineUserId) {
    await claimAndSendLineNotification({
      reservationId,
      type: "LINE_CONFIRMATION",
      lineUserId: reservation.customer.lineUserId,
      text: renderReservationEmailTemplate(bodyTemplate, confirmationVariables),
    }).catch((err) => console.error(`booking notification: line confirmation failed for reservation ${reservationId}`, err));
  }

  // Staff push notifications - entirely independent of the customer LINE
  // confirmation above (sent even when this customer has no linked LINE
  // account at all - plan §6). Outer gate, checked BEFORE doing any work:
  // only a CUSTOMER_ONLINE reservation (never a STAFF_MANUAL one a staff
  // member entered themselves from the admin screen - plan §3) for
  // LINE_ENABLED_STAFF_ID even enters this block at all. This is in ADDITION
  // to (not instead of) claimAndSendLineNotification's own internal
  // isLineNotificationEnabledForStaff check below (guard 0 there) - that
  // inner check stays as defense in depth against a future direct call to
  // claimAndSendLineNotification that skips this outer gate; this outer gate
  // exists so a non-enabled staff's booking never even attempts the
  // per-recipient claim/send loop in the first place.
  if (reservation.source === "CUSTOMER_ONLINE" && isLineNotificationEnabledForStaff(reservation.staffId)) {
    const staffRecipientIds = getStaffNotificationRecipientIds();
    if (staffRecipientIds.length > 0) {
      const staffNotificationText = renderReservationEmailTemplate(DEFAULT_STAFF_NEW_RESERVATION_MESSAGE, confirmationVariables);
      const results = await Promise.allSettled(
        staffRecipientIds.map((lineUserId) =>
          claimAndSendLineNotification({ reservationId, type: "STAFF_NEW_RESERVATION", lineUserId, text: staffNotificationText }),
        ),
      );
      // Each recipient is independent (plan §12/§23): one succeeding never
      // undoes another's success, and a failure here never touches the
      // booking result. Only a genuine send failure (SEND_FAILED) or an
      // unexpected rejection (claimAndSendLineNotification is documented to
      // never throw, so this would itself be a bug) counts as a "problem" to
      // log - STAFF_NOT_ENABLED/MODE_OFF/MODE_TEST_NON_TEST_RECIPIENT/
      // ALREADY_CLAIMED are all expected, silent no-ops (plan §5), not
      // errors. Never logs userId/customerName/message text (plan §24).
      const problems = results.filter(
        (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok && r.value.reason === "SEND_FAILED"),
      );
      if (problems.length > 0) {
        console.error(
          `booking notification: staff push failed for ${problems.length}/${staffRecipientIds.length} recipient(s), reservation ${reservationId}`,
        );
      }
    }
  }
}

export async function createReservation(rawInput: CreateReservationInput): Promise<CreateReservationResult> {
  const parsed = createReservationInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, reason: "VALIDATION_ERROR" };
  const input = parsed.data;

  // Honeypot: a bot that fills in the hidden field gets a generic failure with
  // no hint that it was detected - see components/reserve/HoneypotField.tsx.
  if (input.website) return { ok: false, reason: "VALIDATION_ERROR" };

  // Existing-customer path: resolve + verify ownership BEFORE opening the
  // transaction (Customers are never deleted in this app, so there is no
  // TOCTOU window worth protecting against). "Not found" and "not mine" are
  // deliberately collapsed into one reason so a forged customerId from
  // another staff member can't be distinguished from a typo/stale id.
  let existingCustomer: { id: string; name: string; email: string; phone: string } | null = null;
  if (input.customerId) {
    const found = await prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true, ownerStaffId: true, name: true, email: true, phone: true },
    });
    if (!found || found.ownerStaffId !== input.staffId) return { ok: false, reason: "CUSTOMER_NOT_FOUND" };
    existingCustomer = found;
  }

  const validation = await validateSlotBookable(
    { staffId: input.staffId, startAtUtcIso: input.startAtUtcIso },
    prismaAvailabilityDeps,
  );
  if (!validation.ok) {
    if (validation.reason === "CALENDAR_UNAVAILABLE") return { ok: false, reason: "CALENDAR_UNAVAILABLE" };
    if (validation.reason === "STAFF_NOT_FOUND" || validation.reason === "STAFF_INACTIVE" || validation.reason === "ROOM_NOT_FOUND") {
      return { ok: false, reason: validation.reason };
    }
    return { ok: false, reason: "SLOT_UNAVAILABLE" };
  }

  const roomId = await prismaAvailabilityDeps.resolvePrimaryRoomId();
  if (!roomId) return { ok: false, reason: "ROOM_NOT_FOUND" };

  const startAt = new Date(input.startAtUtcIso);
  const endAt = new Date(startAt.getTime() + SERVICE_DURATION_MS);

  // The reservation's contact snapshot: an explicit override, else whatever
  // customer record is actually being used (existing or freshly upserted).
  const snapshot = input.customerId ? (input.contactOverride ?? existingCustomer!) : input.customer!;

  // LINE identity verification happens here, BEFORE the DB transaction (it is
  // a network call to LINE's own verify endpoint - see lib/line/identity.ts -
  // and must never hold a transaction open while waiting on it). A missing or
  // failed verification silently proceeds with no LINE identity - it must
  // never fail the reservation itself (plan §6/§10). Only meaningful on the
  // new/returning-customer upsert path (input.customer) - the staff-picked
  // existing-customer path (customerId) never accepts a lineIdToken at all.
  //
  // Phase 1 staff scope: LINE is restricted to exactly one staff member (see
  // lib/line/staffGate.ts). `input.staffId` is never trusted directly for
  // this decision - by this point it has already been re-confirmed to name a
  // real, active Staff row via validateSlotBookable above, but the gate below
  // re-derives it from an explicit DB read rather than reusing the raw input
  // value, so the LINE-enabled decision is always made from a value the
  // server just confirmed exists, not from whatever the caller passed in.
  // For every other staff, verifyLineIdToken is never even called - no
  // Customer.lineUserId can be newly acquired for them.
  let verifiedLineUserId: string | undefined;
  let confirmedStaffId: string | undefined;
  if (!input.customerId && input.lineIdToken) {
    const confirmedStaff = await prisma.staff.findUnique({ where: { id: input.staffId }, select: { id: true } });
    if (confirmedStaff && isLineNotificationEnabledForStaff(confirmedStaff.id)) {
      confirmedStaffId = confirmedStaff.id;
      const verified = await verifyLineIdToken(input.lineIdToken);
      if (verified.ok) verifiedLineUserId = verified.lineUserId;
    }
  }

  let reservationId: string;
  try {
    reservationId = await prisma.$transaction(async (tx) => {
      let customer: { id: string; name: string; email: string; phone: string };
      if (input.customerId) {
        customer = existingCustomer!;
      } else {
        // IMPORTANT: `update` here must never include firstVisitDate/
        // firstVisitAcquisitionSourceId. This upsert runs on EVERY booking by
        // a returning customer (online and manual), so touching those fields
        // here would silently overwrite/erase the customer chart's
        // first-visit data on the customer's 2nd+ booking. Chart-side
        // first-visit recording lives entirely in actions/visitRecords.ts's
        // createMyVisitRecord.
        const baseUpdateData = { name: input.customer!.name, phone: input.customer!.phone, phoneDigits: normalizePhoneDigits(input.customer!.phone) };
        const baseCreateData = {
          ownerStaffId: input.staffId,
          name: input.customer!.name,
          email: input.customer!.email,
          phone: input.customer!.phone,
          phoneDigits: normalizePhoneDigits(input.customer!.phone),
        };

        // A verified LINE identity always takes priority over the submitted
        // email for finding "who is this" - the email field can be freely
        // edited (e.g. after LINE prefill autofills a returning customer's
        // last-known email), and editing it must never fork a second
        // Customer row for a LINE user who already has one under this staff,
        // nor drop their existing LINE link. confirmedStaffId (not the raw
        // input.staffId) is used here since it's the value the block above
        // already re-derived from the DB before trusting it for LINE
        // decisions; it is always set whenever verifiedLineUserId is.
        const existingByLineUserId = verifiedLineUserId
          ? await tx.customer.findUnique({
              where: { ownerStaffId_lineUserId: { ownerStaffId: confirmedStaffId!, lineUserId: verifiedLineUserId } },
              select: { id: true },
            })
          : null;

        if (existingByLineUserId) {
          // Pre-check whether the submitted email already belongs to a
          // DIFFERENT Customer row under this staff, rather than attempting
          // the update and catching a failure: Postgres aborts the whole
          // transaction after any failed statement, so a second query on the
          // same tx after a unique-constraint error would only ever surface
          // "current transaction is aborted" (25P02), never let a clean retry
          // actually succeed - unlike resolveLineUserIdForCustomerUpsert's
          // similar pre-check below, this one isn't just an optimization.
          const emailOwner = await tx.customer.findUnique({
            where: { ownerStaffId_email: { ownerStaffId: confirmedStaffId!, email: input.customer!.email } },
            select: { id: true },
          });
          const emailCollidesWithAnotherCustomer = emailOwner !== null && emailOwner.id !== existingByLineUserId.id;

          // On a collision, never fail the booking or merge into that other
          // row - keep this customer's existing email and only update name/
          // phone. The confirmation email/LINE message still go to the
          // submitted email regardless, since sendBookingNotificationsBestEffort
          // prefers the reservation's own contact snapshot (set below from
          // input.customer, always the submitted values) over the live
          // Customer row.
          customer = await tx.customer.update({
            where: { id: existingByLineUserId.id },
            data: emailCollidesWithAnotherCustomer ? baseUpdateData : { ...baseUpdateData, email: input.customer!.email },
          });
        } else {
          const resolvedLineUserId = verifiedLineUserId
            ? await resolveLineUserIdForCustomerUpsert(tx, input.staffId, input.customer!.email, verifiedLineUserId)
            : undefined;

          const upsertCustomer = (lineUserIdToSet: string | undefined) =>
            tx.customer.upsert({
              where: { ownerStaffId_email: { ownerStaffId: input.staffId, email: input.customer!.email } },
              update: lineUserIdToSet !== undefined ? { ...baseUpdateData, lineUserId: lineUserIdToSet } : baseUpdateData,
              create: lineUserIdToSet !== undefined ? { ...baseCreateData, lineUserId: lineUserIdToSet } : baseCreateData,
            });

          try {
            customer = await upsertCustomer(resolvedLineUserId);
          } catch (err) {
            // A race with another concurrent request slipped past
            // resolveLineUserIdForCustomerUpsert's pre-check (e.g. two bookings
            // by the same LINE user under different emails, at the same
            // instant) and hit the @@unique([ownerStaffId, lineUserId])
            // constraint. Retry without lineUserId so the reservation itself
            // always succeeds - a LINE-linking conflict must never fail a
            // booking (plan §12).
            if (resolvedLineUserId !== undefined && isUniqueConstraintViolation(err)) {
              customer = await upsertCustomer(undefined);
            } else {
              throw err;
            }
          }
        }
      }

      const reservation = await tx.reservation.create({
        data: {
          roomId,
          staffId: input.staffId,
          customerId: customer.id,
          startAt,
          endAt,
          status: "CONFIRMED",
          source: input.source,
          createdByStaffId: input.createdByStaffId,
          googleSyncStatus: "PENDING",
          customerNameSnapshot: snapshot.name,
          customerEmailSnapshot: snapshot.email,
          customerPhoneSnapshot: snapshot.phone,
        },
      });
      return reservation.id;
    });
  } catch (err) {
    if (isExclusionConstraintViolation(err)) return { ok: false, reason: "CONCURRENT_BOOKING" };
    throw err;
  }

  // Best-effort, deliberately not awaited-and-thrown: Calendar/Gmail failures
  // must not turn a successful booking into an error response.
  await syncReservationToCalendarBestEffort(reservationId).catch((err) => console.error(`calendar sync failed for reservation ${reservationId}`, err));
  await sendBookingNotificationsBestEffort(reservationId).catch((err) => console.error(`booking notifications failed for reservation ${reservationId}`, err));

  return { ok: true, reservationId };
}

export interface RescheduleReservationInput {
  reservationId: string;
  newStartAtUtcIso: string;
}

export type RescheduleReservationResult =
  | { ok: true }
  | { ok: false; reason: "NOT_FOUND" | "ALREADY_CANCELLED" }
  | { ok: false; reason: "SLOT_UNAVAILABLE" }
  | { ok: false; reason: "CALENDAR_UNAVAILABLE" }
  | { ok: false; reason: "CONCURRENT_BOOKING" }
  | { ok: false; reason: "VALIDATION_ERROR" };

export async function rescheduleReservation(rawInput: RescheduleReservationInput): Promise<RescheduleReservationResult> {
  const parsed = rescheduleReservationInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, reason: "VALIDATION_ERROR" };
  const input = parsed.data;

  const existing = await prisma.reservation.findUnique({ where: { id: input.reservationId } });
  if (!existing) return { ok: false, reason: "NOT_FOUND" };
  if (existing.status !== "CONFIRMED") return { ok: false, reason: "ALREADY_CANCELLED" };

  // The reservation's own Google event is synced at its BUFFERED occupied
  // window (see syncReservationToCalendarBestEffort), not its raw actual
  // startAt/endAt - so the self-exclusion filter here must match that same
  // buffered window, or a reschedule landing near the old time would falsely
  // read its own still-existing Calendar event back as CALENDAR_BUSY.
  const existingOccupied = getOccupiedRange(existing.startAt, existing.endAt);

  const validation = await validateSlotBookable(
    {
      staffId: existing.staffId,
      startAtUtcIso: input.newStartAtUtcIso,
      excludeReservationId: existing.id,
      excludeCalendarBusyInterval: { start: existingOccupied.occupiedStart, end: existingOccupied.occupiedEnd },
    },
    prismaAvailabilityDeps,
  );
  if (!validation.ok) {
    if (validation.reason === "CALENDAR_UNAVAILABLE") return { ok: false, reason: "CALENDAR_UNAVAILABLE" };
    return { ok: false, reason: "SLOT_UNAVAILABLE" };
  }

  const newStartAt = new Date(input.newStartAtUtcIso);
  const newEndAt = new Date(newStartAt.getTime() + SERVICE_DURATION_MS);

  try {
    await prisma.reservation.update({
      where: { id: existing.id },
      data: {
        startAt: newStartAt,
        endAt: newEndAt,
        rescheduledFromStartAt: existing.startAt,
        googleSyncStatus: "PENDING",
      },
    });
  } catch (err) {
    if (isExclusionConstraintViolation(err)) return { ok: false, reason: "CONCURRENT_BOOKING" };
    throw err;
  }

  await syncReservationToCalendarBestEffort(existing.id).catch((err) => console.error(`calendar sync failed for reservation ${existing.id}`, err));

  // Reset LINE_REMINDER eligibility to the new date (plan §12/§16): reminder
  // eligibility is always computed from the reservation's CURRENT startAt, so
  // deleting any prior claim/send row is enough for it to become eligible
  // again at the new day-before-19:00 window - no date-comparison logic
  // needed. LINE_CONFIRMATION is deliberately never reset here - Phase 1 does
  // not resend a confirmation on reschedule. Best-effort, same as the
  // Calendar resync above - never affects the reschedule result.
  await resetLineReminderClaim(existing.id).catch((err) => console.error(`line reminder reset failed for reservation ${existing.id}`, err));

  return { ok: true };
}

export type CancelReservationResult = { ok: true } | { ok: false; reason: "NOT_FOUND" | "ALREADY_CANCELLED" };

/**
 * Best-effort Calendar event deletion after a reservation is cancelled.
 * Mirrors syncReservationToCalendarBestEffort's failure handling so a delete
 * that fails (Google unreachable, event already gone, etc.) is recorded on
 * the reservation row (googleSyncStatus/googleSyncError) instead of being
 * silently discarded - DB cancellation state is unaffected either way, but
 * staff can now see the error badge and retry via
 * resyncReservationCalendarEvent instead of a stale event lingering on the
 * calendar unnoticed. Never throws.
 */
async function deleteCalendarEventBestEffort(reservationId: string, googleEventId: string | null, roomId: string): Promise<void> {
  if (!googleEventId) return;

  const calendarId = await resolveRoomCalendarId(roomId);
  if (!calendarId) return;

  const result = await getCalendarService().deleteEvent(calendarId, googleEventId);

  if (result.ok) {
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { googleEventId: null, googleSyncStatus: "SYNCED", googleSyncError: null },
    });
  } else {
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { googleSyncStatus: "FAILED", googleSyncError: result.error.slice(0, 500) },
    });
  }
}

export async function cancelReservation(reservationId: string, cancelledByStaffId: string): Promise<CancelReservationResult> {
  const existing = await prisma.reservation.findUnique({ where: { id: reservationId } });
  if (!existing) return { ok: false, reason: "NOT_FOUND" };
  if (existing.status !== "CONFIRMED") return { ok: false, reason: "ALREADY_CANCELLED" };

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByStaffId },
  });

  await deleteCalendarEventBestEffort(reservationId, existing.googleEventId, existing.roomId).catch((err) =>
    console.error(`calendar delete failed for reservation ${reservationId}`, err),
  );

  return { ok: true };
}

/**
 * Manual retry for a reservation whose Calendar sync previously failed
 * (googleSyncStatus = FAILED) - for a still-CONFIRMED reservation this retries
 * the create/update, for a CANCELLED one it retries the event deletion.
 * Staff-triggered in Phase 1; a future background job would call this same
 * function across all FAILED rows.
 */
export async function resyncReservationCalendarEvent(reservationId: string): Promise<{ ok: true } | { ok: false; reason: "NOT_FOUND" }> {
  const existing = await prisma.reservation.findUnique({ where: { id: reservationId } });
  if (!existing) return { ok: false, reason: "NOT_FOUND" };

  if (existing.status === "CANCELLED") {
    await deleteCalendarEventBestEffort(reservationId, existing.googleEventId, existing.roomId);
  } else {
    await syncReservationToCalendarBestEffort(reservationId);
  }

  return { ok: true };
}
