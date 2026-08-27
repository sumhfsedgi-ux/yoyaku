import { formatRangeForStaff, formatStartTimeForCustomer } from "@/lib/time/tz";
import type { SendEmailInput } from "./port";

/**
 * Customer confirmation email. Deliberately shows ONLY the start time (e.g.
 * "8月30日 13:00〜"), never the end time - the system tracks the full 90-minute
 * appointment internally, but that duration must never appear in customer-facing
 * copy (see plan §18).
 */
export function buildCustomerConfirmationEmail(params: {
  to: string;
  customerName: string;
  staffDisplayName: string;
  startAt: Date;
}): SendEmailInput {
  const when = formatStartTimeForCustomer(params.startAt);
  const text = `${params.customerName} 様

ご予約ありがとうございます。

ご予約日時
${when}

ご予約を承りました。当日お待ちしております。`;

  const html = `<p>${params.customerName} 様</p>
<p>ご予約ありがとうございます。</p>
<p><strong>ご予約日時</strong><br>${when}</p>
<p>ご予約を承りました。当日お待ちしております。</p>`;

  return {
    to: params.to,
    subject: "【ご予約確定】ご予約ありがとうございます",
    text,
    html,
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
