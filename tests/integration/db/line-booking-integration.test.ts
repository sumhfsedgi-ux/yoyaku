import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { createReservation } from "@/lib/reservations/service";
import { getFakeGmailServiceForTests } from "@/lib/google/gmail/factory";
import { getFakeLineMessagingServiceForTests } from "@/lib/line/messaging/factory";
import { SALON_TIME_ZONE } from "@/lib/availability/types";
import { resetDb, seedRoom, seedStaff, seedCustomer } from "../../helpers/db";

/** Computed relative to "now" (never a hardcoded calendar date, which drifts into the past as time passes) - a booking slot `daysFromNow` days out at a fixed JST clock hour. */
function slotAt(daysFromNow: number, hour: number): string {
  return DateTime.now().setZone(SALON_TIME_ZONE).plus({ days: daysFromNow }).set({ hour, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO()!;
}

const MONDAY_START = slotAt(3, 10);

async function seedBookableStaff(overrides: Parameters<typeof seedStaff>[0] = {}) {
  const staff = await seedStaff({
    bookingCutoffType: "HOURS_BEFORE",
    bookingCutoffHours: 0,
    bookingWindowDays: 365,
    ...overrides,
  });
  // Full-week availability - the slots above are relative to "today" (whatever
  // weekday that is when the suite runs), so every day must be bookable.
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    await prisma.weeklyAvailability.create({ data: { staffId: staff.id, dayOfWeek, startMinute: 0, endMinute: 24 * 60 } });
  }
  return staff;
}

function stubVerifiedIdToken(lineUserId: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ sub: lineUserId, aud: process.env.LINE_LOGIN_CHANNEL_ID, exp: Math.floor(Date.now() / 1000) + 600 }), {
        status: 200,
      }),
    ),
  );
}

const ORIGINAL_ENABLED_STAFF_ID = process.env.LINE_ENABLED_STAFF_ID;

/** Phase 1 staff scope (see lib/line/staffGate.ts) - every test in this file that expects LINE to actually engage must mark its own seeded staff as the enabled one. */
function enableLineFor(staffId: string) {
  process.env.LINE_ENABLED_STAFF_ID = staffId;
}

