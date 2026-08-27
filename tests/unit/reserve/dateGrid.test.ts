import { describe, expect, it } from "vitest";
import {
  buildTwoWeekWindow,
  computeEndDateISO,
  formatGridDayLabel,
  canGoToPreviousWindow,
  isWindowStartWithinHorizon,
} from "@/lib/reserve/dateGrid";

describe("buildTwoWeekWindow", () => {
  it("returns 14 sequential dates starting at the anchor", () => {
    const days = buildTwoWeekWindow("2026-08-25");
    expect(days).toHaveLength(14);
    expect(days[0]).toBe("2026-08-25");
    expect(days[13]).toBe("2026-09-07");
  });

  it("crosses a month boundary correctly", () => {
    const days = buildTwoWeekWindow("2026-08-25");
    expect(days).toContain("2026-08-31");
    expect(days).toContain("2026-09-01");
  });
});

describe("computeEndDateISO", () => {
  it("is exactly 13 days after the start", () => {
    expect(computeEndDateISO("2026-08-25")).toBe("2026-09-07");
  });
});

describe("formatGridDayLabel", () => {
  it("shows M/D for the very first cell (no previous date)", () => {
    expect(formatGridDayLabel("2026-08-25", null)).toBe("8/25");
  });

  it("shows bare D for a cell in the same month as the previous cell", () => {
    expect(formatGridDayLabel("2026-08-26", "2026-08-25")).toBe("26");
    expect(formatGridDayLabel("2026-08-31", "2026-08-30")).toBe("31");
  });

  it("shows M/D again for the first cell of a newly-entered month", () => {
    expect(formatGridDayLabel("2026-09-01", "2026-08-31")).toBe("9/1");
  });

  it("returns to bare D after a month boundary", () => {
    expect(formatGridDayLabel("2026-09-02", "2026-09-01")).toBe("2");
  });
});

describe("canGoToPreviousWindow", () => {
  it("is false when the current window already starts today", () => {
    expect(canGoToPreviousWindow("2026-08-25", "2026-08-25")).toBe(false);
  });

  it("is true when the current window starts after today", () => {
    expect(canGoToPreviousWindow("2026-09-08", "2026-08-25")).toBe(true);
  });
});

describe("isWindowStartWithinHorizon", () => {
  it("is true when the next window's start is exactly at the booking horizon", () => {
    expect(isWindowStartWithinHorizon("2026-09-24", "2026-08-25", 30)).toBe(true);
  });

  it("is false once the next window's start is past the booking horizon", () => {
    expect(isWindowStartWithinHorizon("2026-09-25", "2026-08-25", 30)).toBe(false);
  });
});
