import type { GmailService, SendEmailInput } from "./port";

/**
 * In-memory Gmail service for local development and tests. Only ever selected
 * by getGmailService() (see ./factory.ts) when ALLOW_FAKE_GOOGLE_SERVICES=true,
 * which must never be set in production. Records sent messages so tests can
 * assert on them, and supports failure injection to exercise the "email failed
 * but booking still succeeds" best-effort path.
 */
export class FakeGmailService implements GmailService {
  sent: SendEmailInput[] = [];
  private failNext = false;

  simulateNextSendFailure() {
    this.failNext = true;
  }

  /** Clears sent-message history. Call between tests - this instance is a module-level singleton (see ./factory.ts). */
  reset() {
    this.sent = [];
    this.failNext = false;
  }

  async sendEmail(input: SendEmailInput) {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false as const, error: "simulated failure" };
    }
    this.sent.push(input);
    const maskedTo = input.to.replace(/^(.).*(@.*)$/, "$1***$2");
    console.log(`[FakeGmailService] would send to ${maskedTo}: ${input.subject}`);
    return { ok: true as const };
  }
}
