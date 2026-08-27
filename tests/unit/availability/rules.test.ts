import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  generateCandidateStarts,
  intervalsOverlap,
  isPastCutoff,
  isWithinBookingWindow,
  overlapsAnyBlock,
  resolveEffectiveRanges,
} from "@/lib/availability/rules";
import { SALON_TIME_ZONE } from "@/lib/availability/types";

function jst(iso: string): Date {
  return DateTime.fromISO(iso, { zone: SALON_TIME_ZONE }).toJSDate();
}

describe("intervalsOverlap (spec cases 1-3)", () => {
  // Existing reservation: 13:00-14:30
  const existingStart = jst("2026-08-30T13:00");
  const existingEnd = jst("2026-08-30T14:30");

  it("case 1: new 13:00-14:30 fully coincides with existing -> overlaps (not bookable)", () => {
    expect(intervalsOverlap(jst("2026-08-30T13:00"), jst("2026-08-30T14:30"), existingStart, existingEnd)).toBe(
      true,
    );
  });

  it("case 2: new 14:15-15:45 partially overlaps existing -> overlaps (not bookable)", () => {
    expect(intervalsOverlap(jst("2026-08-30T14:15"), jst("2026-08-30T15:45"), existingStart, existingEnd)).toBe(
      true,
    );
  });

  it("case 3: new 12:00-13:30 overlaps existing start -> overlaps (not bookable)", () => {
    expect(intervalsOverlap(jst("2026-08-30T12:00"), jst("2026-08-30T13:30"), existingStart, existingEnd)).toBe(
      true,
    );
  });

  it("adjacent [) boundary: new 14:30-16:00 starts exactly when existing ends -> does NOT overlap (bookable)", () => {
    expect(intervalsOverlap(jst("2026-08-30T14:30"), jst("2026-08-30T16:00"), existingStart, existingEnd)).toBe(
      false,
    );
  });

  it("adjacent [) boundary: new ending exactly when existing starts -> does NOT overlap (bookable)", () => {
    expect(intervalsOverlap(jst("2026-08-30T11:30"), jst("2026-08-30T13:00"), existingStart, existingEnd)).toBe(
      false,
    );
  });

  it("does not merely compare start times - a candidate starting after existing's start but whose span still overlaps is caught", () => {
    // starts 1 minute after existing start, still overlaps for the whole 90-minute span
    expect(intervalsOverlap(jst("2026-08-30T13:01"), jst("2026-08-30T14:31"), existingStart, existingEnd)).toBe(
      true,
    );
  });
});

describe("overlapsAnyBlock", () => {
  it("case 7: staff block 13:00-14:00, candidate 12:45-14:15 -> blocked", () => {
    const blocks = [{ start: jst("2026-08-30T13:00"), end: jst("2026-08-30T14:00") }];
    expect(overlapsAnyBlock(jst("2026-08-30T12:45"), jst("2026-08-30T14:15"), blocks)).toBe(true);
  });

  it("candidate entirely outside the block -> not blocked", () => {
    const blocks = [{ start: jst("2026-08-30T13:00"), end: jst("2026-08-30T14:00") }];
    expect(overlapsAnyBlock(jst("2026-08-30T14:00"), jst("2026-08-30T15:30"), blocks)).toBe(false);
  });
});

describe("resolveEffectiveRanges", () => {
  const weekly = [
    { dayOfWeek: 0 as const, ranges: [] },
    { dayOfWeek: 1 as const, ranges: [] },
    { dayOfWeek: 2 as const, ranges: [] },
    { dayOfWeek: 3 as const, ranges: [] },
    { dayOfWeek: 4 as const, ranges: [{ startMinute: 12 * 60, endMinute: 20 * 60 }] },
    { dayOfWeek: 5 as const, ranges: [] },
    { dayOfWeek: 6 as const, ranges: [] },
  ];

  it("falls back to the weekly rule when no override exists for the date", () => {
    expect(resolveEffectiveRanges(4, weekly, undefined)).toEqual([{ startMinute: 720, endMinute: 1200 }]);
  });

  it("an override with isClosed=true wins over the weekly rule, even if weekly has hours", () => {
    const override = { date: "2026-09-03", isClosed: true, ranges: [] };
    expect(resolveEffectiveRanges(4, weekly, override)).toEqual([]);
  });

  it("a non-closed override REPLACES the weekly ranges, it does not merge with them", () => {
    const override = {
      date: "2026-09-03",
      isClosed: false,
      ranges: [{ startMinute: 10 * 60, endMinute: 11 * 60 * 2 }],
    };
    expect(resolveEffectiveRanges(4, weekly, override)).toEqual(override.ranges);
  });
});

