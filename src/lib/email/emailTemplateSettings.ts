import { prisma } from "@/lib/db/prisma";
import { DEFAULT_RESERVATION_CONFIRMATION_BODY, validateReservationEmailTemplate } from "./reservationEmailTemplate";

export const EMAIL_TEMPLATE_SETTINGS_ID = "main";

async function getStoredBody(): Promise<string | null> {
  const row = await prisma.emailTemplateSettings.findUnique({ where: { id: EMAIL_TEMPLATE_SETTINGS_ID } });
  return row?.reservationConfirmationBody ?? null;
}

/**
 * Send path only. The Settings save action already runs
 * validateReservationEmailTemplate(), but a hand-edited DB row (or a future
 * migration that touches this table) could still leave an invalid body here
 * - re-validating at send time and falling back to the default keeps booking
 * emails working regardless. No PII (customerName/body/email) is ever logged
 * here, only a static warning.
 */
export async function getReservationConfirmationBodyForSending(): Promise<string> {
  const stored = await getStoredBody();
  if (stored === null) return DEFAULT_RESERVATION_CONFIRMATION_BODY;
  const check = validateReservationEmailTemplate(stored);
  if (!check.ok) {
    console.warn("invalid reservation email template; using default");
    return DEFAULT_RESERVATION_CONFIRMATION_BODY;
  }
  return stored;
}

/**
 * Settings edit screen only. Unlike the send path, this never silently
 * substitutes the default for an existing-but-invalid row - it always shows
 * exactly what's stored so a staff member can see and fix it, rather than
 * unknowingly overwriting their own saved text with the default on next save.
 * Only a genuinely missing row falls back to the default (nothing saved yet).
 */
export async function getReservationConfirmationBodyForEditing(): Promise<string> {
  return (await getStoredBody()) ?? DEFAULT_RESERVATION_CONFIRMATION_BODY;
}
