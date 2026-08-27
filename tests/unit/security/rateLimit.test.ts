import { describe, expect, it } from "vitest";
import { computeWindowStartMs } from "@/lib/security/rateLimit";

describe("computeWindowStartMs (fixed-window boundary logic)", () => {
  it("aligns to the start of a windowSeconds-sized bucket", () => {
    // 60s window: 12:00:00.000 -> 12:00:00, 12:00:59.999 -> still 12:00:00
    const windowStart = Date.UTC(2026, 7, 24, 12, 0, 0);
    expect(computeWindowStartMs(windowStart, 60)).toBe(windowStart);
    expect(computeWindowStartMs(windowStart + 59_999, 60)).toBe(windowStart);
  });

  it("moves to the next bucket exactly at the boundary", () => {
    const windowStart = Date.UTC(2026, 7, 24, 12, 0, 0);
    const nextWindowStart = Date.UTC(2026, 7, 24, 12, 1, 0);
    expect(computeWindowStartMs(nextWindowStart, 60)).toBe(nextWindowStart);
    expect(computeWindowStartMs(nextWindowStart - 1, 60)).toBe(windowStart);
  });

  it("works for hour-long windows (e.g. the booking-attempt limiter)", () => {
    const hourStart = Date.UTC(2026, 7, 24, 15, 0, 0);
    expect(computeWindowStartMs(hourStart + 30 * 60_000, 3600)).toBe(hourStart);
  });
});
