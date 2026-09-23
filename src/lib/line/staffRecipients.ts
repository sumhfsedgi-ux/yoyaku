/**
 * Server-only staff push notification recipients (see plan: "腸もみサロン
 * ゆきの" スタッフ向け新規予約LINE通知). LINE_STAFF_NOTIFICATION_USER_IDS is a
 * comma-separated list of LINE userIds (currently ゆきの本人 and かずき本人,
 * but this module never hardcodes who they are - see .env.example) that
 * receive a STAFF_NEW_RESERVATION push whenever a CUSTOMER_ONLINE
 * reservation is confirmed for LINE_ENABLED_STAFF_ID. Never exposed as
 * NEXT_PUBLIC_ - read only from server code.
 */
export function getStaffNotificationRecipientIds(): string[] {
  const raw = process.env.LINE_STAFF_NOTIFICATION_USER_IDS ?? "";
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return [...new Set(ids)];
}

/**
 * Single source of truth for "may `lineUserId` receive a push right now",
 * used by BOTH of the LINE-send dual guards - lib/reservations/
 * lineNotifications.ts's claimAndSendLineNotification (guard 1, before any
 * DB claim) and lib/line/messaging/real.ts's RealLineMessagingService (guard
 * 2, the final send-time check). The guard itself stays duplicated in both
 * places on purpose (defense in depth - see real.ts's own doc comment); only
 * the actual allow/deny policy lives here, so the two guards can never drift
 * out of sync with each other.
 *
 *  - off: nothing is ever allowed. (Callers additionally short-circuit
 *    mode==="off" themselves before this, for their own distinct return
 *    reason - MODE_OFF vs LINE_DISABLED - but this function is also
 *    correct/safe to call in isolation.)
 *  - production: any recipient is allowed - the mode alone governs; WHO
 *    gets targeted is entirely decided by the caller (customer's own
 *    lineUserId, or the small server-configured staff allowlist above).
 *  - test: allowed only for LINE_TEST_USER_ID (the customer-facing test
 *    target) OR any entry in LINE_STAFF_NOTIFICATION_USER_IDS. These are two
 *    independent allowlists for two independent purposes - a customer send
 *    is still never allowed to reach a staff recipient's id, or vice versa,
 *    since each call site only ever constructs a `lineUserId` from its own
 *    single relevant source (Customer.lineUserId vs this module's list).
 *    This union exists purely so staff notifications stay testable while
 *    customer-facing sends remain restricted to the developer's own test
 *    account.
 */
export function isLineRecipientAllowedInCurrentMode(lineUserId: string): boolean {
  const mode = process.env.LINE_NOTIFICATION_MODE ?? "off";
  if (mode === "off") return false;
  if (mode === "production") return true;
  return lineUserId === process.env.LINE_TEST_USER_ID || getStaffNotificationRecipientIds().includes(lineUserId);
}
