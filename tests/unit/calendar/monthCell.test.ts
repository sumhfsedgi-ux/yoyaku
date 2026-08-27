import { describe, expect, it } from "vitest";
import { computeMonthCellTiers, truncateMonthEntries } from "@/lib/calendar/monthCell";

describe("truncateMonthEntries (spec case 6: month view overflow)", () => {
  it("returns everything with no overflow when entries fit within maxVisible", () => {
    const result = truncateMonthEntries(["a", "b"], 3);
    expect(result).toEqual({ visible: ["a", "b"], overflowCount: 0 });
  });

  it("returns exactly maxVisible entries with no overflow at the boundary", () => {
    const result = truncateMonthEntries(["a", "b", "c"], 3);
    expect(result).toEqual({ visible: ["a", "b", "c"], overflowCount: 0 });
  });

  it("truncates to maxVisible and reports the remaining count as overflow", () => {
    const result = truncateMonthEntries(["a", "b", "c", "d", "e"], 3);
    expect(result).toEqual({ visible: ["a", "b", "c"], overflowCount: 2 });
  });

  it("an empty list has no overflow", () => {
    expect(truncateMonthEntries([], 3)).toEqual({ visible: [], overflowCount: 0 });
  });

  it("a smaller maxVisible (mobile) produces a larger overflow count for the same data", () => {
    const entries = ["a", "b", "c", "d", "e"];
    expect(truncateMonthEntries(entries, 2)).toEqual({ visible: ["a", "b"], overflowCount: 3 });
  });
});

describe("computeMonthCellTiers (responsive month-cell entry counts: mobile=1, tablet=2, desktop=3)", () => {
  it("computes independent visible/overflow splits for all three tiers from the same chronological list", () => {
    const entries = ["a", "b", "c", "d", "e"];
    const tiers = computeMonthCellTiers(entries);
    expect(tiers.mobile).toEqual({ visible: ["a"], overflowCount: 4 });
    expect(tiers.tablet).toEqual({ visible: ["a", "b"], overflowCount: 3 });
    expect(tiers.desktop).toEqual({ visible: ["a", "b", "c"], overflowCount: 2 });
  });

  it("no overflow at any tier when there are few entries", () => {
    const entries = ["a"];
    const tiers = computeMonthCellTiers(entries);
    expect(tiers.mobile).toEqual({ visible: ["a"], overflowCount: 0 });
    expect(tiers.tablet).toEqual({ visible: ["a"], overflowCount: 0 });
    expect(tiers.desktop).toEqual({ visible: ["a"], overflowCount: 0 });
  });

  it("an empty day has no overflow and nothing visible at any tier", () => {
    const tiers = computeMonthCellTiers([]);
    expect(tiers.mobile).toEqual({ visible: [], overflowCount: 0 });
    expect(tiers.tablet).toEqual({ visible: [], overflowCount: 0 });
    expect(tiers.desktop).toEqual({ visible: [], overflowCount: 0 });
  });
});
