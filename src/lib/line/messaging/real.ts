import { isLineRecipientAllowedInCurrentMode } from "@/lib/line/staffRecipients";
import type { LineMessagingService, PushLineMessageInput } from "./port";

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

function describeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

function maskRecipient(to: string): string {
  return to.length > 4 ? `${to.slice(0, 4)}***` : "***";
}

/**
 * Real LINE Messaging API push sender. Never throws - callers (see
 * lib/reservations/lineNotifications.ts) treat a LINE push as a best-effort
 * side effect and must not let a send failure affect the booking response or
 * the Cron's own success. Uses a single plain `fetch` call (Bearer-token
 * REST, no OAuth dance) rather than the `@line/bot-sdk` package - unlike
 * Gmail/Calendar (which need `googleapis` for full OAuth), Messaging API push
 * only needs a static long-lived Channel Access Token, so no SDK dependency
 * is justified for one endpoint (see plan §26).
 *
 * LINE_NOTIFICATION_MODE is enforced HERE as a second guard (see plan §17
 * "dual guard") even though callers are also expected to filter their target
 * list by mode before ever constructing a claim - this is the last line of
 * defense against ever pushing to a real customer while not in production
 * mode, or at all while disabled. The actual allow/deny policy for "which
 * recipient is reachable in test mode" is NOT duplicated here - it lives in
 * lib/line/staffRecipients.ts's isLineRecipientAllowedInCurrentMode, the
 * same function lib/reservations/lineNotifications.ts's guard 1 calls, so
 * the two guards can never drift out of sync on who they allow.
 */
export class RealLineMessagingService implements LineMessagingService {
  async pushMessage(input: PushLineMessageInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const mode = process.env.LINE_NOTIFICATION_MODE ?? "off";
    if (mode === "off") return { ok: false, error: "LINE_DISABLED" };
    if (!isLineRecipientAllowedInCurrentMode(input.to)) {
      return { ok: false, error: "TEST_MODE_BLOCKED_NON_TEST_RECIPIENT" };
    }

    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!accessToken) return { ok: false, error: "LINE_NOT_CONFIGURED" };

    try {
      const response = await fetch(LINE_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Line-Retry-Key": input.retryKey,
        },
        body: JSON.stringify({ to: input.to, messages: [{ type: "text", text: input.text }] }),
      });

      if (response.ok) return { ok: true };

      if (response.status === 409) {
        // A request with this exact retry key was already accepted by the
        // LINE Platform - either our previous attempt actually went through
        // (e.g. our own fetch timed out waiting for the response) or a
        // concurrent attempt is in flight. Either way, resending now risks a
        // real duplicate message to the customer, so this is treated as
        // already-sent rather than as a fresh failure (see plan §14). Never
        // logs the raw userId.
        console.warn(`[RealLineMessagingService] retry key already accepted (409) for ${maskRecipient(input.to)}, treating as sent`);
        return { ok: true };
      }

      const bodyText = await response.text().catch(() => "");
      return { ok: false, error: `LINE_PUSH_${response.status}: ${bodyText.slice(0, 300)}` };
    } catch (err) {
      return { ok: false, error: `LINE_PUSH_REQUEST_FAILED: ${describeError(err)}` };
    }
  }
}
