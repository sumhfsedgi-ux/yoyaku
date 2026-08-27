import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { computeAvailabilityForRange } from "@/lib/availability/engine";
import { prismaAvailabilityDeps } from "@/lib/availability/data";
import { SALON_TIME_ZONE } from "@/lib/availability/types";
import { createReservation } from "@/lib/reservations/service";
import { resetDb, seedRoom, seedStaff } from "../../helpers/db";

describe("computeAvailabilityForRange against a real Postgres-backed room (14-day date grid, DB confirmation)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("a room-wide reservation from another staff makes exactly that one day × across a real 14-day range", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedStaff({
      displayName: "スタッフA",
      bookingSlug: "db-range-a",
      loginEmail: "db-range-a@example.com",
      bookingCutoffType: "HOURS_BEFORE",
      bookingCutoffHours: 0,
      bookingWindowDays: 365,
    });
    const staffB = await seedStaff({
      displayName: "スタッフB",
      bookingSlug: "db-range-b",
      loginEmail: "db-range-b@example.com",
      bookingCutoffType: "HOURS_BEFORE",
      bookingCutoffHours: 0,
      bookingWindowDays: 365,
    });
    // Mon-Fri 10:00-19:00 for both staff, so the 14-day window has real
    // weekday variety and the shared-room effect below is unambiguous.
    for (const dayOfWeek of [1, 2, 3, 4, 5]) {
      await prisma.weeklyAvailability.create({
        data: { staffId: staffA.id, dayOfWeek, startMinute: 10 * 60, endMinute: 19 * 60 },
      });
      await prisma.weeklyAvailability.create({
        data: { staffId: staffB.id, dayOfWeek, startMinute: 10 * 60, endMinute: 19 * 60 },
      });
    }

    // createReservation validates its booking cutoff against the REAL wall
    // clock (it takes no injectable `now`), so the booked date must be a real
    // future date at whatever moment this suite actually runs - not a
    // hardcoded calendar date, which would eventually land in the past and
    // start failing PAST_CUTOFF for reasons unrelated to this test. Anchor
    // everything to a Wednesday at least 3 days out instead.
    let bookedDate = DateTime.now().setZone(SALON_TIME_ZONE).plus({ days: 3 }).startOf("day");
    while (bookedDate.weekday !== 3) bookedDate = bookedDate.plus({ days: 1 });
    const rangeStart = bookedDate.minus({ days: 2 }); // Monday
    const rangeEnd = rangeStart.plus({ days: 13 }); // 14-day range
    const dayBefore = bookedDate.minus({ days: 1 });
    const dayAfter = bookedDate.plus({ days: 1 });
    const saturday = bookedDate.plus({ days: 3 });
    const sunday = bookedDate.plus({ days: 4 });

    // Staff B books the ENTIRE business day in the shared room on that
    // Wednesday via six back-to-back 90-minute reservations (10:00-19:00) -
    // appointments are always fixed at 90 minutes, so a "fully booked day" is
    // modeled the same way a real day would fill up, not a single long block.
    for (let i = 0; i < 6; i++) {
      const slotStart = bookedDate.set({ hour: 10, minute: 0 }).plus({ minutes: i * 90 });
      const bResult = await createReservation({
        staffId: staffB.id,
        startAtUtcIso: slotStart.toUTC().toISO()!,
        source: "CUSTOMER_ONLINE",
        customer: { name: "Bさんの客", email: `b-range-customer-${i}@example.com`, phone: "090-0000-0004" },
      });
      expect(bResult.ok).toBe(true);
    }

    const now = rangeStart.set({ hour: 9, minute: 0 });
    const result = await computeAvailabilityForRange(
      { staffId: staffA.id, startDateISO: rangeStart.toISODate()!, endDateISO: rangeEnd.toISODate()!, now },
      prismaAvailabilityDeps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toHaveLength(14);
    expect(result.days.find((d) => d.dateISO === bookedDate.toISODate())?.available).toBe(false);
    expect(result.days.find((d) => d.dateISO === dayBefore.toISODate())?.available).toBe(true);
    expect(result.days.find((d) => d.dateISO === dayAfter.toISODate())?.available).toBe(true);
    // Weekly off-days (Sat/Sun) stay × for an unrelated reason - not part of this assertion's focus,
    // but confirms the fixture's weekly schedule is actually taking effect.
    expect(result.days.find((d) => d.dateISO === saturday.toISODate())?.available).toBe(false);
    expect(result.days.find((d) => d.dateISO === sunday.toISODate())?.available).toBe(false);
  });
});
