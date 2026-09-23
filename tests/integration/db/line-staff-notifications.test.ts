import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { SALON_TIME_ZONE } from "@/lib/availability/types";
import { createReservation, rescheduleReservation } from "@/lib/reservations/service";
import { claimAndSendLineNotification } from "@/lib/reservations/lineNotifications";
import { getFakeGmailServiceForTests } from "@/lib/google/gmail/factory";
import { getFakeLineMessagingServiceForTests } from "@/lib/line/messaging/factory";
import { resetDb, seedRoom, seedStaff, seedCustomer } from "../../helpers/db";

/**
 * Covers the STAFF_NEW_RESERVATION push (plan: 腸もみサロン ゆきの スタッフ向け
 * 新規予約LINE通知) - a completely separate concern from customer-facing
 * LINE_CONFIRMATION/LINE_REMINDER, covered by line-booking-integration.test.ts
 * and line-reminder-and-reschedule.test.ts respectively. Every test here sets
 * LINE_STAFF_NOTIFICATION_USER_IDS itself and restores it in afterEach - it is
 * deliberately left unset in .env.test (same reasoning as LINE_ENABLED_STAFF_ID
 * there: a fixed value would leak extra sends into unrelated existing tests
 * that merely happen to enable LINE for their own seeded staff).
 */

const ORIGINAL_ENABLED_STAFF_ID = process.env.LINE_ENABLED_STAFF_ID;
const ORIGINAL_STAFF_RECIPIENTS = process.env.LINE_STAFF_NOTIFICATION_USER_IDS;
const ORIGINAL_MODE = process.env.LINE_NOTIFICATION_MODE;

const YUKINO = "Uyukino-real-id";
const KAZUKI = "Ukazuki-real-id";

function enableLineFor(staffId: string) {
  process.env.LINE_ENABLED_STAFF_ID = staffId;
}

function setStaffRecipients(...ids: string[]) {
  process.env.LINE_STAFF_NOTIFICATION_USER_IDS = ids.join(",");
}

