"use server";

import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { reservationEmailTemplateInputSchema } from "@/lib/validation/schemas";
import { validateReservationEmailTemplate } from "@/lib/email/reservationEmailTemplate";
import { EMAIL_TEMPLATE_SETTINGS_ID, getReservationConfirmationBodyForEditing } from "@/lib/email/emailTemplateSettings";

/**
 * No targetStaffId param - this is a shared, non-owned resource (all staff
 * see/edit the same template), same requireStaffSession()-only gate as
 * testGoogleCalendarConnection/testGoogleGmailConnection in
 * actions/googleConnection.ts. Unauthenticated calls are rejected by
 * requireStaffSession()'s redirect.
 */

export async function getMyReservationEmailTemplate(): Promise<string> {
  await requireStaffSession();
  return getReservationConfirmationBodyForEditing();
}

export type UpdateReservationEmailTemplateResult =
  | { ok: true }
  | { ok: false; reason: "VALIDATION_ERROR" }
  | { ok: false; reason: "UNKNOWN_TAG"; tag: string }
  | { ok: false; reason: "MISSING_CUSTOMER_NAME" | "MISSING_DATETIME" };

export async function updateReservationEmailTemplate(input: { body: string }): Promise<UpdateReservationEmailTemplateResult> {
  await requireStaffSession();
  const parsed = reservationEmailTemplateInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "VALIDATION_ERROR" };

  const tagCheck = validateReservationEmailTemplate(parsed.data.body);
  if (!tagCheck.ok) return tagCheck;

  await prisma.emailTemplateSettings.upsert({
    where: { id: EMAIL_TEMPLATE_SETTINGS_ID },
    update: { reservationConfirmationBody: parsed.data.body },
    create: { id: EMAIL_TEMPLATE_SETTINGS_ID, reservationConfirmationBody: parsed.data.body },
  });
  return { ok: true };
}
