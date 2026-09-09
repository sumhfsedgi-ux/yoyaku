import { formatRangeForStaff } from "@/lib/time/tz";
import { plainTextToHtml } from "@/lib/email/plainTextToHtml";
import { renderReservationEmailTemplate, type ReservationEmailVariables } from "@/lib/email/reservationEmailTemplate";
import type { SendEmailInput } from "./port";

/** Fixed, not editable from Settings - only the body is (see actions/emailTemplateSettings.ts). */
const RESERVATION_CONFIRMATION_SUBJECT = "【ご予約確定】ご予約ありがとうございます";

/**
 * Customer confirmation email. `bodyTemplate` must already be resolved via
 * getReservationConfirmationBodyForSending() (DB value, defensively
 * re-validated, or the default) - this function only renders it, it doesn't
 * know about Prisma/DB fallback.
 */
export function buildCustomerConfirmationEmail(params: {
  to: string;
  bodyTemplate: string;
  variables: ReservationEmailVariables;
}): SendEmailInput {
  const text = renderReservationEmailTemplate(params.bodyTemplate, params.variables);

  return {
    to: params.to,
    subject: RESERVATION_CONFIRMATION_SUBJECT,
    text,
    html: plainTextToHtml(text),
  };
}

/** Staff notification email. Full detail, including the end time - this is internal, not customer-facing. */
export function buildStaffNotificationEmail(params: {
  to: string;
  staffDisplayName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  startAt: Date;
  endAt: Date;
}): SendEmailInput {
  const range = formatRangeForStaff(params.startAt, params.endAt);
  const text = `新規予約が入りました。

日時: ${range}
お客様名: ${params.customerName}
メール: ${params.customerEmail}
電話番号: ${params.customerPhone}`;

  const html = `<p>新規予約が入りました。</p>
<table>
<tr><td>日時</td><td>${range}</td></tr>
<tr><td>お客様名</td><td>${params.customerName}</td></tr>
<tr><td>メール</td><td>${params.customerEmail}</td></tr>
<tr><td>電話番号</td><td>${params.customerPhone}</td></tr>
</table>`;

  return {
    to: params.to,
    subject: "【新規予約】新しいご予約が入りました",
    text,
    html,
  };
}
