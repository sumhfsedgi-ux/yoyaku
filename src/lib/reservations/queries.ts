import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { assertOwnsReservation } from "@/lib/auth/authorization";
import { getCalendarService } from "@/lib/google/calendar/factory";
import { resolveRoomCalendarId } from "@/lib/google/roomCalendar";
import { resolvePrimaryRoomId } from "@/lib/room";
import { dateToJst } from "@/lib/time/tz";
import { SALON_TIME_ZONE } from "@/lib/availability/types";

export interface RoomUsageRow {
  id: string;
  staffId: string;
  staffDisplayName: string;
  startAt: Date;
  endAt: Date;
  status: "CONFIRMED" | "CANCELLED";
  isMine: boolean;
}

/**
 * Lists the room's reservations for a day. Deliberately never selects the
 * `customer` relation - PII cannot leak through this endpoint by construction,
 * not by convention, regardless of what a future UI change does with the
 * result (spec test case 9).
 */
export async function listReservationsForDay(dateISO: string, viewerStaffId: string): Promise<RoomUsageRow[]> {
  const dayStart = DateTime.fromISO(dateISO, { zone: SALON_TIME_ZONE }).startOf("day").toJSDate();
  const dayEnd = DateTime.fromISO(dateISO, { zone: SALON_TIME_ZONE }).startOf("day").plus({ days: 1 }).toJSDate();

  const roomId = await resolvePrimaryRoomId();
  if (!roomId) return [];

  const reservations = await prisma.reservation.findMany({
    where: {
      roomId,
      status: "CONFIRMED",
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
    },
    select: {
      id: true,
      staffId: true,
      startAt: true,
      endAt: true,
      status: true,
      staff: { select: { displayName: true } },
    },
    orderBy: { startAt: "asc" },
  });

  return reservations.map((r) => ({
    id: r.id,
    staffId: r.staffId,
    staffDisplayName: r.staff.displayName,
    startAt: r.startAt,
    endAt: r.endAt,
    status: r.status,
    isMine: r.staffId === viewerStaffId,
  }));
}

export interface ReservationDetail {
  id: string;
  staffId: string;
  staffDisplayName: string;
  startAt: Date;
  endAt: Date;
  status: "CONFIRMED" | "CANCELLED";
  googleSyncStatus: string;
  customerId: string;
  customer: { name: string; email: string; phone: string; firstVisitDate: Date | null };
  /** LINE_CONFIRMATION/LINE_REMINDER send status, if either was ever attempted - see ReservationNotification. Empty when the customer has no linked LINE account. */
  lineNotifications: { type: "LINE_CONFIRMATION" | "LINE_REMINDER"; status: "PENDING" | "SENT" | "FAILED" }[];
}

/**
 * Fetches full reservation detail INCLUDING customer PII - but only after
 * confirming `viewerStaffId` owns it. The ownership check runs against a
 * PII-free query first; the `customer` relation is only ever requested in the
 * second query, gated behind that check having already passed. Throws
 * ForbiddenError (never returns partial/redacted data) if the viewer does not
 * own the reservation.
 */
export async function getReservationDetail(reservationId: string, viewerStaffId: string): Promise<ReservationDetail> {
  const ownershipCheck = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { staffId: true },
  });
  if (!ownershipCheck) throw new Error("NOT_FOUND");
  assertOwnsReservation(viewerStaffId, ownershipCheck);

  const reservation = await prisma.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    select: {
      id: true,
      staffId: true,
      customerId: true,
      startAt: true,
      endAt: true,
      status: true,
      googleSyncStatus: true,
      customerNameSnapshot: true,
      customerEmailSnapshot: true,
      customerPhoneSnapshot: true,
      staff: { select: { displayName: true } },
      customer: { select: { name: true, email: true, phone: true, firstVisitDate: true } },
      notifications: { select: { type: true, status: true } },
    },
  });

  return {
    id: reservation.id,
    staffId: reservation.staffId,
    staffDisplayName: reservation.staff.displayName,
    startAt: reservation.startAt,
    endAt: reservation.endAt,
    status: reservation.status,
    googleSyncStatus: reservation.googleSyncStatus,
    customerId: reservation.customerId,
    // Prefer this reservation's own contact snapshot (see plan) over the
    // possibly-since-edited Customer master row; null on reservations
    // created before the snapshot columns existed, where the live join is
    // the only data that ever existed anyway.
    customer: {
      name: reservation.customerNameSnapshot ?? reservation.customer.name,
      email: reservation.customerEmailSnapshot ?? reservation.customer.email,
      phone: reservation.customerPhoneSnapshot ?? reservation.customer.phone,
      firstVisitDate: reservation.customer.firstVisitDate,
    },
    lineNotifications: reservation.notifications,
  };
}

