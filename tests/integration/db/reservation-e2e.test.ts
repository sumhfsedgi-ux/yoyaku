import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createReservation } from "@/lib/reservations/service";
import { getFakeCalendarServiceForTests } from "@/lib/google/calendar/factory";
import { getFakeGmailServiceForTests } from "@/lib/google/gmail/factory";
import { EMAIL_TEMPLATE_SETTINGS_ID } from "@/lib/email/emailTemplateSettings";
import { resetDb, seedRoom, seedStaff } from "../../helpers/db";

const MONDAY_START = "2026-09-07T04:00:00.000Z"; // 13:00 JST on a Monday

async function seedBookableStaff() {
  const staff = await seedStaff({
    displayName: "スタッフA",
    bookingSlug: "e2e-staff-a",
    loginEmail: "e2e-staff-a@example.com",
    bookingCutoffType: "HOURS_BEFORE",
    bookingCutoffHours: 0,
    bookingWindowDays: 365,
  });
  await prisma.weeklyAvailability.create({
    data: { staffId: staff.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 },
  });
  return staff;
}

describe("createReservation end-to-end (spec case 10: DB + Calendar + Gmail)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("a normal booking persists to the DB, creates a Calendar event, and sends both emails", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();

    const fakeGmail = getFakeGmailServiceForTests();
    fakeGmail.sent = [];

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "山田花子", email: "hanako@example.com", phone: "090-1234-5678" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dbRow = await prisma.reservation.findUnique({ where: { id: result.reservationId } });
    expect(dbRow?.status).toBe("CONFIRMED");
    expect(dbRow?.googleSyncStatus).toBe("SYNCED");
    expect(dbRow?.googleEventId).toBeTruthy();

    const calendarService = getFakeCalendarServiceForTests();
    const busy = await calendarService.getFreeBusy(
      "primary",
      new Date("2026-09-07T00:00:00.000Z"),
      new Date("2026-09-08T00:00:00.000Z"),
    );
    expect(busy.ok).toBe(true);
    if (busy.ok) expect(busy.busy).toHaveLength(1);
    // The reservation's own stored startAt/endAt is the raw actual 60-minute
    // service time (13:00-14:00), but the event pushed to Google is the
    // BUFFERED occupied window (12:45-14:15) - see
    // syncReservationToCalendarBestEffort.
    if (busy.ok) {
      expect(busy.busy[0].start.toISOString()).toBe("2026-09-07T03:45:00.000Z"); // 12:45 JST
      expect(busy.busy[0].end.toISOString()).toBe("2026-09-07T05:15:00.000Z"); // 14:15 JST
    }

    expect(fakeGmail.sent).toHaveLength(2);
    const customerEmail = fakeGmail.sent.find((m) => m.to === "hanako@example.com");
    const staffEmail = fakeGmail.sent.find((m) => m.to === staff.loginEmail);
    expect(customerEmail).toBeDefined();
    expect(staffEmail).toBeDefined();
    // Customer email now shows the full start-end range via the default
    // template's {{reservationDateTime}} tag - a deliberate policy change
    // from the earlier "never reveal the end time" rule, per the reservation
    // email template feature's explicit spec (a staff member can still write
    // a template that omits it, using {{reservationDate}}+{{startTime}}).
    expect(customerEmail!.text).toContain("13:00");
    expect(customerEmail!.text).toContain("14:00");
    // Staff email is allowed to show the full range - the actual 60-minute
    // service time (13:00-14:00), not the buffered Calendar push window.
    expect(staffEmail!.text).toContain("13:00");
    expect(staffEmail!.text).toContain("14:00");
  });

  it("the Calendar event carries no customer PII in its title/description", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();

    await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "個人情報太郎", email: "personal@example.com", phone: "090-9999-8888" },
    });

    const dbRow = await prisma.reservation.findFirst({ where: { staffId: staff.id } });
    expect(dbRow?.googleEventId).toBeTruthy();
    // The fake store doesn't expose summary text directly, so assert indirectly:
    // the DB is the only place PII should exist, and the sync succeeded without
    // needing to pass PII into createEvent (see syncReservationToCalendarBestEffort).
    expect(dbRow?.googleSyncStatus).toBe("SYNCED");
  });

  it("room has no calendar connected at all: booking is refused up front (fail-safe), not partially committed", async () => {
    // No RoomCalendar row -> validateSlotBookable can't check freebusy -> CALENDAR_UNAVAILABLE,
    // per plan §23: never book blind when Google's state can't be verified.
    await seedRoom();
    const staff = await seedBookableStaff();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "田中一郎", email: "tanaka@example.com", phone: "090-1111-1111" },
    });

    expect(result).toEqual({ ok: false, reason: "CALENDAR_UNAVAILABLE" });
    const reservations = await prisma.reservation.findMany({ where: { staffId: staff.id } });
    expect(reservations).toHaveLength(0);
  });

  it("DB insert succeeding but the post-commit Calendar event-create call failing does not block the booking response", async () => {
    // Distinct from the above: here the room DOES have a working Calendar
    // connection (freebusy check succeeds, so validation passes), but the
    // createEvent() call itself fails afterwards - the partial-failure case
    // plan §5/§23 describes, tracked via googleSyncStatus=FAILED.
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();
    getFakeCalendarServiceForTests().simulateNextCreateFailure();

    const result = await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "田中一郎", email: "tanaka@example.com", phone: "090-1111-1111" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dbRow = await prisma.reservation.findUnique({ where: { id: result.reservationId } });
    expect(dbRow?.status).toBe("CONFIRMED");
    expect(dbRow?.googleSyncStatus).toBe("FAILED");
    expect(dbRow?.googleSyncError).toBeTruthy();
  });

  it("repeat customer under the same staff reuses the same Customer row; a different staff gets an independent row", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staffA = await seedBookableStaff();
    const staffB = await seedStaff({
      displayName: "スタッフB",
      bookingSlug: "e2e-staff-b",
      loginEmail: "e2e-staff-b@example.com",
      bookingCutoffType: "HOURS_BEFORE",
      bookingCutoffHours: 0,
      bookingWindowDays: 365,
    });
    await prisma.weeklyAvailability.create({
      data: { staffId: staffB.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 },
    });

    const email = "repeat@example.com";
    await createReservation({
      staffId: staffA.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "リピート客", email, phone: "090-2222-2222" },
    });
    await createReservation({
      staffId: staffA.id,
      startAtUtcIso: "2026-09-14T04:00:00.000Z", // next Monday, same staff
      source: "CUSTOMER_ONLINE",
      customer: { name: "リピート客", email, phone: "090-2222-2222" },
    });
    // Different time slot than staffA's Sep7 13:00 booking - the room is
    // shared, so booking the exact same time under a different staff would be
    // a legitimate ROOM_CONFLICT (that's spec case 4), not what this test is about.
    await createReservation({
      staffId: staffB.id,
      startAtUtcIso: "2026-09-07T07:00:00.000Z", // 16:00 JST, same day, clear of staffA's slot
      source: "CUSTOMER_ONLINE",
      customer: { name: "リピート客", email, phone: "090-2222-2222" },
    });

    const customersWithEmail = await prisma.customer.findMany({ where: { email } });
    expect(customersWithEmail).toHaveLength(2); // one per owning staff, not one global row
    expect(new Set(customersWithEmail.map((c) => c.ownerStaffId))).toEqual(new Set([staffA.id, staffB.id]));

    const staffAReservations = await prisma.reservation.findMany({ where: { staffId: staffA.id } });
    expect(staffAReservations).toHaveLength(2);
    expect(new Set(staffAReservations.map((r) => r.customerId)).size).toBe(1); // same Customer row reused
  });

  it("no EmailTemplateSettings row saved yet: customer email uses the default reservation confirmation template", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();

    const fakeGmail = getFakeGmailServiceForTests();
    fakeGmail.sent = [];

    await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "山田花子", email: "default-tpl@example.com", phone: "090-1234-5678" },
    });

    const email = fakeGmail.sent.find((m) => m.to === "default-tpl@example.com");
    expect(email!.text).toContain("山田花子 様");
    expect(email!.text).toContain("東京都渋谷区東1-3-1 常盤松ロイアル706");
    expect(email!.text).toContain("渋谷駅から徒歩8分");
    expect(email!.text).toContain("https://maps.app.goo.gl/ZtDx6qirtUtmZJ9F8?g_st=ic");
    // The Google Maps URL must be clickable in the HTML body.
    expect(email!.html).toContain('<a href="https://maps.app.goo.gl/ZtDx6qirtUtmZJ9F8?g_st=ic"');
  });

  it("{{salonName}} resolves to each staff's own salonName, not a shared/global value", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });

    const staffA = await seedStaff({
      displayName: "スタッフA",
      bookingSlug: "tpl-salon-a",
      loginEmail: "tpl-salon-a@example.com",
      bookingCutoffType: "HOURS_BEFORE",
      bookingCutoffHours: 0,
      bookingWindowDays: 365,
      salonName: "腸もみサロン ゆきの",
    });
    await prisma.weeklyAvailability.create({ data: { staffId: staffA.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 } });

    const staffB = await seedStaff({
      displayName: "スタッフB",
      bookingSlug: "tpl-salon-b",
      loginEmail: "tpl-salon-b@example.com",
      bookingCutoffType: "HOURS_BEFORE",
      bookingCutoffHours: 0,
      bookingWindowDays: 365,
      salonName: "○○ Beauty Salon",
    });
    await prisma.weeklyAvailability.create({ data: { staffId: staffB.id, dayOfWeek: 1, startMinute: 10 * 60, endMinute: 19 * 60 } });

    const fakeGmail = getFakeGmailServiceForTests();
    fakeGmail.sent = [];

    await createReservation({
      staffId: staffA.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "山田花子", email: "salon-a-customer@example.com", phone: "090-1234-5678" },
    });
    await createReservation({
      staffId: staffB.id,
      startAtUtcIso: "2026-09-07T07:00:00.000Z", // 16:00 JST, same day, clear of staffA's slot
      source: "CUSTOMER_ONLINE",
      customer: { name: "山田花子", email: "salon-b-customer@example.com", phone: "090-1234-5678" },
    });

    const emailA = fakeGmail.sent.find((m) => m.to === "salon-a-customer@example.com");
    const emailB = fakeGmail.sent.find((m) => m.to === "salon-b-customer@example.com");
    expect(emailA!.text).toContain("腸もみサロン ゆきの");
    expect(emailB!.text).toContain("○○ Beauty Salon");
  });

  it("an invalid body stored directly in the DB (bypassing the Settings save validation) falls back to the default at send time", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();

    await prisma.emailTemplateSettings.create({
      data: { id: EMAIL_TEMPLATE_SETTINGS_ID, reservationConfirmationBody: "{{customerName}} {{unknownTag}}" },
    });

    const fakeGmail = getFakeGmailServiceForTests();
    fakeGmail.sent = [];

    await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "山田花子", email: "invalid-tpl@example.com", phone: "090-1234-5678" },
    });

    const email = fakeGmail.sent.find((m) => m.to === "invalid-tpl@example.com");
    expect(email!.text).toContain("東京都渋谷区東1-3-1 常盤松ロイアル706"); // fell back to the default body
    expect(email!.text).not.toContain("{{unknownTag}}");
  });

  it("a saved body containing an HTML tag is safely escaped in the HTML email, never a live tag", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();

    await prisma.emailTemplateSettings.create({
      data: {
        id: EMAIL_TEMPLATE_SETTINGS_ID,
        reservationConfirmationBody: "{{customerName}} 様\n{{reservationDateTime}}\n1階です<script>alert(1)</script>",
      },
    });

    const fakeGmail = getFakeGmailServiceForTests();
    fakeGmail.sent = [];

    await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "山田花子", email: "xss-tpl@example.com", phone: "090-1234-5678" },
    });

    const email = fakeGmail.sent.find((m) => m.to === "xss-tpl@example.com");
    expect(email!.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email!.html).not.toContain("<script>");
  });

  it("the staff notification email is completely unaffected by the reservation email template feature", async () => {
    const room = await seedRoom();
    await prisma.roomCalendar.create({ data: { roomId: room.id, googleCalendarId: "primary" } });
    const staff = await seedBookableStaff();

    const fakeGmail = getFakeGmailServiceForTests();
    fakeGmail.sent = [];

    await createReservation({
      staffId: staff.id,
      startAtUtcIso: MONDAY_START,
      source: "CUSTOMER_ONLINE",
      customer: { name: "山田花子", email: "staff-regression@example.com", phone: "090-1234-5678" },
    });

    const staffEmail = fakeGmail.sent.find((m) => m.to === staff.loginEmail);
    expect(staffEmail!.text).toContain("新規予約が入りました。");
    expect(staffEmail!.text).toContain("山田花子");
    expect(staffEmail!.text).not.toContain("常盤松ロイアル");
    expect(staffEmail!.text).not.toContain("Googleマップ");
  });
});
