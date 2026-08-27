import { describe, expect, it } from "vitest";
import { isJpHoliday } from "@/lib/holidays/jpHolidays";

describe("isJpHoliday", () => {
  it("recognizes fixed-date national holidays", () => {
    expect(isJpHoliday("2026-01-01")).toBe(true); // 元日
    expect(isJpHoliday("2026-05-03")).toBe(true); // 憲法記念日
    expect(isJpHoliday("2026-08-11")).toBe(true); // 山の日
  });

  it("recognizes the same fixed-date holidays in a different year", () => {
    expect(isJpHoliday("2027-01-01")).toBe(true);
    expect(isJpHoliday("2027-05-03")).toBe(true);
  });

  it("returns false for an ordinary weekday", () => {
    expect(isJpHoliday("2026-08-25")).toBe(false); // Tuesday, no holiday
  });

  it("returns false for a Saturday that is not a holiday", () => {
    expect(isJpHoliday("2026-08-22")).toBe(false); // Saturday, no holiday - not conflated with weekend
  });
});