/** Reservation counts per day for a month view, keyed by "YYYY-MM-DD". Deliberately just a count, no PII, no staff detail. */
export async function getReservationCountsForMonth(year: number, month: number): Promise<Record<string, number>> {
  const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone: SALON_TIME_ZONE }).startOf("month").toJSDate();
  const monthEnd = DateTime.fromObject({ year, month, day: 1 }, { zone: SALON_TIME_ZONE }).endOf("month").toJSDate();

  const reservations = await prisma.reservation.findMany({
    where: { status: "CONFIRMED", startAt: { lt: monthEnd }, endAt: { gt: monthStart } },
    select: { startAt: true },
  });

  const counts: Record<string, number> = {};
  for (const r of reservations) {
    // JST calendar date, not the UTC date slice - a reservation starting
    // 00:00-08:59 JST would otherwise land on the wrong day (UTC is 9h behind).
    const key = dateToJst(r.startAt).toISODate()!;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * "部屋使用中" blocks from Google Calendar that don't correspond to a
 * reservation this app knows about. Backed by the Events API (not
 * getFreeBusy - see plan), specifically so a reservation's own synced event
 * can be told apart from a genuinely separate event a staff member added
 * directly in Google Calendar by checking extendedProperties.private.
 * reservationId, rather than by matching time ranges (which would be fooled
 * by a direct event that coincidentally shares a reservation's exact time,
 * or by a synced event whose time was later edited by hand in Google
 * Calendar). Booking availability checks (lib/availability/data.ts) are
 * unaffected - those call getCalendarService().getFreeBusy() directly and do
 * not go through this function. Never returns event titles/descriptions -
 * plan §16/§26: the admin UI shows only "部屋使用中", nothing from the
 * underlying Google event.
 */
export async function getGoogleBusyBlocksForDay(dateISO: string): Promise<{ startAt: Date; endAt: Date }[]> {
  const roomId = await resolvePrimaryRoomId();
  if (!roomId) return [];
  const calendarId = await resolveRoomCalendarId(roomId);
  if (!calendarId) return [];

  const dayStart = DateTime.fromISO(dateISO, { zone: SALON_TIME_ZONE }).startOf("day").toJSDate();
  const dayEnd = DateTime.fromISO(dateISO, { zone: SALON_TIME_ZONE }).startOf("day").plus({ days: 1 }).toJSDate();
  const result = await getCalendarService().listEvents(calendarId, dayStart, dayEnd);
  if (!result.ok) return [];
  return result.events.filter((e) => e.reservationId === null).map((e) => ({ startAt: e.start, endAt: e.end }));
}

/**
 * Same idea as getGoogleBusyBlocksForDay, but for a whole calendar month in
 * one Events API call instead of one call per day (used by the month view's
 * "room" scope) - see lib/calendar/roomUsage.ts.
 */
export async function getGoogleBusyBlocksForMonth(year: number, month: number): Promise<{ startAt: Date; endAt: Date }[]> {
  const roomId = await resolvePrimaryRoomId();
  if (!roomId) return [];
  const calendarId = await resolveRoomCalendarId(roomId);
  if (!calendarId) return [];

  const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone: SALON_TIME_ZONE }).startOf("month").toJSDate();
  const monthEnd = DateTime.fromObject({ year, month, day: 1 }, { zone: SALON_TIME_ZONE }).endOf("month").toJSDate();
  const result = await getCalendarService().listEvents(calendarId, monthStart, monthEnd);
  if (!result.ok) return [];
  return result.events.filter((e) => e.reservationId === null).map((e) => ({ startAt: e.start, endAt: e.end }));
}
