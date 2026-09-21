/**
 * LINE reminder default body. Deliberately reuses the exact same {{tag}} set,
 * renderer, and validator as the Gmail confirmation template (see
 * lib/email/reservationEmailTemplate.ts) - the tags mean the same thing for
 * both channels, so there is no LINE-specific tag list, render function, or
 * validation rule. HTML generation (lib/email/plainTextToHtml.ts) is not used
 * here - LINE messages are sent as plain text.
 *
 * There is no DEFAULT_LINE_CONFIRMATION_BODY: the booking-confirmation
 * message is a single shared body maintained in one place
 * (EmailTemplateSettings.reservationConfirmationBody /
 * DEFAULT_RESERVATION_CONFIRMATION_BODY), sent as-is to both Gmail and,
 * for LINE-linked customers, as the LINE push text - see
 * lib/reservations/service.ts's sendBookingNotificationsBestEffort.
 */

export const DEFAULT_LINE_REMINDER_BODY = `{{customerName}} 様

明日のご予約についてのお知らせです🌿

■ ご予約日時
{{reservationDateTime}}

■ サロン
{{salonName}}

明日お会いできるのを楽しみにしております。`;
