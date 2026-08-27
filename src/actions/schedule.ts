"use server";

import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { bookingCutoffSchema, upsertScheduleOverrideInputSchema, weeklyAvailabilityRangeSchema } from "@/lib/validation/schemas";
import type { z } from "zod";

/**
 * None of these functions accept a target staffId parameter - they always act
 * on the caller's own session.staffId. That's deliberate: it makes "edit
 * someone else's schedule" not just rejected but structurally uncallable, the
 * same pattern used for credentials in actions/security.ts. Per plan §10,
 * this is the self-only half of the permission model (staff roster management
 * in actions/staff.ts is the shared half).
 */

export interface WeeklyRangeInput {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export async function getMyWeeklyAvailability() {
  const session = await requireStaffSession();
  return prisma.weeklyAvailability.findMany({
    where: { staffId: session.staffId },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
  });
}

/** Replace-all: the editor UI submits the full week's config each save, simpler than incremental diffing. */
export async function setMyWeeklyAvailability(ranges: WeeklyRangeInput[]) {
  const session = await requireStaffSession();
  const parsed = ranges.map((r) =>
    weeklyAvailabilityRangeSchema.parse({ startMinute: r.startMinute, endMinute: r.endMinute }),
  );

  await prisma.$transaction([
    prisma.weeklyAvailability.deleteMany({ where: { staffId: session.staffId } }),
    prisma.weeklyAvailability.createMany({
      data: ranges.map((r, i) => ({
        staffId: session.staffId,
        dayOfWeek: r.dayOfWeek,
        startMinute: parsed[i].startMinute,
        endMinute: parsed[i].endMinute,
      })),
    }),
  ]);
}

/** `toDateISO` omitted means no upper bound - used by the "設定済みの個別日付"
 * list, which must show every future override regardless of how far out it
 * is (a fixed window previously capped it, so overrides saved beyond that
 * window silently never appeared in the list despite saving correctly). */
export async function getMyScheduleOverrides(fromDateISO: string, toDateISO?: string) {
  const session = await requireStaffSession();
  return prisma.scheduleOverride.findMany({
    where: {
      staffId: session.staffId,
      date: {
        gte: new Date(`${fromDateISO}T00:00:00.000Z`),
        ...(toDateISO ? { lte: new Date(`${toDateISO}T00:00:00.000Z`) } : {}),
      },
    },
    include: { ranges: true },
    orderBy: { date: "asc" },
  });
}

export interface UpsertScheduleOverrideInput {
  dateISO: string;
  isClosed: boolean;
  ranges: { startMinute: number; endMinute: number }[];
}

export async function upsertMyScheduleOverride(input: UpsertScheduleOverrideInput) {
  const session = await requireStaffSession();
  const { isClosed, ranges } = upsertScheduleOverrideInputSchema.parse({ isClosed: input.isClosed, ranges: input.ranges });
  const date = new Date(`${input.dateISO}T00:00:00.000Z`);

  const existing = await prisma.scheduleOverride.findUnique({
    where: { staffId_date: { staffId: session.staffId, date } },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.scheduleOverrideRange.deleteMany({ where: { scheduleOverrideId: existing.id } }),
      prisma.scheduleOverride.update({
        where: { id: existing.id },
        data: {
          isClosed,
          ranges: isClosed ? undefined : { create: ranges },
        },
      }),
    ]);
  } else {
    await prisma.scheduleOverride.create({
      data: {
        staffId: session.staffId,
        date,
        isClosed,
        ranges: isClosed ? undefined : { create: ranges },
      },
    });
  }
}

export async function deleteMyScheduleOverride(dateISO: string) {
  const session = await requireStaffSession();
  const date = new Date(`${dateISO}T00:00:00.000Z`);
  await prisma.scheduleOverride.deleteMany({ where: { staffId: session.staffId, date } });
}

export interface MyBookingSettings {
  bookingCutoffType: "HOURS_BEFORE" | "DAY_BEFORE_AT_TIME";
  bookingCutoffHours: number | null;
  bookingCutoffDaysBefore: number | null;
  bookingCutoffAtMinute: number | null;
  bookingWindowDays: number;
  bookingSlug: string;
}

export async function getMyBookingSettings(): Promise<MyBookingSettings> {
  const session = await requireStaffSession();
  const staff = await prisma.staff.findUniqueOrThrow({
    where: { id: session.staffId },
    select: {
      bookingCutoffType: true,
      bookingCutoffHours: true,
      bookingCutoffDaysBefore: true,
      bookingCutoffAtMinute: true,
      bookingWindowDays: true,
      bookingSlug: true,
    },
  });
  return {
    bookingCutoffType: staff.bookingCutoffType,
    bookingCutoffHours: staff.bookingCutoffHours,
    bookingCutoffDaysBefore: staff.bookingCutoffDaysBefore,
    bookingCutoffAtMinute: staff.bookingCutoffAtMinute,
    bookingWindowDays: staff.bookingWindowDays,
    bookingSlug: staff.bookingSlug,
  };
}

export async function updateMyBookingSettings(input: {
  cutoff: z.infer<typeof bookingCutoffSchema>;
  bookingWindowDays: number;
}) {
  const session = await requireStaffSession();
  const cutoff = bookingCutoffSchema.parse(input.cutoff);

  await prisma.staff.update({
    where: { id: session.staffId },
    data: {
      bookingCutoffType: cutoff.type,
      bookingCutoffHours: cutoff.type === "HOURS_BEFORE" ? cutoff.hours : null,
      bookingCutoffDaysBefore: cutoff.type === "DAY_BEFORE_AT_TIME" ? cutoff.daysBefore : null,
      bookingCutoffAtMinute: cutoff.type === "DAY_BEFORE_AT_TIME" ? cutoff.atMinute : null,
      bookingWindowDays: input.bookingWindowDays,
    },
  });
}
