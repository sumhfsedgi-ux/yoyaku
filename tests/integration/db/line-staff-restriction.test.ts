import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { SALON_TIME_ZONE } from "@/lib/availability/types";
import { createReservation } from "@/lib/reservations/service";
import { claimAndSendLineNotification } from "@/lib/reservations/lineNotifications";
import { getFakeGmailServiceForTests } from "@/lib/google/gmail/factory";
import { getFakeLineMessagingServiceForTests } from "@/lib/line/messaging/factory";
import { GET as lineRemindersCron } from "@/app/api/cron/line-reminders/route";
import { resetDb, seedRoom, seedStaff, seedCustomer } from "../../helpers/db";

/**
 * Phase 1 restricts LINE to exactly one staff member (see
 * lib/line/staffGate.ts) - every test here deliberately sets
 * LINE_ENABLED_STAFF_ID to some id OTHER than the staff actually being
 * booked/reminded, to prove that staff gets none of the LINE behavior while
 * everything else (reservation, Gmail) proceeds exactly as before this
 * feature existed. A non-matching literal string is enough - there is no
 * need for a second real Staff row, since the gate is a plain string
 * comparison against whatever LINE_ENABLED_STAFF_ID happens to be.
 */
const SOME_OTHER_STAFF_ID = "some-other-staff-id-not-under-test";

const CRON_SECRET = process.env.CRON_SECRET!;
const ORIGINAL_ENABLED_STAFF_ID = process.env.LINE_ENABLED_STAFF_ID;