describe("generateCandidateStarts", () => {
  it("produces every 15-minute start that leaves room for a full 90-minute appointment", () => {
    const ranges = [{ startMinute: 10 * 60, endMinute: 12 * 60 }]; // 10:00-12:00
    const starts = generateCandidateStarts(ranges, 90, 15);
    // last bookable start is 10:30 (10:30-12:00); 10:45 would end at 12:15, out of range
    expect(starts).toEqual([600, 615, 630]);
  });

  it("a range shorter than the appointment duration produces no candidates", () => {
    const ranges = [{ startMinute: 10 * 60, endMinute: 10 * 60 + 60 }]; // 60 minutes, need 90
    expect(generateCandidateStarts(ranges, 90, 15)).toEqual([]);
  });

  it("split shifts (multiple ranges same day) each contribute their own candidates", () => {
    const ranges = [
      { startMinute: 10 * 60, endMinute: 10 * 60 + 90 }, // exactly one 90-min slot
      { startMinute: 15 * 60, endMinute: 15 * 60 + 90 },
    ];
    expect(generateCandidateStarts(ranges, 90, 15)).toEqual([600, 900]);
  });
});

describe("isPastCutoff", () => {
  it("HOURS_BEFORE: bookable exactly at the N-hour boundary (inclusive)", () => {
    const candidateStart = DateTime.fromISO("2026-08-30T13:00", { zone: SALON_TIME_ZONE });
    const now = DateTime.fromISO("2026-08-30T10:00", { zone: SALON_TIME_ZONE }); // exactly 3h before
    expect(isPastCutoff(candidateStart, now, { type: "HOURS_BEFORE", hours: 3 })).toBe(false);
  });

  it("HOURS_BEFORE: one minute past the boundary is past cutoff", () => {
    const candidateStart = DateTime.fromISO("2026-08-30T13:00", { zone: SALON_TIME_ZONE });
    const now = DateTime.fromISO("2026-08-30T10:01", { zone: SALON_TIME_ZONE });
    expect(isPastCutoff(candidateStart, now, { type: "HOURS_BEFORE", hours: 3 })).toBe(true);
  });

  it("DAY_BEFORE_AT_TIME: bookable before the prior day's deadline time", () => {
    const candidateStart = DateTime.fromISO("2026-08-30T13:00", { zone: SALON_TIME_ZONE });
    const now = DateTime.fromISO("2026-08-29T19:59", { zone: SALON_TIME_ZONE });
    expect(
      isPastCutoff(candidateStart, now, { type: "DAY_BEFORE_AT_TIME", daysBefore: 1, atMinute: 20 * 60 }),
    ).toBe(false);
  });

  it("DAY_BEFORE_AT_TIME: not bookable after the prior day's deadline time", () => {
    const candidateStart = DateTime.fromISO("2026-08-30T13:00", { zone: SALON_TIME_ZONE });
    const now = DateTime.fromISO("2026-08-29T20:01", { zone: SALON_TIME_ZONE });
    expect(
      isPastCutoff(candidateStart, now, { type: "DAY_BEFORE_AT_TIME", daysBefore: 1, atMinute: 20 * 60 }),
    ).toBe(true);
  });
});

describe("isWithinBookingWindow", () => {
  const today = DateTime.fromISO("2026-08-24", { zone: SALON_TIME_ZONE });

  it("today itself is always within the window", () => {
    expect(isWithinBookingWindow("2026-08-24", today, 30)).toBe(true);
  });

  it("exactly windowDays ahead is within the window (inclusive)", () => {
    expect(isWithinBookingWindow("2026-09-23", today, 30)).toBe(true);
  });

  it("one day beyond windowDays is out of the window", () => {
    expect(isWithinBookingWindow("2026-09-24", today, 30)).toBe(false);
  });

  it("a past date is out of the window", () => {
    expect(isWithinBookingWindow("2026-08-23", today, 30)).toBe(false);
  });
});
