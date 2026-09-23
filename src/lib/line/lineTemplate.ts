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

/**
 * Staff-facing (not customer-facing) push sent to every
 * LINE_STAFF_NOTIFICATION_USER_IDS entry when a new CUSTOMER_ONLINE
 * reservation is confirmed for LINE_ENABLED_STAFF_ID - see
 * lib/reservations/service.ts's sendBookingNotificationsBestEffort and
 * lib/reservations/lineNotifications.ts's STAFF_NEW_RESERVATION type.
 * Deliberately code-only for Phase 1, not Settings-editable like the two
 * bodies above - reuses the exact same {{tag}} substitution
 * (renderReservationEmailTemplate) but intentionally carries only
 * customerName/reservationDateTime/salonName, never email/phone/LINE
 * userId/chart notes - a staff member only needs "誰の何時の予約か" from
 * this push.
 */
export const DEFAULT_STAFF_NEW_RESERVATION_MESSAGE = `【新規予約が入りました📅】

お客様：{{customerName}} 様
予約日時：{{reservationDateTime}}
サロン：{{salonName}}

予約管理画面からご確認ください。`;
