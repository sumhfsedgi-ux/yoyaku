import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_RESERVATION_CONFIRMATION_BODY } from "@/lib/email/reservationEmailTemplate";
import { resetDb, seedStaff } from "../../helpers/db";

/**
 * The reservation confirmation email body is a shared, non-owned resource -
 * unlike salonName (per-staff), any logged-in staff can read/write the same
 * row. Same vi.mock("next-auth") + sessionAs() technique as salon-name.test.ts.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

async function sessionAs(staffId: string) {
  const { getServerSession } = await import("next-auth");
  vi.mocked(getServerSession).mockResolvedValue({
    user: { name: "Test", email: "test@example.com" },
    staffId,
    mustChangePassword: false,
  } as never);
}

describe("Shared reservation confirmation email template", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("unauthenticated get/update are both rejected", async () => {
    const { getMyReservationEmailTemplate, updateReservationEmailTemplate } = await import("@/actions/emailTemplateSettings");

    await expect(getMyReservationEmailTemplate()).rejects.toThrow();
    await expect(updateReservationEmailTemplate({ body: "{{customerName}} {{reservationDateTime}}" })).rejects.toThrow();
  });

  it("a logged-in staff can save and read back the body", async () => {
    const staff = await seedStaff({ bookingSlug: "email-tpl-a", loginEmail: "email-tpl-a@example.com" });
    const { getMyReservationEmailTemplate, updateReservationEmailTemplate } = await import("@/actions/emailTemplateSettings");

    await sessionAs(staff.id);
    const body = "{{customerName}} 様\n\n{{reservationDateTime}}\n\n{{salonName}}";
    const result = await updateReservationEmailTemplate({ body });
    expect(result).toEqual({ ok: true });

    expect(await getMyReservationEmailTemplate()).toBe(body);
  });

  it("is shared across staff - staff B reads back what staff A saved, not a per-staff copy", async () => {
    const staffA = await seedStaff({ bookingSlug: "email-tpl-b1", loginEmail: "email-tpl-b1@example.com" });
    const staffB = await seedStaff({ bookingSlug: "email-tpl-b2", loginEmail: "email-tpl-b2@example.com" });
    const { getMyReservationEmailTemplate, updateReservationEmailTemplate } = await import("@/actions/emailTemplateSettings");

    await sessionAs(staffA.id);
    const body = "{{customerName}} 様 {{reservationDateTime}}";
    await updateReservationEmailTemplate({ body });

    await sessionAs(staffB.id);
    expect(await getMyReservationEmailTemplate()).toBe(body);
  });

  it("no row saved yet: getMyReservationEmailTemplate returns the default body", async () => {
    const staff = await seedStaff({ bookingSlug: "email-tpl-default", loginEmail: "email-tpl-default@example.com" });
    const { getMyReservationEmailTemplate } = await import("@/actions/emailTemplateSettings");

    await sessionAs(staff.id);
    expect(await getMyReservationEmailTemplate()).toBe(DEFAULT_RESERVATION_CONFIRMATION_BODY);
  });

  it("rejects an unknown tag with its name", async () => {
    const staff = await seedStaff({ bookingSlug: "email-tpl-unknown", loginEmail: "email-tpl-unknown@example.com" });
    const { updateReservationEmailTemplate } = await import("@/actions/emailTemplateSettings");

    await sessionAs(staff.id);
    const result = await updateReservationEmailTemplate({ body: "{{customerName}} {{reservationDateTime}} {{foo}}" });
    expect(result).toEqual({ ok: false, reason: "UNKNOWN_TAG", tag: "foo" });
  });

  it("rejects a body missing {{customerName}}", async () => {
    const staff = await seedStaff({ bookingSlug: "email-tpl-noname", loginEmail: "email-tpl-noname@example.com" });
    const { updateReservationEmailTemplate } = await import("@/actions/emailTemplateSettings");

    await sessionAs(staff.id);
    const result = await updateReservationEmailTemplate({ body: "{{reservationDateTime}}" });
    expect(result).toEqual({ ok: false, reason: "MISSING_CUSTOMER_NAME" });
  });

  it("rejects a body with no way to derive both a date and a start time", async () => {
    const staff = await seedStaff({ bookingSlug: "email-tpl-nodate", loginEmail: "email-tpl-nodate@example.com" });
    const { updateReservationEmailTemplate } = await import("@/actions/emailTemplateSettings");

    await sessionAs(staff.id);
    const result = await updateReservationEmailTemplate({ body: "{{customerName}} {{reservationTime}}" });
    expect(result).toEqual({ ok: false, reason: "MISSING_DATETIME" });
  });
});
