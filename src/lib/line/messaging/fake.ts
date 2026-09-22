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
  private failFor = new Set<string>();

  simulateNextSendFailure() {
    this.failNext = true;
  }

  /**
   * Fails only the next pushMessage call whose `to` matches this exact
   * recipient (one-shot, like simulateNextSendFailure), regardless of call
   * order. Needed for tests that send to multiple recipients concurrently
   * (e.g. Promise.allSettled over several staff push targets) where
   * simulateNextSendFailure's "whichever call happens to land first" isn't
   * deterministic enough to assert "recipient A succeeds, recipient B fails".
   */
  simulateFailureFor(to: string) {
    this.failFor.add(to);
  }

  /** Clears push history. Call between tests - this instance is a module-level singleton (see ./factory.ts). */
  reset() {
    this.sent = [];
    this.failNext = false;
    this.failFor.clear();
  }

  async pushMessage(input: PushLineMessageInput) {
    if (this.failFor.has(input.to)) {
      this.failFor.delete(input.to);
      return { ok: false as const, error: "simulated failure" };
    }
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
