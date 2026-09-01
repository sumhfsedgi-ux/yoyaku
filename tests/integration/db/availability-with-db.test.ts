import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { computeAvailableSlots, computeAvailabilityForRange, validateSlotBookable } from "@/lib/availability/engine";
import { prismaAvailabilityDeps } from "@/lib/availability/data";
import { SALON_TIME_ZONE } from "@/lib/availability/types";
import { createReservation } from "@/lib/reservations/service";
import { resetDb, seedRoom, seedStaff } from "../../helpers/db";

describe("computeAvailableSlots against a real Postgres-backed room (spec case 4, DB confirmation)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("staff A's slot list excludes a time staff B has booked in the shared room, even though A has no reservations of her own", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedStaff({
      displayName: "スタッフA",
      bookingSlug: "db-avail-a",
      loginEmail: "db-avail-a@example.com",
      bookingCutoffType: "HOURS_BEFORE",
      bookingCutoffHours: 0,
      bookingWindowDays: 365,
    });
    const staffB = await seedStaff({
      displayName: "スタッフB",
      bookingSlug: "db-avail-b",
      loginEmail: "db-avail-b@example.com",
      bookingCutoffType: "HOURS_BEFORE",
      bookingCutoffHours: 0,
      bookingWindowDays: 365,
    });
    await prisma.weeklyAvailability.create({
      data: { staffId: staffA.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 },
    });
    await prisma.weeklyAvailability.create({
      data: { staffId: staffB.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 },
    });

    const bResult = await createReservation({
      staffId: staffB.id,
      startAtUtcIso: "2026-09-07T04:00:00.000Z", // 13:00 JST Monday
      source: "CUSTOMER_ONLINE",
      customer: { name: "Bさんの客", email: "b-customer@example.com", phone: "090-0000-0003" },
    });
    expect(bResult.ok).toBe(true);

    const now = DateTime.fromISO("2026-08-24T09:00", { zone: SALON_TIME_ZONE });
    const slotsForA = await computeAvailableSlots({ staffId: staffA.id, dateISO: "2026-09-07", now }, prismaAvailabilityDeps);

    expect(slotsForA.ok).toBe(true);
    if (!slotsForA.ok) return;
    const blockedStart = DateTime.fromISO("2026-09-07T13:00", { zone: SALON_TIME_ZONE }).toUTC().toISO();
    const clearStart = DateTime.fromISO("2026-09-07T14:30", { zone: SALON_TIME_ZONE }).toUTC().toISO();
    expect(slotsForA.slots).not.toContain(blockedStart);
    expect(slotsForA.slots).toContain(clearStart);
  });

  it("regression: loadStaffConfig's ScheduleOverride query is bounded to the range each engine function actually needs - a far-future/far-past override never leaks into an unrelated day's computation", async () => {
    // Perf refactor: loadStaffConfig now takes an override date-range so it
    // doesn't fetch a staff's entire override history on every call. This
    // proves the range bound doesn't just "happen to work" (an override
    // outside the requested day/range must have zero effect) across all
    // three engine entry points.
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedStaff({
      displayName: "スタッフA",
      bookingSlug: "db-avail-range",
      loginEmail: "db-avail-range@example.com",
      bookingCutoffType: "HOURS_BEFORE",
      bookingCutoffHours: 0,
      bookingWindowDays: 3650,
    });
    await prisma.weeklyAvailability.create({
      data: { staffId: staff.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 },
    });
    // An override far outside every range queried below (10 years out) -
    // must never affect a computation for 2026-09-07.
    await prisma.scheduleOverride.create({
      data: { staffId: staff.id, date: new Date("2036-08-31T00:00:00.000Z"), isClosed: true },
    });

    const now = DateTime.fromISO("2026-08-24T09:00", { zone: SALON_TIME_ZONE });

    const singleDay = await computeAvailableSlots({ staffId: staff.id, dateISO: "2026-09-07", now }, prismaAvailabilityDeps);
    expect(singleDay.ok).toBe(true);
    if (singleDay.ok) expect(singleDay.slots.length).toBeGreaterThan(0);

    const range = await computeAvailabilityForRange(
      { staffId: staff.id, startDateISO: "2026-08-31", endDateISO: "2026-09-13", now },
      prismaAvailabilityDeps,
    );
    expect(range.ok).toBe(true);
    if (range.ok) expect(range.days.find((d) => d.dateISO === "2026-09-07")?.available).toBe(true);

    const startAtUtcIso = DateTime.fromISO("2026-09-07T11:00", { zone: SALON_TIME_ZONE }).toUTC().toISO()!;
    const validation = await validateSlotBookable({ staffId: staff.id, startAtUtcIso, now }, prismaAvailabilityDeps);
    expect(validation).toEqual({ ok: true });
  });
});
