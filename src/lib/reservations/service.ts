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
import { buildReservationEmailVariables } from "@/lib/email/reservationEmailTemplate";
import { createReservationInputSchema, rescheduleReservationInputSchema } from "@/lib/validation/schemas";
import { normalizePhoneDigits } from "@/lib/customers/normalize";
import { isExclusionConstraintViolation } from "./errors";

const SERVICE_DURATION_MS = SERVICE_DURATION_MINUTES * 60 * 1000;

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

  const gmail = getGmailService();

  // Each send is independent: a failure sending the customer's confirmation
  // must not also suppress the staff notification (and vice versa) - unlike
  // Calendar sync, there is no persisted status for these, so a failure here
  // is only ever visible in server logs.
  await gmail
    .sendEmail(
      buildCustomerConfirmationEmail({
        to: contact.email,
        bodyTemplate,
        variables: buildReservationEmailVariables({
          customerName: contact.name,
          startAt: reservation.startAt,
          endAt: reservation.endAt,
          salonName: reservation.staff.salonName,
        }),
      }),
    )
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

  let reservationId: string;
  try {
    reservationId = await prisma.$transaction(async (tx) => {
      const customer = input.customerId
        ? existingCustomer!
        : // IMPORTANT: `update` here must never include firstVisitDate/
          // firstVisitAcquisitionSourceId. This upsert runs on EVERY booking by
          // a returning customer (online and manual), so touching those fields
          // here would silently overwrite/erase the customer chart's
          // first-visit data on the customer's 2nd+ booking. Chart-side
          // first-visit recording lives entirely in actions/visitRecords.ts's
          // createMyVisitRecord.
          await tx.customer.upsert({
            where: { ownerStaffId_email: { ownerStaffId: input.staffId, email: input.customer!.email } },
            update: { name: input.customer!.name, phone: input.customer!.phone, phoneDigits: normalizePhoneDigits(input.customer!.phone) },
            create: {
              ownerStaffId: input.staffId,
              name: input.customer!.name,
              email: input.customer!.email,
              phone: input.customer!.phone,
              phoneDigits: normalizePhoneDigits(input.customer!.phone),
            },
          });

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
