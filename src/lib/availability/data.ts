import { prisma } from "@/lib/db/prisma";
import { getCalendarService } from "@/lib/google/calendar/factory";
import { resolveRoomCalendarId } from "@/lib/google/roomCalendar";
import { resolvePrimaryRoomId } from "@/lib/room";
import type { ComputeSlotsDeps } from "./engine";
import type { CutoffConfig, OverrideRule, StaffAvailabilityConfig, WeeklyRule } from "./types";

/** Real, Prisma + Google Calendar backed implementation of ComputeSlotsDeps. */
export const prismaAvailabilityDeps: ComputeSlotsDeps = {
  async loadStaffConfig(staffId, overrideRangeStartISO, overrideRangeEndISO): Promise<StaffAvailabilityConfig | null> {
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: {
        id: true,
        active: true,
        bookingCutoffType: true,
        bookingCutoffHours: true,
        bookingCutoffDaysBefore: true,
        bookingCutoffAtMinute: true,
        bookingWindowDays: true,
        weeklyAvailability: { select: { dayOfWeek: true, startMinute: true, endMinute: true } },
        scheduleOverrides: {
          where: {
            date: {
              gte: new Date(`${overrideRangeStartISO}T00:00:00.000Z`),
              lte: new Date(`${overrideRangeEndISO}T00:00:00.000Z`),
            },
          },
          select: { date: true, isClosed: true, ranges: { select: { startMinute: true, endMinute: true } } },
        },
      },
    });
    if (!staff) return null;

    const weekly: WeeklyRule[] = [];
    for (let day = 0; day <= 6; day++) {
      weekly.push({
        dayOfWeek: day as WeeklyRule["dayOfWeek"],
        ranges: staff.weeklyAvailability
          .filter((w) => w.dayOfWeek === day)
          .map((w) => ({ startMinute: w.startMinute, endMinute: w.endMinute })),
      });
    }

    const overridesByDate = new Map<string, OverrideRule>();
    for (const override of staff.scheduleOverrides) {
      const dateISO = override.date.toISOString().slice(0, 10);
      overridesByDate.set(dateISO, {
        date: dateISO,
        isClosed: override.isClosed,
        ranges: override.ranges.map((r) => ({ startMinute: r.startMinute, endMinute: r.endMinute })),
      });
    }

    const cutoff: CutoffConfig =
      staff.bookingCutoffType === "HOURS_BEFORE"
        ? { type: "HOURS_BEFORE", hours: staff.bookingCutoffHours ?? 0 }
        : {
            type: "DAY_BEFORE_AT_TIME",
            daysBefore: staff.bookingCutoffDaysBefore ?? 1,
            atMinute: staff.bookingCutoffAtMinute ?? 0,
          };

    return {
      staffId: staff.id,
      active: staff.active,
      weekly,
      overridesByDate,
      cutoff,
      bookingWindowDays: staff.bookingWindowDays,
    };
  },

  async loadRoomReservations(roomId, rangeStart, rangeEnd, excludeReservationId) {
    const reservations = await prisma.reservation.findMany({
      where: {
        roomId,
        status: "CONFIRMED",
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
        ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
      },
      select: { startAt: true, endAt: true },
    });
    return reservations.map((r) => ({ start: r.startAt, end: r.endAt }));
  },

  async loadCalendarBusy(roomId, rangeStart, rangeEnd) {
    const calendarId = await resolveRoomCalendarId(roomId);
    if (!calendarId) return { ok: false };

    const result = await getCalendarService().getFreeBusy(calendarId, rangeStart, rangeEnd);
    if (!result.ok) return { ok: false };
    return { ok: true, busy: result.busy };
  },

  resolvePrimaryRoomId,
};
