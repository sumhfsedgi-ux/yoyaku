import { describe, expect, it } from "vitest";
import { computeMonthlyKpis, computeMonthlyRevenueTrend } from "@/lib/analytics/kpi";

describe("computeMonthlyKpis (spec scenarios 6, 7, 9, 10)", () => {
  it("monthly revenue is the sum of this month's visit amounts", () => {
    const kpis = computeMonthlyKpis([{ amount: 5000 }, { amount: 9900 }, { amount: 3000 }], 0);
    expect(kpis.monthlyRevenue).toBe(17900);
  });

  it("visit count is the number of visit records, independent of revenue", () => {
    const kpis = computeMonthlyKpis([{ amount: 0 }, { amount: 0 }, { amount: 5000 }], 0);
    expect(kpis.visitCount).toBe(3);
  });

  it("average revenue per visit is monthlyRevenue / visitCount", () => {
    const kpis = computeMonthlyKpis([{ amount: 10000 }, { amount: 6000 }], 0);
    expect(kpis.averageRevenuePerVisit).toBe(8000);
  });

  it("average revenue per visit is 0 when there were no visits (no division by zero)", () => {
    const kpis = computeMonthlyKpis([], 0);
    expect(kpis.averageRevenuePerVisit).toBe(0);
    expect(kpis.monthlyRevenue).toBe(0);
  });

  it("repeat visit count is visitCount minus newCustomerCount (new customers counted once each, not per visit)", () => {
    const kpis = computeMonthlyKpis([{ amount: 1000 }, { amount: 1000 }, { amount: 1000 }], 1);
    expect(kpis.newCustomerCount).toBe(1);
    expect(kpis.repeatVisitCount).toBe(2);
    expect(kpis.repeatVisitRate).toBeCloseTo(2 / 3);
  });

  it("repeat visit count clamps at 0 rather than going negative (e.g. a backfilled firstVisitDate with no matching visit this month)", () => {
    const kpis = computeMonthlyKpis([{ amount: 1000 }], 5);
    expect(kpis.repeatVisitCount).toBe(0);
    expect(kpis.repeatVisitRate).toBe(0);
  });

  it("a new customer's 2nd visit within the same calendar month as their 1st still counts as one repeat visit", () => {
    // visitCount=2 (both this month), newCustomerCount=1 (the customer, not the visit) -> repeat=1.
    const kpis = computeMonthlyKpis([{ amount: 5000 }, { amount: 5000 }], 1);
    expect(kpis.visitCount).toBe(2);
    expect(kpis.newCustomerCount).toBe(1);
    expect(kpis.repeatVisitCount).toBe(1);
  });

  it("repeat visit rate is 0 when there were no visits at all", () => {
    const kpis = computeMonthlyKpis([], 0);
    expect(kpis.repeatVisitRate).toBe(0);
  });
});

describe("computeMonthlyRevenueTrend", () => {
  it("buckets visit amounts by yearMonth and includes months with no visits as zero", () => {
    const trend = computeMonthlyRevenueTrend(
      [
        { yearMonth: "2026-06", amount: 1000 },
        { yearMonth: "2026-06", amount: 2000 },
        { yearMonth: "2026-08", amount: 5000 },
      ],
      ["2026-06", "2026-07", "2026-08"],
    );
    expect(trend).toEqual([
      { yearMonth: "2026-06", revenue: 3000 },
      { yearMonth: "2026-07", revenue: 0 },
      { yearMonth: "2026-08", revenue: 5000 },
    ]);
  });

  it("preserves the order of the requested months regardless of visit order", () => {
    const trend = computeMonthlyRevenueTrend([{ yearMonth: "2026-08", amount: 100 }], ["2026-08", "2026-06", "2026-07"]);
    expect(trend.map((t) => t.yearMonth)).toEqual(["2026-08", "2026-06", "2026-07"]);
  });
});
