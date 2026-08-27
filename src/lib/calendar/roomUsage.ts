import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { dateToJst } from "@/lib/time/tz";
import { SALON_TIME_ZONE } from "@/lib/availability/types";
import { getGoogleBusyBlocksForDay, getGoogleBusyBlocksForMonth } from "@/lib/reservations/queries";
import { resolvePrimaryRoomId } from "@/lib/room";
import type { CalendarScopeParam, RoomTimelineEntry } from "./types";

/**
 * The PII boundary for the calendar's "room" scope: the CALLER's own
 * reservations are fetched with `customer: { select: { name: true } } }` in
 * a query filtered to `staffId: viewerStaffId`; every OTHER staff member's
 * reservation is fetched from a SEPARATE query that never selects `customer`
 * at all (see listOwnReservations vs listOtherReservations below). This
 * mirrors the two-query pattern already used by
 * lib/reservations/queries.ts's getReservationDetail - it's not that the
 * customer name is fetched-then-hidden for other staff, the query asking for
 * another staff's rows is structurally incapable of returning a customer
 * name in the first place.
 */

async function listOwnReservations(rangeStart: Date, rangeEnd: Date, viewerStaffId: string) {
  const roomId = await resolvePrimaryRoomId();
  if (!roomId) return [];

  const rows = await prisma.reservation.findMany({
    where: { roomId, staffId: viewerStaffId, status: "CONFIRMED", startAt: { lt: rangeEnd }, endAt: { gt: rangeStart } },
    select: { id: true, startAt: true, endAt: true, customer: { select: { name: true } } },
    orderBy: { startAt: "asc" },
  });
  return rows.map(
    (r): RoomTimelineEntry => ({
      kind: "reservation",
      id: r.id,
      startAt: r.startAt,
      endAt: r.endAt,
      isMine: true,
      staffId: viewerStaffId,
      label: `${r.customer.name}様`,
    }),
  );
}

async function listOtherStaffReservations(rangeStart: Date, rangeEnd: Date, viewerStaffId: string) {
  const roomId = await resolvePrimaryRoomId();
  if (!roomId) return [];

  const rows = await prisma.reservation.findMany({
    where: { roomId, staffId: { not: viewerStaffId }, status: "CONFIRMED", startAt: { lt: rangeEnd }, endAt: { gt: rangeStart } },
    select: { id: true, startAt: true, endAt: true, staffId: true, staff: { select: { displayName: true } } },
    orderBy: { startAt: "asc" },
  });
  return rows.map(
    (r): RoomTimelineEntry => ({
      kind: "reservation",
      id: r.id,
      startAt: r.startAt,
      endAt: r.endAt,
      isMine: false,
      staffId: r.staffId,
      label: r.staff.displayName,
    }),
  );
}

function toGoogleBusyEntries(blocks: { startAt: Date; endAt: Date }[]): RoomTimelineEntry[] {
  return blocks.map((b, i) => ({
    kind: "googleBusy",
    id: `google-${b.startAt.getTime()}-${i}`,
    startAt: b.startAt,
    endAt: b.endAt,
    isMine: false,
    label: "部屋使用中",
  }));
}

function sortByStart(entries: RoomTimelineEntry[]): RoomTimelineEntry[] {
  return [...entries].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/**
 * Day-view data for /calendar. "mine" never touches Google Calendar at all
 * (per spec: self-check is not meant to double as a room-availability
 * check) - "room" additionally merges in the shared calendar's busy blocks.
 */
export async function listRoomUsageForDay(
  dateISO: string,
  viewerStaffId: string,
  scope: CalendarScopeParam,
): Promise<RoomTimelineEntry[]> {
  const dayStart = DateTime.fromISO(dateISO, { zone: SALON_TIME_ZONE }).startOf("day").toJSDate();
  const dayEnd = DateTime.fromISO(dateISO, { zone: SALON_TIME_ZONE }).startOf("day").plus({ days: 1 }).toJSDate();

  const own = await listOwnReservations(dayStart, dayEnd, viewerStaffId);
  if (scope === "mine") return sortByStart(own);

  const [others, googleBlocks] = await Promise.all([
    listOtherStaffReservations(dayStart, dayEnd, viewerStaffId),
    getGoogleBusyBlocksForDay(dateISO),
  ]);
  return sortByStart([...own, ...others, ...toGoogleBusyEntries(googleBlocks)]);
}

/**
 * Month-view data for /calendar, bucketed by JST calendar date
 * ("YYYY-MM-DD"). Google freebusy is fetched ONCE for the whole month
 * (getGoogleBusyBlocksForMonth), not once per day, then bucketed by the JST
 * date of each busy interval's start - same simplification already used by
 * getReservationCountsForMonth for reservations.
 */
export async function listRoomUsageForMonth(
  year: number,
  month: number,
  viewerStaffId: string,
  scope: CalendarScopeParam,
): Promise<Record<string, RoomTimelineEntry[]>> {
  const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone: SALON_TIME_ZONE }).startOf("month").toJSDate();
  const monthEnd = DateTime.fromObject({ year, month, day: 1 }, { zone: SALON_TIME_ZONE }).endOf("month").toJSDate();

  const own = await listOwnReservations(monthStart, monthEnd, viewerStaffId);
  let all = own;

  if (scope === "room") {
    const [others, googleBlocks] = await Promise.all([
      listOtherStaffReservations(monthStart, monthEnd, viewerStaffId),
      getGoogleBusyBlocksForMonth(year, month),
    ]);
    all = [...own, ...others, ...toGoogleBusyEntries(googleBlocks)];
  }

  const byDate: Record<string, RoomTimelineEntry[]> = {};
  for (const entry of all) {
    const key = dateToJst(entry.startAt).toISODate()!;
    (byDate[key] ??= []).push(entry);
  }
  for (const key of Object.keys(byDate)) {
    byDate[key] = sortByStart(byDate[key]);
  }
  return byDate;
}
