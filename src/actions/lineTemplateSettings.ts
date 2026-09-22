"use server";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { requireStaffSession } from "@/lib/auth/session";
import { reservationEmailTemplateInputSchema } from "@/lib/validation/schemas";
import { validateReservationEmailTemplate, renderReservationEmailTemplate, SAMPLE_RESERVATION_EMAIL_VARIABLES } from "@/lib/email/reservationEmailTemplate";
import { LINE_TEMPLATE_SETTINGS_ID, getLineReminderBodyForEditing } from "@/lib/line/lineTemplateSettings";
import { getLineMessagingService } from "@/lib/line/messaging/factory";
import { isLineNotificationEnabledForStaff } from "@/lib/line/staffGate";

/**
 * No targetStaffId param - LineTemplateSettings is a shared, non-owned
 * resource (all staff see/edit the same reminder body), same
 * requireStaffSession()-only gate as actions/emailTemplateSettings.ts.
 *
 * The booking-confirmation message has no action here at all - it is edited
 * via actions/emailTemplateSettings.ts's updateReservationEmailTemplate, and
 * that same saved body is sent as both the Gmail confirmation and, for
 * LINE-linked customers, the LINE confirmation push (see
 * lib/reservations/service.ts). This file only ever covers the day-before
 * LINE reminder, plus the shared test-send/availability helpers used by
 * BOTH the email form (for the now-shared confirmation body) and the
 * reminder form below.
 */

/** Test-send buttons must only ever exist where they cannot reach a real customer - never a UI-only check (plan §15/§17). */
function isLineTestSendAvailable(): boolean {
  return process.env.VERCEL_ENV !== "production" && process.env.LINE_NOTIFICATION_MODE !== "production";
}

export interface LineSettingsPageData {
  reminderBody: string;
  /**
   * Phase 1 staff scope (see lib/line/staffGate.ts) - true only when the
   * CALLING staff (from their own session, never a client-supplied id) is
   * the one LINE is enabled for. settings/page.tsx uses this to decide
   * whether to render the LINE reminder card at all - every other staff
   * sees no LINE-related UI.
   */
  lineEnabledForThisStaff: boolean;
  /** Server-computed - the Settings page renders test-send buttons (on both this form and the shared email/confirmation form) only when this is true, and the actions below re-check it independently. Already implies lineEnabledForThisStaff. */
  testSendAvailable: boolean;
}

export async function getMyLineTemplateSettings(): Promise<LineSettingsPageData> {
  const session = await requireStaffSession();
  const reminderBody = await getLineReminderBodyForEditing();
  const lineEnabledForThisStaff = isLineNotificationEnabledForStaff(session.staffId);
  return { reminderBody, lineEnabledForThisStaff, testSendAvailable: lineEnabledForThisStaff && isLineTestSendAvailable() };
}

export type UpdateLineReminderTemplateResult =
  | { ok: true }
  | { ok: false; reason: "VALIDATION_ERROR" }
  | { ok: false; reason: "UNKNOWN_TAG"; tag: string }
  | { ok: false; reason: "MISSING_CUSTOMER_NAME" | "MISSING_DATETIME" };

export async function updateLineReminderTemplate(input: { body: string }): Promise<UpdateLineReminderTemplateResult> {
  await requireStaffSession();

  const parsed = reservationEmailTemplateInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "VALIDATION_ERROR" };

  const check = validateReservationEmailTemplate(parsed.data.body);
  if (!check.ok) return check;

  await prisma.lineTemplateSettings.upsert({
    where: { id: LINE_TEMPLATE_SETTINGS_ID },
    update: { reminderBody: parsed.data.body },
    create: { id: LINE_TEMPLATE_SETTINGS_ID, reminderBody: parsed.data.body },
  });
  return { ok: true };
}

/**
 * Sends exactly one real LINE push to LINE_TEST_USER_ID, rendering whatever
 * draft text is currently in the caller's Settings textarea (not necessarily
 * saved yet) with sample variables - mirrors sendGoogleGmailTestEmail's "send
 * exactly one real message when explicitly invoked" shape
 * (actions/googleConnection.ts). Re-checks the Phase 1 staff scope (see
 * lib/line/staffGate.ts), isLineTestSendAvailable(), and the configured
 * recipient itself server-side - a hidden/removed button on the client can
 * never be worked around to reach a real customer (plan §15/§17), and a
 * staff member other than the one LINE is enabled for can never trigger a
 * real send by calling this action directly either.
 */
async function sendLineTestMessage(body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireStaffSession();
  if (!isLineNotificationEnabledForStaff(session.staffId)) return { ok: false, error: "STAFF_NOT_ENABLED" };
  if (!isLineTestSendAvailable()) return { ok: false, error: "TEST_SEND_NOT_AVAILABLE" };

  const testUserId = process.env.LINE_TEST_USER_ID;
  if (!testUserId) return { ok: false, error: "LINE_TEST_USER_ID_NOT_CONFIGURED" };

  const text = renderReservationEmailTemplate(body, SAMPLE_RESERVATION_EMAIL_VARIABLES);
  // Test sends bypass the ReservationNotification claim/dedupe machinery
  // entirely (there is no Reservation to attach them to) - a fresh retryKey
  // per click is correct here since each click is a deliberate, independent
  // test send, not a system-triggered notification needing de-duplication.
  return getLineMessagingService().pushMessage({ to: testUserId, text, retryKey: randomUUID() });
}

/** Called from the shared booking-confirmation form (email) - see actions/emailTemplateSettings.ts / ReservationEmailTemplateForm.tsx. */
export async function sendLineConfirmationTestMessage(body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return sendLineTestMessage(body);
}

export async function sendLineReminderTestMessage(body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return sendLineTestMessage(body);
}
