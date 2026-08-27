import type { GmailService } from "./port";
import { FakeGmailService } from "./fake";
import { RealGmailService } from "./real";

let fakeSingleton: FakeGmailService | undefined;
let realSingleton: RealGmailService | undefined;

/** Same selection rule as getCalendarService() - see calendar/factory.ts for the full rationale. */
export function getGmailService(): GmailService {
  const allowFake = process.env.ALLOW_FAKE_GOOGLE_SERVICES === "true";
  const wantFakeForDev = allowFake && process.env.GOOGLE_CALENDAR_ENABLED !== "true";

  if (wantFakeForDev) {
    return (fakeSingleton ??= new FakeGmailService());
  }
  return (realSingleton ??= new RealGmailService());
}

export function getFakeGmailServiceForTests(): FakeGmailService {
  return (fakeSingleton ??= new FakeGmailService());
}
