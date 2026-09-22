import type { LineMessagingService, PushLineMessageInput } from "./port";

/**
 * In-memory LINE Messaging service for local development and tests. Only
 * ever selected by getLineMessagingService() (see ./factory.ts) when
 * ALLOW_FAKE_LINE_SERVICES=true, which must never be set in production.
 * Records pushed messages so tests can assert on them, and supports failure
 * injection - same shape as FakeGmailService (lib/google/gmail/fake.ts).
 */
export class FakeLineMessagingService implements LineMessagingService {
  sent: PushLineMessageInput[] = [];
  private failNext = false;

  simulateNextSendFailure() {
    this.failNext = true;
  }

  /** Clears push history. Call between tests - this instance is a module-level singleton (see ./factory.ts). */
  reset() {
    this.sent = [];
    this.failNext = false;
  }

  async pushMessage(input: PushLineMessageInput) {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false as const, error: "simulated failure" };
    }
    this.sent.push(input);
    const maskedTo = input.to.length > 4 ? `${input.to.slice(0, 4)}***` : "***";
    console.log(`[FakeLineMessagingService] would push to ${maskedTo}`);
    return { ok: true as const };
  }
}
