import { describe, expect, it } from "vitest";
import {
  createVisitRecordInputSchema,
  staffSettingsInputSchema,
  upsertScheduleOverrideInputSchema,
  VISIT_AMOUNT_MAX_YEN,
} from "@/lib/validation/schemas";

describe("staffSettingsInputSchema (salon name field)", () => {
  const base = { bookingCutoff: { type: "HOURS_BEFORE" as const, hours: 3 }, bookingWindowDays: 30 };

  it("accepts a normal salon name and trims surrounding whitespace", () => {
    const result = staffSettingsInputSchema.parse({ ...base, salonName: "  腸もみサロン ゆきの  " });
    expect(result.salonName).toBe("腸もみサロン ゆきの");
  });

  it("accepts an empty string (used to clear the salon name)", () => {
    const result = staffSettingsInputSchema.parse({ ...base, salonName: "" });
    expect(result.salonName).toBe("");
  });

  it("accepts exactly 100 characters", () => {
    const salonName = "あ".repeat(100);
    const result = staffSettingsInputSchema.parse({ ...base, salonName });
    expect(result.salonName).toHaveLength(100);
  });

  it("rejects more than 100 characters", () => {
    const salonName = "あ".repeat(101);
    expect(() => staffSettingsInputSchema.parse({ ...base, salonName })).toThrow();
  });

  it("rejects bookingWindowDays outside 1-365", () => {
    expect(() => staffSettingsInputSchema.parse({ ...base, salonName: "", bookingWindowDays: 0 })).toThrow();
    expect(() => staffSettingsInputSchema.parse({ ...base, salonName: "", bookingWindowDays: 366 })).toThrow();
  });
});

describe("createVisitRecordInputSchema amount validation (spec scenario 14)", () => {
  const base = { customerId: "customer-1", visitDateISO: "2026-08-01" };

  it("accepts a normal amount", () => {
    const result = createVisitRecordInputSchema.parse({ ...base, amount: 5000 });
    expect(result.amount).toBe(5000);
  });

  it("accepts 0 (a free/monitor visit)", () => {
    const result = createVisitRecordInputSchema.parse({ ...base, amount: 0 });
    expect(result.amount).toBe(0);
  });

  it("rejects a negative amount", () => {
    expect(() => createVisitRecordInputSchema.parse({ ...base, amount: -1 })).toThrow();
  });

  it("rejects a non-integer amount", () => {
    expect(() => createVisitRecordInputSchema.parse({ ...base, amount: 1000.5 })).toThrow();
  });

  it("accepts exactly the maximum sanity ceiling", () => {
    const result = createVisitRecordInputSchema.parse({ ...base, amount: VISIT_AMOUNT_MAX_YEN });
    expect(result.amount).toBe(VISIT_AMOUNT_MAX_YEN);
  });

  it("rejects an amount over the sanity ceiling", () => {
    expect(() => createVisitRecordInputSchema.parse({ ...base, amount: VISIT_AMOUNT_MAX_YEN + 1 })).toThrow();
  });

  it("defaults concernIds to an empty array when omitted", () => {
    const result = createVisitRecordInputSchema.parse({ ...base, amount: 1000 });
    expect(result.concernIds).toEqual([]);
  });
});

describe("upsertScheduleOverrideInputSchema", () => {
  it("rejects isClosed=false with no ranges (nothing entered, would silently save a day with no bookable time)", () => {
    expect(() => upsertScheduleOverrideInputSchema.parse({ isClosed: false, ranges: [] })).toThrow();
  });

  it("accepts isClosed=true with no ranges", () => {
    const result = upsertScheduleOverrideInputSchema.parse({ isClosed: true, ranges: [] });
    expect(result.ranges).toEqual([]);
  });

  it("accepts isClosed=false with at least one range", () => {
    const result = upsertScheduleOverrideInputSchema.parse({
      isClosed: false,
      ranges: [{ startMinute: 10 * 60, endMinute: 12 * 60 }],
    });
    expect(result.ranges).toHaveLength(1);
  });

  it("rejects overlapping ranges", () => {
    expect(() =>
      upsertScheduleOverrideInputSchema.parse({
        isClosed: false,
        ranges: [
          { startMinute: 10 * 60, endMinute: 13 * 60 },
          { startMinute: 12 * 60, endMinute: 15 * 60 },
        ],
      }),
    ).toThrow();
  });
});
