import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { computeAvailableSlots } from "@/lib/availability/engine";
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
      startAtUtcIso: "2026-08-31T04:00:00.000Z", // 13:00 JST Monday
      source: "CUSTOMER_ONLINE",
      customer: { name: "Bさんの客", email: "b-customer@example.com", phone: "090-0000-0003" },
    });
    expect(bResult.ok).toBe(true);

    const now = DateTime.fromISO("2026-08-24T09:00", { zone: SALON_TIME_ZONE });
    const slotsForA = await computeAvailableSlots({ staffId: staffA.id, dateISO: "2026-08-31", now }, prismaAvailabilityDeps);

    expect(slotsForA.ok).toBe(true);
    if (!slotsForA.ok) return;
    const blockedStart = DateTime.fromISO("2026-08-31T13:00", { zone: SALON_TIME_ZONE }).toUTC().toISO();
    const clearStart = DateTime.fromISO("2026-08-31T14:30", { zone: SALON_TIME_ZONE }).toUTC().toISO();
    expect(slotsForA.slots).not.toContain(blockedStart);
    expect(slotsForA.slots).toContain(clearStart);
  });
});
