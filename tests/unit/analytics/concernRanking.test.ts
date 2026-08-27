import { describe, expect, it } from "vitest";
import { computeConcernRanking } from "@/lib/analytics/kpi";

describe("computeConcernRanking (spec scenario 12)", () => {
  const concerns = [
    { id: "concern-bloating", name: "お腹の張り" },
    { id: "concern-constipation", name: "便秘" },
  ];

  it("a visit with 2 concerns selected counts +1 toward EACH concern - the total can exceed visit count", () => {
    const rows = computeConcernRanking(
      [{ concernIds: ["concern-bloating", "concern-constipation"] }, { concernIds: ["concern-bloating"] }],
      concerns,
    );
    const bloating = rows.find((r) => r.concernId === "concern-bloating");
    const constipation = rows.find((r) => r.concernId === "concern-constipation");
    expect(bloating?.count).toBe(2);
    expect(constipation?.count).toBe(1);
    const totalCount = rows.reduce((sum, r) => sum + r.count, 0);
    expect(totalCount).toBeGreaterThan(2); // 3 total selections across 2 visits
  });

  it("a concern with no usage this period produces no row (not a zero-value row)", () => {
    const rows = computeConcernRanking([{ concernIds: ["concern-bloating"] }], concerns);
    expect(rows.find((r) => r.concernId === "concern-constipation")).toBeUndefined();
  });

  it("rows are sorted by count descending", () => {
    const rows = computeConcernRanking(
      [{ concernIds: ["concern-constipation"] }, { concernIds: ["concern-bloating"] }, { concernIds: ["concern-bloating"] }],
      concerns,
    );
    expect(rows.map((r) => r.concernId)).toEqual(["concern-bloating", "concern-constipation"]);
  });

  it("a visit with no concerns selected contributes nothing", () => {
    const rows = computeConcernRanking([{ concernIds: [] }], concerns);
    expect(rows).toEqual([]);
  });
});
