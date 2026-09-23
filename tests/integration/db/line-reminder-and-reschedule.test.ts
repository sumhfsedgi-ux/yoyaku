import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { SALON_TIME_ZONE } from "@/lib/availability/types";
import { rescheduleReservation } from "@/lib/reservations/service";
import { claimAndSendLineNotification } from "@/lib/reservations/lineNotifications";
import { getFakeLineMessagingServiceForTests } from "@/lib/line/messaging/factory";
import { GET as lineRemindersCron } from "@/app/api/cron/line-reminders/route";
import { resetDb, seedRoom, seedStaff, seedCustomer } from "../../helpers/db";

const CRON_SECRET = process.env.CRON_SECRET!;
const ORIGINAL_ENABLED_STAFF_ID = process.env.LINE_ENABLED_STAFF_ID;

/** Phase 1 staff scope (see lib/line/staffGate.ts) - every test that expects LINE to actually engage must mark its own seeded staff as the enabled one. */
function enableLineFor(staffId: string) {
  process.env.LINE_ENABLED_STAFF_ID = staffId;
}

function callCron(): Promise<Response> {
  return lineRemindersCron(new NextRequest("http://localhost/api/cron/line-reminders", { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
}

async function seedStaffWithRoom() {
  const room = await seedRoom();
  await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
  const staff = await seedStaff({ bookingCutoffType: "HOURS_BEFORE", bookingCutoffHours: 0, bookingWindowDays: 365 });
  // Full-week, all-day availability - the reschedule test below moves a
  // reservation to dates computed relative to "today" (whatever day-of-week
  // that happens to be when the suite runs), so every day must be bookable.
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    await prisma.weeklyAvailability.create({ data: { staffId: staff.id, dayOfWeek, startMinute: 0, endMinute: 24 * 60 } });
  }
  return { room, staff };
}

/** startAt/endAt at a fixed clock time on JST "tomorrow", computed relative to the real current time - the reminder Cron always uses DateTime.now() internally (plan §13/§15), so tests must not hardcode a calendar date. */
function tomorrowJstAt(hour: number) {
  const startAt = DateTime.now().setZone(SALON_TIME_ZONE).plus({ days: 1 }).set({ hour, minute: 0, second: 0, millisecond: 0 }).toJSDate();
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
  return { startAt, endAt };
}

async function seedReservation(params: {
  roomId: string;
  staffId: string;
  customerId: string;
  status?: "CONFIRMED" | "CANCELLED";
  hour?: number;
}) {
  const { startAt, endAt } = tomorrowJstAt(params.hour ?? 12);
  return prisma.reservation.create({
    data: {
      roomId: params.roomId,
      staffId: params.staffId,
      customerId: params.customerId,
      startAt,
      endAt,
      status: params.status ?? "CONFIRMED",
      source: "CUSTOMER_ONLINE",
    },
  });
}

describe("LINE reminder Cron + dedupe + reschedule interaction (plan §10-16)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    process.env.LINE_NOTIFICATION_MODE = "production";
    if (ORIGINAL_ENABLED_STAFF_ID === undefined) delete process.env.LINE_ENABLED_STAFF_ID;
    else process.env.LINE_ENABLED_STAFF_ID = ORIGINAL_ENABLED_STAFF_ID;
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("Cron auth: a request without the correct CRON_SECRET is rejected with 401", async () => {
    const response = await lineRemindersCron(new NextRequest("http://localhost/api/cron/line-reminders"));
    expect(response.status).toBe(401);
  });

  it("eligibility: tomorrow + CONFIRMED + lineUserId + unsent -> sent; CANCELLED / no lineUserId / already-sent -> excluded", async () => {
    const { room, staff } = await seedStaffWithRoom();
    enableLineFor(staff.id);

    const eligible = await seedCustomer(staff.id, { lineUserId: "Ueligible" });
    const cancelledCustomer = await seedCustomer(staff.id, { lineUserId: "Ucancelled" });
    const unlinkedCustomer = await seedCustomer(staff.id, { lineUserId: null });
    const alreadySentCustomer = await seedCustomer(staff.id, { lineUserId: "Ualreadysent" });

    // Hours spaced 2h apart: the room's EXCLUDE constraint blocks any two
    // reservations whose BUFFERED windows (60min service +/-15min) overlap,
    // so consecutive slots must be >= 90min apart (see getOccupiedRange).
    const eligibleReservation = await seedReservation({ roomId: room.id, staffId: staff.id, customerId: eligible.id, hour: 8 });
    await seedReservation({ roomId: room.id, staffId: staff.id, customerId: cancelledCustomer.id, status: "CANCELLED", hour: 10 });
    await seedReservation({ roomId: room.id, staffId: staff.id, customerId: unlinkedCustomer.id, hour: 12 });
    const alreadySentReservation = await seedReservation({ roomId: room.id, staffId: staff.id, customerId: alreadySentCustomer.id, hour: 14 });
    await prisma.reservationNotification.create({
      data: { reservationId: alreadySentReservation.id, type: "LINE_REMINDER", status: "SENT", retryKey: "pre-existing", sentAt: new Date() },
    });

    const response = await callCron();
    const body = (await response.json()) as { checked: number; sent: number };
    expect(body.checked).toBe(1);
    expect(body.sent).toBe(1);

    const fakeLine = getFakeLineMessagingServiceForTests();
    expect(fakeLine.sent).toHaveLength(1);
    expect(fakeLine.sent[0].to).toBe("Ueligible");

    const notification = await prisma.reservationNotification.findUnique({
      where: { reservationId_type_recipientKey: { reservationId: eligibleReservation.id, type: "LINE_REMINDER", recipientKey: "" } },
    });
    expect(notification?.status).toBe("SENT");
  });

  it("test mode: the Cron only ever targets LINE_TEST_USER_ID, never creates FAILED rows for ordinary customers", async () => {
    const { room, staff } = await seedStaffWithRoom();
    enableLineFor(staff.id);
    const testCustomer = await seedCustomer(staff.id, { lineUserId: process.env.LINE_TEST_USER_ID });
    const ordinaryCustomer = await seedCustomer(staff.id, { lineUserId: "UordinaryCustomer" });
    await seedReservation({ roomId: room.id, staffId: staff.id, customerId: testCustomer.id, hour: 8 });
    await seedReservation({ roomId: room.id, staffId: staff.id, customerId: ordinaryCustomer.id, hour: 10 });

    process.env.LINE_NOTIFICATION_MODE = "test";
    const response = await callCron();
    const body = (await response.json()) as { checked: number; sent: number };
    expect(body.checked).toBe(1); // only the test recipient was even queried as a candidate

    const notificationCount = await prisma.reservationNotification.count();
    expect(notificationCount).toBe(1); // no row created at all for the ordinary customer
  });

  it("off mode: the Cron does not query or create anything", async () => {
    const { room, staff } = await seedStaffWithRoom();
    enableLineFor(staff.id);
    const customer = await seedCustomer(staff.id, { lineUserId: "Usomeone" });
    await seedReservation({ roomId: room.id, staffId: staff.id, customerId: customer.id, hour: 10 });

    process.env.LINE_NOTIFICATION_MODE = "off";
    const response = await callCron();
    const body = (await response.json()) as { checked: number; sent: number };
    expect(body.checked).toBe(0);
    expect(body.sent).toBe(0);
    expect(await prisma.reservationNotification.count()).toBe(0);
  });

  it("dedupe: two concurrent claim attempts for the same reservation+type result in exactly one send", async () => {
    const { room, staff } = await seedStaffWithRoom();
    enableLineFor(staff.id);
    const customer = await seedCustomer(staff.id, { lineUserId: "Uconcurrent" });
    const reservation = await seedReservation({ roomId: room.id, staffId: staff.id, customerId: customer.id });

    const [first, second] = await Promise.all([
      claimAndSendLineNotification({ reservationId: reservation.id, type: "LINE_REMINDER", lineUserId: "Uconcurrent", text: "hi" }),
      claimAndSendLineNotification({ reservationId: reservation.id, type: "LINE_REMINDER", lineUserId: "Uconcurrent", text: "hi" }),
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    expect(outcomes.filter((r) => !r.ok && r.reason === "ALREADY_CLAIMED")).toHaveLength(1);

    const fakeLine = getFakeLineMessagingServiceForTests();
    expect(fakeLine.sent).toHaveLength(1);

    const rows = await prisma.reservationNotification.findMany({ where: { reservationId: reservation.id, type: "LINE_REMINDER" } });
    expect(rows).toHaveLength(1); // the unique constraint allowed only one row to ever be created
  });

  it("reschedule to a different day resets LINE_REMINDER eligibility - a reservation already marked SENT becomes eligible again at its new date", async () => {
    const { room, staff } = await seedStaffWithRoom();
    enableLineFor(staff.id);
    const customer = await seedCustomer(staff.id, { lineUserId: "Urescheduled" });
    const reservation = await seedReservation({ roomId: room.id, staffId: staff.id, customerId: customer.id, hour: 10 });
    await prisma.reservationNotification.create({
      data: { reservationId: reservation.id, type: "LINE_REMINDER", status: "SENT", retryKey: "old-send", sentAt: new Date() },
    });

    // Move it two days further out.
    const newStart = DateTime.fromJSDate(reservation.startAt).plus({ days: 2 });
    await rescheduleReservation({ reservationId: reservation.id, newStartAtUtcIso: newStart.toUTC().toISO()! });

    const rowsAfterReschedule = await prisma.reservationNotification.findMany({
      where: { reservationId: reservation.id, type: "LINE_REMINDER" },
    });
    expect(rowsAfterReschedule).toHaveLength(0); // reset, not left as a stale SENT row blocking the new date

    // LINE_CONFIRMATION is never touched by a reschedule (Phase 1 does not resend it).
    await prisma.reservationNotification.create({
      data: { reservationId: reservation.id, type: "LINE_CONFIRMATION", status: "SENT", retryKey: "confirmation-send", sentAt: new Date() },
    });
    await rescheduleReservation({ reservationId: reservation.id, newStartAtUtcIso: newStart.plus({ days: 1 }).toUTC().toISO()! });
    const confirmationRow = await prisma.reservationNotification.findUnique({
      where: { reservationId_type_recipientKey: { reservationId: reservation.id, type: "LINE_CONFIRMATION", recipientKey: "" } },
    });
    expect(confirmationRow).not.toBeNull();
  });
});
