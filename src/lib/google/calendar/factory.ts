import type { CalendarService } from "./port";
import { FakeCalendarService } from "./fake";
import { RealCalendarService } from "./real";

let fakeSingleton: FakeCalendarService | undefined;
let realSingleton: RealCalendarService | undefined;

/**
 * Selects the Calendar implementation. Fakes are only ever reachable when
 * ALLOW_FAKE_GOOGLE_SERVICES=true (local dev / .env.test) AND
 * GOOGLE_CALENDAR_ENABLED is not "true" - that second flag lets a developer
 * opt back into the real service locally (e.g. to manually test against a
 * connected account) without touching ALLOW_FAKE_GOOGLE_SERVICES.
 *
 * ALLOW_FAKE_GOOGLE_SERVICES must never be set in production - see
 * .env.example. When it is unset/false, this ALWAYS returns RealCalendarService,
 * even if Google has never been connected: RealCalendarService's own methods
 * detect that and return {ok:false, error:'GOOGLE_NOT_CONFIGURED'} rather than
 * silently falling back to a fake that would let bookings through without a
 * real double-booking check. See tests/unit/google/factory.test.ts.
 */
export function getCalendarService(): CalendarService {
  const allowFake = process.env.ALLOW_FAKE_GOOGLE_SERVICES === "true";
  const wantFakeForDev = allowFake && process.env.GOOGLE_CALENDAR_ENABLED !== "true";

  if (wantFakeForDev) {
    return (fakeSingleton ??= new FakeCalendarService());
  }
  return (realSingleton ??= new RealCalendarService());
}

/** Test-only escape hatch to reach into the fake's seeding/inspection methods. */
export function getFakeCalendarServiceForTests(): FakeCalendarService {
  return (fakeSingleton ??= new FakeCalendarService());
}
