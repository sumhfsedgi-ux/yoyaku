export interface PushLineMessageInput {
  /** LINE-verified userId (see lib/line/identity.ts) - never a raw client-supplied string. */
  to: string;
  text: string;
  /**
   * UUID generated once when the ReservationNotification row is claimed
   * (see lib/reservations/lineNotifications.ts) and reused for every send
   * attempt against that same row. Passed as LINE Messaging API's
   * X-Line-Retry-Key header so the LINE Platform itself de-duplicates a
   * retried request, independent of this app's own DB unique constraint.
   */
  retryKey: string;
}

/**
 * Sends a LINE push message via the salon's Messaging API channel. Never
 * throws - failures are always {ok:false}, since a LINE send is a best-effort
 * side effect (of booking confirmation or the reminder Cron) and must never
 * be allowed to fail the caller's own success path. Mirrors GmailService's
 * contract exactly (see lib/google/gmail/port.ts).
 *
 * Implementations MUST enforce LINE_NOTIFICATION_MODE (off/test/production)
 * internally as a second guard, even though callers are also expected to
 * filter their target list by mode before ever reaching this call (see
 * lib/reservations/lineNotifications.ts) - see plan §17 "dual guard".
 */
export interface LineMessagingService {
  pushMessage(input: PushLineMessageInput): Promise<{ ok: true } | { ok: false; error: string }>;
}