describe("LINE booking integration (plan §1-3, §6-8, §10)", () => {
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

  async function setupRoomAndStaff() {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    return seedBookableStaff();
  }

  it("LINE-linked customer: booking sends BOTH the LINE confirmation and both Gmail messages (LINE is additive, never a replacement)", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);
    await seedCustomer(staff.id, { email: "linked@example.com", lineUserId: "Ulinked1" });

    const fakeGmail = getFakeGmailServiceForTests();
    const fakeLine = getFakeLineMessagingServiceForTests();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "連携太郎", email: "linked@example.com", phone: "090-1111-2222" },
    });

    expect(result.ok).toBe(true);
    expect(fakeGmail.sent).toHaveLength(2); // customer + staff, unaffected by LINE
    expect(fakeLine.sent).toHaveLength(1);
    expect(fakeLine.sent[0].to).toBe("Ulinked1");

    const notification = await prisma.reservationNotification.findFirst({ where: { type: "LINE_CONFIRMATION" } });
    expect(notification?.status).toBe("SENT");
    expect(notification?.retryKey).toBeTruthy();
  });

  it("LINE-unlinked customer: no LINE send at all, Gmail still sends normally, no ReservationNotification row is created", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);

    const fakeGmail = getFakeGmailServiceForTests();
    const fakeLine = getFakeLineMessagingServiceForTests();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "未連携花子", email: "unlinked@example.com", phone: "090-3333-4444" },
    });

    expect(result.ok).toBe(true);
    expect(fakeGmail.sent).toHaveLength(2);
    expect(fakeLine.sent).toHaveLength(0);

    const notificationCount = await prisma.reservationNotification.count();
    expect(notificationCount).toBe(0);
  });

  it("a verified LIFF ID token attaches the LINE-confirmed userId to a brand new Customer - never a client-supplied string", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);
    stubVerifiedIdToken("Uverified1");

    await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "新規花子", email: "new-liff@example.com", phone: "090-5555-6666" },
      lineIdToken: "a-real-looking-token",
    });

    const customer = await prisma.customer.findFirst({ where: { email: "new-liff@example.com" } });
    expect(customer?.lineUserId).toBe("Uverified1");
  });

  it("an existing customer (matched by the SAME existing email-matching rule) is backfilled with lineUserId on a later LINE booking", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);
    const existing = await seedCustomer(staff.id, { email: "returning@example.com", lineUserId: null });
    stubVerifiedIdToken("Ubackfill1");

    await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: existing.name, email: "returning@example.com", phone: existing.phone },
      lineIdToken: "a-real-looking-token",
    });

    const updated = await prisma.customer.findUnique({ where: { id: existing.id } });
    expect(updated?.lineUserId).toBe("Ubackfill1");
    // No duplicate row was created - same customer id reused (existing upsert-by-email rule untouched).
    const allWithEmail = await prisma.customer.findMany({ where: { email: "returning@example.com" } });
    expect(allWithEmail).toHaveLength(1);
  });

  it("a customer already linked to a DIFFERENT lineUserId is never overwritten - the booking still succeeds", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);
    await seedCustomer(staff.id, { email: "already-linked@example.com", lineUserId: "UoriginalLink" });
    stubVerifiedIdToken("UdifferentAccount");

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "既存客", email: "already-linked@example.com", phone: "090-7777-8888" },
      lineIdToken: "a-real-looking-token",
    });

    expect(result.ok).toBe(true);
    const customer = await prisma.customer.findFirst({ where: { email: "already-linked@example.com" } });
    expect(customer?.lineUserId).toBe("UoriginalLink"); // untouched
  });

  it("booking under a NEW email with an already-linked lineUserId updates that SAME existing Customer row, rather than forking a second one (see 'editing the LINE-prefilled email' tests below for the full scenario this covers)", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);
    const existing = await seedCustomer(staff.id, { email: "first-owner@example.com", lineUserId: "UsharedAccount" });
    stubVerifiedIdToken("UsharedAccount");

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "別メール客", email: "second-email@example.com", phone: "090-9999-0000" },
      lineIdToken: "a-real-looking-token",
    });

    expect(result.ok).toBe(true);
    expect(await prisma.customer.count({ where: { ownerStaffId: staff.id } })).toBe(1); // no second Customer row created
    const updated = await prisma.customer.findUnique({ where: { id: existing.id } });
    expect(updated?.email).toBe("second-email@example.com"); // same Customer.id, email updated
    expect(updated?.lineUserId).toBe("UsharedAccount"); // LINE link preserved on the same row
  });

  it("Staff isolation at the DB level: the same LINE userId can independently belong to Customer rows under two different staff (@@unique is scoped by ownerStaffId)", async () => {
    // Phase 1 only ever enables LINE for ONE staff at a time (plan: 1-staff
    // restriction), so this no longer exercises the full booking flow for
    // both staff simultaneously - that scenario is covered instead by
    // line-staff-restriction.test.ts (the non-enabled staff never gets a
    // lineUserId at all). This test verifies the underlying schema
    // constraint itself still permits the same real-world LINE account to
    // link to two independent Customer rows under two different staff.
    const staffA = await setupRoomAndStaff();
    const staffB = await seedBookableStaff();

    await seedCustomer(staffA.id, { email: "cross-staff-a@example.com", lineUserId: "UcrossStaff" });
    await seedCustomer(staffB.id, { email: "cross-staff-b@example.com", lineUserId: "UcrossStaff" });

    const customers = await prisma.customer.findMany({ where: { lineUserId: "UcrossStaff" } });
    expect(customers).toHaveLength(2);
    expect(new Set(customers.map((c) => c.ownerStaffId))).toEqual(new Set([staffA.id, staffB.id]));
  });

  it("booking again with the SAME (unedited) LINE-prefilled email still updates the same existing Customer as before", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);
    const existing = await seedCustomer(staff.id, { name: "田中花子", email: "old@example.com", phone: "09011112222", lineUserId: "Uxxx" });
    stubVerifiedIdToken("Uxxx");

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "田中花子", email: "old@example.com", phone: "09011112222" },
      lineIdToken: "a-real-looking-token",
    });

    expect(result.ok).toBe(true);
    expect(await prisma.customer.count({ where: { ownerStaffId: staff.id } })).toBe(1);
    const updated = await prisma.customer.findUnique({ where: { id: existing.id } });
    expect(updated?.email).toBe("old@example.com");
    expect(updated?.lineUserId).toBe("Uxxx");
  });

  it("editing the LINE-prefilled email to one already owned by a DIFFERENT Customer under this staff: booking still succeeds, the email is left unchanged, but the reservation's own snapshot uses the submitted value (so the confirmation email still goes to the right address)", async () => {
    const staff = await setupRoomAndStaff();
    enableLineFor(staff.id);
    const existing = await seedCustomer(staff.id, { name: "田中花子", email: "old@example.com", phone: "09011112222", lineUserId: "Uxxx" });
    await seedCustomer(staff.id, { name: "別の客", email: "taken@example.com" });
    stubVerifiedIdToken("Uxxx");

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "田中花子", email: "taken@example.com", phone: "09011112222" },
      lineIdToken: "a-real-looking-token",
    });

    expect(result.ok).toBe(true); // never fails the booking over an email collision
    expect(await prisma.customer.count({ where: { ownerStaffId: staff.id } })).toBe(2); // no merge, no new duplicate

    const updated = await prisma.customer.findUnique({ where: { id: existing.id } });
    expect(updated?.email).toBe("old@example.com"); // unchanged - never overwrites the other customer's email
    expect(updated?.lineUserId).toBe("Uxxx");

    if (!result.ok) throw new Error("unreachable");
    const reservation = await prisma.reservation.findUnique({ where: { id: result.reservationId } });
    expect(reservation?.customerEmailSnapshot).toBe("taken@example.com"); // confirmation email still uses the submitted value
  });
});