function callCron(): Promise<Response> {
  return lineRemindersCron(new NextRequest("http://localhost/api/cron/line-reminders", { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
}

function slotAt(daysFromNow: number, hour: number): string {
  return DateTime.now().setZone(SALON_TIME_ZONE).plus({ days: daysFromNow }).set({ hour, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO()!;
}

function tomorrowJstAt(hour: number) {
  const startAt = DateTime.now().setZone(SALON_TIME_ZONE).plus({ days: 1 }).set({ hour, minute: 0, second: 0, millisecond: 0 }).toJSDate();
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
  return { startAt, endAt };
}

async function seedBookableStaff() {
  const staff = await seedStaff({ bookingCutoffType: "HOURS_BEFORE", bookingCutoffHours: 0, bookingWindowDays: 365 });
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    await prisma.weeklyAvailability.create({ data: { staffId: staff.id, dayOfWeek, startMinute: 0, endMinute: 24 * 60 } });
  }
  return staff;
}

describe("LINE Phase 1 staff restriction (plan: 腸もみサロン ゆきの only)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_ENABLED_STAFF_ID === undefined) delete process.env.LINE_ENABLED_STAFF_ID;
    else process.env.LINE_ENABLED_STAFF_ID = ORIGINAL_ENABLED_STAFF_ID;
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("a non-enabled staff's booking never acquires a lineUserId, even with a verified ID token - reservation and Gmail proceed normally", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();
    process.env.LINE_ENABLED_STAFF_ID = SOME_OTHER_STAFF_ID;

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ sub: "UshouldNeverBeStored", aud: process.env.LINE_LOGIN_CHANNEL_ID, exp: Math.floor(Date.now() / 1000) + 600 }),
            { status: 200 },
          ),
      ),
    );

    const fakeGmail = getFakeGmailServiceForTests();
    const fakeLine = getFakeLineMessagingServiceForTests();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: slotAt(3, 10),
      source: "CUSTOMER_ONLINE",
      customer: { name: "対象外客", email: "not-enabled@example.com", phone: "090-0000-1111" },
      lineIdToken: "a-real-looking-token",
    });

    expect(result.ok).toBe(true);
    const customer = await prisma.customer.findFirst({ where: { email: "not-enabled@example.com" } });
    expect(customer?.lineUserId).toBeNull(); // never acquired for a non-enabled staff, despite a validly-verifiable token

    expect(fakeGmail.sent).toHaveLength(2); // Gmail completely unaffected
    expect(fakeLine.sent).toHaveLength(0); // no LINE push at all
    expect(await prisma.reservationNotification.count()).toBe(0);
  });

  it("a customer with a PRE-EXISTING lineUserId under a non-enabled staff still never receives a confirmation push", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();
    process.env.LINE_ENABLED_STAFF_ID = SOME_OTHER_STAFF_ID;

    await seedCustomer(staff.id, { email: "pre-linked@example.com", lineUserId: "UpreLinked" });

    const fakeGmail = getFakeGmailServiceForTests();
    const fakeLine = getFakeLineMessagingServiceForTests();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: slotAt(3, 10),
      source: "CUSTOMER_ONLINE",
      customer: { name: "既存連携客", email: "pre-linked@example.com", phone: "090-2222-3333" },
    });

    expect(result.ok).toBe(true);
    expect(fakeGmail.sent).toHaveLength(2);
    expect(fakeLine.sent).toHaveLength(0);
    expect(await prisma.reservationNotification.count()).toBe(0);
  });

  it("claimAndSendLineNotification refuses a non-enabled staff's reservation even when called directly with a real lineUserId", async () => {
    const room = await seedRoom();
    const staff = await seedBookableStaff();
    process.env.LINE_ENABLED_STAFF_ID = SOME_OTHER_STAFF_ID;

    const customer = await seedCustomer(staff.id, { lineUserId: "UdirectCall" });
    const { startAt, endAt } = tomorrowJstAt(10);
    const reservation = await prisma.reservation.create({
      data: { roomId: room.id, staffId: staff.id, customerId: customer.id, startAt, endAt, status: "CONFIRMED", source: "CUSTOMER_ONLINE" },
    });

    const result = await claimAndSendLineNotification({
      reservationId: reservation.id,
      type: "LINE_CONFIRMATION",
      lineUserId: "UdirectCall",
      text: "hi",
    });

    expect(result).toEqual({ ok: false, reason: "STAFF_NOT_ENABLED" });
    expect(await prisma.reservationNotification.count()).toBe(0);
    expect(getFakeLineMessagingServiceForTests().sent).toHaveLength(0);
  });

  it("the reminder Cron excludes a non-enabled staff's reservation even when it otherwise matches every eligibility condition", async () => {
    const room = await seedRoom();
    const staff = await seedBookableStaff();
    process.env.LINE_ENABLED_STAFF_ID = SOME_OTHER_STAFF_ID;

    const customer = await seedCustomer(staff.id, { lineUserId: "UotherStaffTomorrow" });
    const { startAt, endAt } = tomorrowJstAt(10);
    await prisma.reservation.create({
      data: { roomId: room.id, staffId: staff.id, customerId: customer.id, startAt, endAt, status: "CONFIRMED", source: "CUSTOMER_ONLINE" },
    });

    const response = await callCron();
    const body = (await response.json()) as { checked: number; sent: number };
    expect(body.checked).toBe(0);
    expect(body.sent).toBe(0);
    expect(await prisma.reservationNotification.count()).toBe(0);
  });

  it("LINE_ENABLED_STAFF_ID unset entirely: no staff can use LINE, but reservations and Gmail are unaffected", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();
    delete process.env.LINE_ENABLED_STAFF_ID;

    await seedCustomer(staff.id, { email: "no-target-configured@example.com", lineUserId: "Uanything" });
    const fakeGmail = getFakeGmailServiceForTests();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: slotAt(3, 10),
      source: "CUSTOMER_ONLINE",
      customer: { name: "客", email: "no-target-configured@example.com", phone: "090-4444-5555" },
    });

    expect(result.ok).toBe(true);
    expect(fakeGmail.sent).toHaveLength(2);
    expect(getFakeLineMessagingServiceForTests().sent).toHaveLength(0);

    // The Cron itself also refuses to run at all without a configured target.
    const response = await callCron();
    const body = (await response.json()) as { checked: number; sent: number; note?: string };
    expect(body.checked).toBe(0);
    expect(body.note).toContain("LINE_ENABLED_STAFF_ID");
  });
});
