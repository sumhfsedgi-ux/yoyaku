"use server";

import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { listRoomUsageForDay, listRoomUsageForMonth } from "@/lib/calendar/roomUsage";
import type { CalendarScopeParam, CalendarViewParam } from "@/lib/calendar/types";
import type { CalendarDisplay } from "@/lib/calendar/resolveDisplay";

export async function getCalendarDayData(dateISO: string, scope: CalendarScopeParam) {
  const session = await requireStaffSession();
  return listRoomUsageForDay(dateISO, session.staffId, scope);
}

export async function getCalendarMonthData(year: number, month: number, scope: CalendarScopeParam) {
  const session = await requireStaffSession();
  return listRoomUsageForMonth(year, month, session.staffId, scope);
}

export async function getMyCalendarPreference(): Promise<CalendarDisplay> {
  const session = await requireStaffSession();
  const staff = await prisma.staff.findUniqueOrThrow({
    where: { id: session.staffId },
    select: { calendarView: true, calendarScope: true },
  });
  return {
    view: staff.calendarView === "MONTH" ? "month" : "day",
    scope: staff.calendarScope === "ROOM" ? "room" : "mine",
  };
}

/**
 * Fire-and-forget from the client (see CalendarToggles.tsx): a failure here
 * must never block switching the view on screen, so this deliberately has no
 * special error type for the caller to handle beyond the standard thrown
 * exception - the client just lets the toggle happen and logs on catch.
 */
export async function updateMyCalendarPreference(input: { view: CalendarViewParam; scope: CalendarScopeParam }): Promise<void> {
  const session = await requireStaffSession();
  await prisma.staff.update({
    where: { id: session.staffId },
    data: {
      calendarView: input.view === "month" ? "MONTH" : "DAY",
      calendarScope: input.scope === "room" ? "ROOM" : "MINE",
    },
  });
}