/** Always a future slot relative to "now", so booking-cutoff/availability validation never rejects it regardless of when the suite runs. */
function slotAt(daysFromNow: number, hour: number): string {
  return DateTime.now().setZone(SALON_TIME_ZONE).plus({ days: daysFromNow }).set({ hour, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO()!;
}

async function seedBookableStaff() {
  const staff = await seedStaff({ bookingCutoffType: "HOURS_BEFORE", bookingCutoffHours: 0, bookingWindowDays: 365 });
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    await prisma.weeklyAvailability.create({ data: { staffId: staff.id, dayOfWeek, startMinute: 0, endMinute: 24 * 60 } });
  }
  return staff;
}

describe("STAFF_NEW_RESERVATION push notifications", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    if (ORIGINAL_ENABLED_STAFF_ID === undefined) delete process.env.LINE_ENABLED_STAFF_ID;
    else process.env.LINE_ENABLED_STAFF_ID = ORIGINAL_ENABLED_STAFF_ID;
    if (ORIGINAL_STAFF_RECIPIENTS === undefined) delete process.env.LINE_STAFF_NOTIFICATION_USER_IDS;
    else process.env.LINE_STAFF_NOTIFICATION_USER_IDS = ORIGINAL_STAFF_RECIPIENTS;
    if (ORIGINAL_MODE === undefined) delete process.env.LINE_NOTIFICATION_MODE;
    else process.env.LINE_NOTIFICATION_MODE = ORIGINAL_MODE;
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("a normal CUSTOMER_ONLINE booking for the enabled staff sends a push to both configured recipients", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();
    enableLineFor(staff.id);
    setStaffRecipients(YUKINO, KAZUKI);

    const fakeLine = getFakeLineMessagingServiceForTests();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: slotAt(3, 10),
      source: "CUSTOMER_ONLINE",
      customer: { name: "田中花子", email: "staff-push-normal@example.com", phone: "090-1111-2222" },
    });

    expect(result.ok).toBe(true);
    const staffPushes = fakeLine.sent.filter((m) => m.to === YUKINO || m.to === KAZUKI);
    expect(staffPushes).toHaveLength(2);
    expect(new Set(staffPushes.map((m) => m.to))).toEqual(new Set([YUKINO, KAZUKI]));
    for (const push of staffPushes) {
      expect(push.text).toContain("田中花子");
      expect(push.text).toContain("新規予約が入りました");
      // Phase 1 content restriction (plan §10): no email/phone/LINE userId/notes in the push text.
      expect(push.text).not.toContain("staff-push-normal@example.com");
      expect(push.text).not.toContain("090-1111-2222");
    }

    const rows = await prisma.reservationNotification.findMany({ where: { type: "STAFF_NEW_RESERVATION" } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "SENT")).toBe(true);
  });

  it("a customer with no linked LINE account still triggers both staff pushes (staff notification is independent of Customer.lineUserId)", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();
    enableLineFor(staff.id);
    setStaffRecipients(YUKINO, KAZUKI);

    const fakeGmail = getFakeGmailServiceForTests();
    const fakeLine = getFakeLineMessagingServiceForTests();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: slotAt(3, 11),
      source: "CUSTOMER_ONLINE",
      customer: { name: "未連携客", email: "no-line-customer@example.com", phone: "090-3333-4444" },
      // no lineIdToken - this customer never links a LINE account
    });

    expect(result.ok).toBe(true);
    const customer = await prisma.customer.findFirst({ where: { email: "no-line-customer@example.com" } });
    expect(customer?.lineUserId).toBeNull();

    expect(fakeGmail.sent).toHaveLength(2); // customer confirmation + Gmail staff notification, unaffected
    const customerLinePushes = fakeLine.sent.filter((m) => m.to !== YUKINO && m.to !== KAZUKI);
    expect(customerLinePushes).toHaveLength(0); // no customer LINE at all
    const staffPushes = fakeLine.sent.filter((m) => m.to === YUKINO || m.to === KAZUKI);
    expect(staffPushes).toHaveLength(2); // but the staff push still goes out
  });

  it("a non-enabled staff's booking sends zero staff pushes - reservation and Gmail proceed normally", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();
    enableLineFor("some-other-staff-id-not-under-test");
    setStaffRecipients(YUKINO, KAZUKI);

    const fakeGmail = getFakeGmailServiceForTests();
    const fakeLine = getFakeLineMessagingServiceForTests();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: slotAt(3, 10),
      source: "CUSTOMER_ONLINE",
      customer: { name: "対象外客", email: "not-enabled-staff@example.com", phone: "090-5555-6666" },
    });

    expect(result.ok).toBe(true);
    expect(fakeGmail.sent).toHaveLength(2);
    expect(fakeLine.sent).toHaveLength(0);
    expect(await prisma.reservationNotification.count({ where: { type: "STAFF_NEW_RESERVATION" } })).toBe(0);
  });

  it("a STAFF_MANUAL booking (staff self-registering from the admin screen) sends zero staff pushes, even for the enabled staff", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();
    enableLineFor(staff.id);
    setStaffRecipients(YUKINO, KAZUKI);

    const fakeGmail = getFakeGmailServiceForTests();
    const fakeLine = getFakeLineMessagingServiceForTests();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: slotAt(3, 10),
      source: "STAFF_MANUAL",
      createdByStaffId: staff.id,
      customer: { name: "手動登録客", email: "manual-booking@example.com", phone: "090-7777-8888" },
    });

    expect(result.ok).toBe(true);
    expect(fakeGmail.sent).toHaveLength(2); // Gmail unaffected
    expect(fakeLine.sent).toHaveLength(0); // no staff push for a manually-entered booking
    expect(await prisma.reservationNotification.count({ where: { type: "STAFF_NEW_RESERVATION" } })).toBe(0);
  });

  it('mode "test": both configured staff recipients still receive a push, even though neither is LINE_TEST_USER_ID', async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();
    enableLineFor(staff.id);
    setStaffRecipients(YUKINO, KAZUKI);
    process.env.LINE_NOTIFICATION_MODE = "test";
    process.env.LINE_TEST_USER_ID = "Usome-other-test-account";

    const fakeLine = getFakeLineMessagingServiceForTests();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: slotAt(3, 10),
      source: "CUSTOMER_ONLINE",
      customer: { name: "テストモード客", email: "test-mode@example.com", phone: "090-9999-0000" },
    });

    expect(result.ok).toBe(true);
    const staffPushes = fakeLine.sent.filter((m) => m.to === YUKINO || m.to === KAZUKI);
    expect(staffPushes).toHaveLength(2);
  });

  it('mode "test": an arbitrary userId outside the staff allowlist is never targeted, even when called directly', async () => {
    const room = await seedRoom();
    const staff = await seedBookableStaff();
    enableLineFor(staff.id);
    setStaffRecipients(YUKINO, KAZUKI);
    process.env.LINE_NOTIFICATION_MODE = "test";
    process.env.LINE_TEST_USER_ID = "Usome-other-test-account";

    const customer = await seedCustomer(staff.id);
    const startAt = DateTime.now().setZone(SALON_TIME_ZONE).plus({ days: 3 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const reservation = await prisma.reservation.create({
      data: { roomId: room.id, staffId: staff.id, customerId: customer.id, startAt, endAt, status: "CONFIRMED", source: "CUSTOMER_ONLINE" },
    });

    const result = await claimAndSendLineNotification({
      reservationId: reservation.id,
      type: "STAFF_NEW_RESERVATION",
      lineUserId: "UrandomOutsiderNotInAllowlist",
      text: "hi",
    });

    expect(result).toEqual({ ok: false, reason: "MODE_TEST_NON_TEST_RECIPIENT" });
    expect(getFakeLineMessagingServiceForTests().sent).toHaveLength(0);
  });

  it('mode "off": zero staff pushes, reservation and Gmail unaffected', async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();
    enableLineFor(staff.id);
    setStaffRecipients(YUKINO, KAZUKI);
    process.env.LINE_NOTIFICATION_MODE = "off";

    const fakeGmail = getFakeGmailServiceForTests();
    const fakeLine = getFakeLineMessagingServiceForTests();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: slotAt(3, 10),
      source: "CUSTOMER_ONLINE",
      customer: { name: "オフモード客", email: "off-mode@example.com", phone: "090-1212-3434" },
    });

    expect(result.ok).toBe(true);
    expect(fakeGmail.sent).toHaveLength(2);
    expect(fakeLine.sent).toHaveLength(0);
    expect(await prisma.reservationNotification.count({ where: { type: "STAFF_NEW_RESERVATION" } })).toBe(0);
  });

  it("one recipient failing does not affect the other recipient, Gmail, or the reservation result", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();
    enableLineFor(staff.id);
    setStaffRecipients(YUKINO, KAZUKI);

    const fakeGmail = getFakeGmailServiceForTests();
    const fakeLine = getFakeLineMessagingServiceForTests();
    fakeLine.simulateFailureFor(KAZUKI);

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: slotAt(3, 10),
      source: "CUSTOMER_ONLINE",
      customer: { name: "片方失敗客", email: "partial-failure@example.com", phone: "090-5656-7878" },
    });

    expect(result.ok).toBe(true); // the reservation itself is completely unaffected
    expect(fakeGmail.sent).toHaveLength(2); // Gmail completely unaffected

    const yukinoPush = fakeLine.sent.find((m) => m.to === YUKINO);
    expect(yukinoPush).toBeDefined(); // the successful recipient's send is never undone by the other's failure
    expect(fakeLine.sent.find((m) => m.to === KAZUKI)).toBeUndefined();

    const rows = await prisma.reservationNotification.findMany({ where: { type: "STAFF_NEW_RESERVATION" } });
    expect(rows).toHaveLength(2);
    const statuses = new Set(rows.map((r) => r.status));
    expect(statuses).toEqual(new Set(["SENT", "FAILED"]));
  });

  it("claiming the same (reservation, recipient) a second time is rejected as ALREADY_CLAIMED - no double send", async () => {
    const room = await seedRoom();
    const staff = await seedBookableStaff();
    enableLineFor(staff.id);
    setStaffRecipients(YUKINO, KAZUKI);

    const customer = await seedCustomer(staff.id);
    const startAt = DateTime.now().setZone(SALON_TIME_ZONE).plus({ days: 3 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const reservation = await prisma.reservation.create({
      data: { roomId: room.id, staffId: staff.id, customerId: customer.id, startAt, endAt, status: "CONFIRMED", source: "CUSTOMER_ONLINE" },
    });

    const first = await claimAndSendLineNotification({ reservationId: reservation.id, type: "STAFF_NEW_RESERVATION", lineUserId: YUKINO, text: "hi" });
    expect(first).toEqual({ ok: true });

    const second = await claimAndSendLineNotification({ reservationId: reservation.id, type: "STAFF_NEW_RESERVATION", lineUserId: YUKINO, text: "hi" });
    expect(second).toEqual({ ok: false, reason: "ALREADY_CLAIMED" });

    expect(getFakeLineMessagingServiceForTests().sent.filter((m) => m.to === YUKINO)).toHaveLength(1);
  });

  it("a different recipient for the SAME reservation and type claims independently (not blocked by the first recipient's claim)", async () => {
    const room = await seedRoom();
    const staff = await seedBookableStaff();
    enableLineFor(staff.id);
    setStaffRecipients(YUKINO, KAZUKI);

    const customer = await seedCustomer(staff.id);
    const startAt = DateTime.now().setZone(SALON_TIME_ZONE).plus({ days: 3 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const reservation = await prisma.reservation.create({
      data: { roomId: room.id, staffId: staff.id, customerId: customer.id, startAt, endAt, status: "CONFIRMED", source: "CUSTOMER_ONLINE" },
    });

    const first = await claimAndSendLineNotification({ reservationId: reservation.id, type: "STAFF_NEW_RESERVATION", lineUserId: YUKINO, text: "hi" });
    const second = await claimAndSendLineNotification({ reservationId: reservation.id, type: "STAFF_NEW_RESERVATION", lineUserId: KAZUKI, text: "hi" });

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(getFakeLineMessagingServiceForTests().sent).toHaveLength(2);
  });

  it("rescheduling a reservation never re-sends STAFF_NEW_RESERVATION (it is a new-booking-only push)", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();
    enableLineFor(staff.id);
    setStaffRecipients(YUKINO, KAZUKI);

    const created = await createReservation({
      staffId: staff.id,
      startAtUtcIso: slotAt(3, 10),
      source: "CUSTOMER_ONLINE",
      customer: { name: "変更客", email: "reschedule-no-restaff-push@example.com", phone: "090-4321-8765" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const countAfterCreate = await prisma.reservationNotification.count({ where: { type: "STAFF_NEW_RESERVATION" } });
    expect(countAfterCreate).toBe(2);

    const fakeLine = getFakeLineMessagingServiceForTests();
    fakeLine.reset(); // clear the create-time sends so we can prove reschedule adds nothing new

    const rescheduleResult = await rescheduleReservation({ reservationId: created.reservationId, newStartAtUtcIso: slotAt(4, 11) });
    expect(rescheduleResult).toEqual({ ok: true });

    const countAfterReschedule = await prisma.reservationNotification.count({ where: { type: "STAFF_NEW_RESERVATION" } });
    expect(countAfterReschedule).toBe(2); // unchanged - no new claim/row
    expect(fakeLine.sent.filter((m) => m.to === YUKINO || m.to === KAZUKI)).toHaveLength(0); // no new push sent
  });
});
