import { prisma } from "@/lib/db/prisma";
import { validateReservationEmailTemplate } from "@/lib/email/reservationEmailTemplate";
import { DEFAULT_LINE_REMINDER_BODY } from "./lineTemplate";

export const LINE_TEMPLATE_SETTINGS_ID = "main";

async function getStoredReminderBody(): Promise<string | null> {
  const row = await prisma.lineTemplateSettings.findUnique({ where: { id: LINE_TEMPLATE_SETTINGS_ID } });
  return row?.reminderBody ?? null;
}

/**
 * Reminder Cron send path only. Mirrors
 * getReservationConfirmationBodyForSending() (lib/email/emailTemplateSettings.ts):
 * re-validates at send time and falls back to the default if the stored body
 * is missing or fails validation, so the reminder send never breaks because
 * of a bad template. No PII is ever logged here, only a static warning.
 *
 * The booking-confirmation body has no equivalent here - see
 * getReservationConfirmationBodyForSending, which both Gmail and (for
 * LINE-linked customers) the LINE confirmation push use directly.
 */
export async function getLineReminderBodyForSending(): Promise<string> {
  const stored = await getStoredReminderBody();
  if (stored === null) return DEFAULT_LINE_REMINDER_BODY;
  const check = validateReservationEmailTemplate(stored);
  if (!check.ok) {
    console.warn("invalid line reminder template; using default");
    return DEFAULT_LINE_REMINDER_BODY;
  }
  return stored;
}

/**
 * Settings edit screen only. Unlike the send path, this never silently
 * substitutes the default for an existing-but-invalid row - it always shows
 * exactly what's stored so a staff member can see and fix it. Only a
 * genuinely missing row falls back to the default (nothing saved yet).
 */
export async function getLineReminderBodyForEditing(): Promise<string> {
  return (await getStoredReminderBody()) ?? DEFAULT_LINE_REMINDER_BODY;
}
