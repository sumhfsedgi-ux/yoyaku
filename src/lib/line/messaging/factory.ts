import type { LineMessagingService } from "./port";
import { FakeLineMessagingService } from "./fake";
import { RealLineMessagingService } from "./real";

let fakeSingleton: FakeLineMessagingService | undefined;
let realSingleton: RealLineMessagingService | undefined;

/**
 * Selects the LINE Messaging implementation. Same selection rule as
 * getGmailService()/getCalendarService() (see lib/google/gmail/factory.ts,
 * lib/google/calendar/factory.ts):
 * the fake is only ever reachable when ALLOW_FAKE_LINE_SERVICES=true (local
 * dev / .env.test) - which must never be set in production. When unset/false,
 * this always returns RealLineMessagingService, which internally enforces
 * LINE_NOTIFICATION_MODE (off/test/production) regardless of environment.
 */
export function getLineMessagingService(): LineMessagingService {
  const allowFake = process.env.ALLOW_FAKE_LINE_SERVICES === "true";
  if (allowFake) {
    return (fakeSingleton ??= new FakeLineMessagingService());
  }
  return (realSingleton ??= new RealLineMessagingService());
}

/** Test-only escape hatch to reach into the fake's seeding/inspection methods. */
export function getFakeLineMessagingServiceForTests(): FakeLineMessagingService {
  return (fakeSingleton ??= new FakeLineMessagingService());
}
