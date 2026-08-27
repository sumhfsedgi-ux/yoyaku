import { afterEach, describe, expect, it } from "vitest";
import { getCalendarService } from "@/lib/google/calendar/factory";
import { FakeCalendarService } from "@/lib/google/calendar/fake";
import { RealCalendarService } from "@/lib/google/calendar/real";
import { getGmailService } from "@/lib/google/gmail/factory";
import { FakeGmailService } from "@/lib/google/gmail/fake";
import { RealGmailService } from "@/lib/google/gmail/real";

const ORIGINAL_ALLOW_FAKE = process.env.ALLOW_FAKE_GOOGLE_SERVICES;
const ORIGINAL_ENABLED = process.env.GOOGLE_CALENDAR_ENABLED;

afterEach(() => {
  if (ORIGINAL_ALLOW_FAKE === undefined) delete process.env.ALLOW_FAKE_GOOGLE_SERVICES;
  else process.env.ALLOW_FAKE_GOOGLE_SERVICES = ORIGINAL_ALLOW_FAKE;
  if (ORIGINAL_ENABLED === undefined) delete process.env.GOOGLE_CALENDAR_ENABLED;
  else process.env.GOOGLE_CALENDAR_ENABLED = ORIGINAL_ENABLED;
});

describe("getCalendarService / getGmailService: production must never silently fall back to Fake", () => {
  it("returns Real when ALLOW_FAKE_GOOGLE_SERVICES is unset (production-shaped env)", () => {
    delete process.env.ALLOW_FAKE_GOOGLE_SERVICES;
    delete process.env.GOOGLE_CALENDAR_ENABLED;
    expect(getCalendarService()).toBeInstanceOf(RealCalendarService);
    expect(getGmailService()).toBeInstanceOf(RealGmailService);
  });

  it('returns Real when ALLOW_FAKE_GOOGLE_SERVICES is explicitly "false"', () => {
    process.env.ALLOW_FAKE_GOOGLE_SERVICES = "false";
    expect(getCalendarService()).toBeInstanceOf(RealCalendarService);
    expect(getGmailService()).toBeInstanceOf(RealGmailService);
  });

  it('returns Real even with ALLOW_FAKE_GOOGLE_SERVICES="true" if GOOGLE_CALENDAR_ENABLED="true" (explicit opt-in to real in dev)', () => {
    process.env.ALLOW_FAKE_GOOGLE_SERVICES = "true";
    process.env.GOOGLE_CALENDAR_ENABLED = "true";
    expect(getCalendarService()).toBeInstanceOf(RealCalendarService);
    expect(getGmailService()).toBeInstanceOf(RealGmailService);
  });

  it('returns Fake only when ALLOW_FAKE_GOOGLE_SERVICES="true" and GOOGLE_CALENDAR_ENABLED is not "true"', () => {
    process.env.ALLOW_FAKE_GOOGLE_SERVICES = "true";
    delete process.env.GOOGLE_CALENDAR_ENABLED;
    expect(getCalendarService()).toBeInstanceOf(FakeCalendarService);
    expect(getGmailService()).toBeInstanceOf(FakeGmailService);
  });
});
