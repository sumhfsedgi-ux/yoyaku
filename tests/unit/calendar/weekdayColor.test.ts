import { describe, expect, it } from "vitest";
import { weekdayAccentClass } from "@/lib/calendar/weekdayColor";

describe("weekdayAccentClass", () => {
  it("colors Sunday red", () => {
    expect(weekdayAccentClass(0, false)).toBe("text-rose-600 dark:text-rose-400");
  });

  it("colors Saturday blue", () => {
    expect(weekdayAccentClass(6, false)).toBe("text-sky-600 dark:text-sky-400");
  });

  it("a holiday overrides Saturday-blue to red too", () => {
    expect(weekdayAccentClass(6, true)).toBe("text-rose-600 dark:text-rose-400");
  });

  it("a regular weekday gets no accent color", () => {
    expect(weekdayAccentClass(3, false)).toBe("text-foreground");
  });
});
