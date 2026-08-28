import { beforeEach, describe, expect, it, vi } from "vitest";
import { RealCalendarService } from "@/lib/google/calendar/real";

/**
 * RealCalendarService.getFreeBusy talks to the real googleapis client, mocked
 * here so no network call happens. getSalonOAuthClient is mocked too - only a
 * truthy value is needed, its DB-backed internals aren't under test here.
 *
 * RealCalendarService is imported statically (not dynamically inside each
 * `it`) so the (large) googleapis module graph is transformed once during
 * Vitest's collection phase rather than inside a single test's own timeout
 * budget - a dynamic import here was observed to blow past a 5s test timeout
 * on first cold transform.
 */
const mockFreebusyQuery = vi.fn();

vi.mock("@/lib/google/oauthClient", () => ({
  getSalonOAuthClient: vi.fn().mockResolvedValue({}),
}));

vi.mock("googleapis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("googleapis")>();
  return {
    ...actual,
    google: {
      ...actual.google,
      calendar: () => ({ freebusy: { query: mockFreebusyQuery } }),
    },
  };
});

describe("RealCalendarService.getFreeBusy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the busy intervals when Google reports no calendar-level errors", async () => {
    mockFreebusyQuery.mockResolvedValue({
      data: {
        calendars: {
          "room-calendar-id": {
            busy: [{ start: "2026-08-30T01:00:00.000Z", end: "2026-08-30T06:00:00.000Z" }],
          },
        },
      },
    });
    const service = new RealCalendarService();

    const result = await service.getFreeBusy(
      "room-calendar-id",
      new Date("2026-08-30T00:00:00.000Z"),
      new Date("2026-08-31T00:00:00.000Z"),
    );

    expect(result).toEqual({
      ok: true,
      busy: [{ start: new Date("2026-08-30T01:00:00.000Z"), end: new Date("2026-08-30T06:00:00.000Z") }],
    });
  });

  it("fails safe (does not report an empty-and-available calendar) when Google returns a calendar-level error", async () => {
    // e.g. calendarId doesn't exist, or this account has no access to it -
    // Google reports this via calendars[id].errors, not an HTTP failure/throw.
    mockFreebusyQuery.mockResolvedValue({
      data: {
        calendars: {
          "wrong-calendar-id": {
            errors: [{ domain: "global", reason: "notFound" }],
          },
        },
      },
    });
    const service = new RealCalendarService();

    const result = await service.getFreeBusy(
      "wrong-calendar-id",
      new Date("2026-08-30T00:00:00.000Z"),
      new Date("2026-08-31T00:00:00.000Z"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("notFound");
  });

  it("fails safe even when busy happens to also be present alongside errors", async () => {
    mockFreebusyQuery.mockResolvedValue({
      data: {
        calendars: {
          "flaky-calendar-id": {
            busy: [{ start: "2026-08-30T01:00:00.000Z", end: "2026-08-30T06:00:00.000Z" }],
            errors: [{ domain: "global", reason: "internalError" }],
          },
        },
      },
    });
    const service = new RealCalendarService();

    const result = await service.getFreeBusy(
      "flaky-calendar-id",
      new Date("2026-08-30T00:00:00.000Z"),
      new Date("2026-08-31T00:00:00.000Z"),
    );

    expect(result.ok).toBe(false);
  });
});
