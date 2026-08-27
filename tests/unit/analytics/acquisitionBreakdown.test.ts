import { describe, expect, it } from "vitest";
import { computeAcquisitionSourceBreakdown } from "@/lib/analytics/kpi";

describe("computeAcquisitionSourceBreakdown (spec scenario 11)", () => {
  const sources = [
    { id: "src-threads", name: "Threads" },
    { id: "src-instagram", name: "Instagram" },
  ];

  it("revenue per source sums ALL of this month's visits from customers acquired via that source (new + repeat), not just new customers", () => {
    const rows = computeAcquisitionSourceBreakdown(
      [
        { amount: 5000, customerFirstVisitAcquisitionSourceId: "src-threads" }, // repeat customer, same source
        { amount: 9900, customerFirstVisitAcquisitionSourceId: "src-threads" }, // new customer, same source
      ],
      [{ firstVisitAcquisitionSourceId: "src-threads" }],
      sources,
    );
    const threadsRow = rows.find((r) => r.sourceId === "src-threads");
    expect(threadsRow?.revenue).toBe(14900);
    expect(threadsRow?.newCustomerCount).toBe(1);
  });

  it("a repeat customer's revenue is never double-counted into another source's new-customer bucket", () => {
    const rows = computeAcquisitionSourceBreakdown(
      [{ amount: 3000, customerFirstVisitAcquisitionSourceId: "src-instagram" }],
      [{ firstVisitAcquisitionSourceId: "src-threads" }],
      sources,
    );
    const instagramRow = rows.find((r) => r.sourceId === "src-instagram");
    const threadsRow = rows.find((r) => r.sourceId === "src-threads");
    expect(instagramRow?.revenue).toBe(3000);
    expect(instagramRow?.newCustomerCount).toBe(0);
    expect(threadsRow?.revenue).toBe(0);
    expect(threadsRow?.newCustomerCount).toBe(1);
  });

  it("customers with no acquisition source set are bucketed under an explicit '未設定' row, not dropped", () => {
    const rows = computeAcquisitionSourceBreakdown([{ amount: 4000, customerFirstVisitAcquisitionSourceId: null }], [], sources);
    expect(rows).toEqual([{ sourceId: null, sourceName: "未設定", newCustomerCount: 0, revenue: 4000 }]);
  });

  it("a source with no usage this period produces no row at all (not a zero-value row)", () => {
    const rows = computeAcquisitionSourceBreakdown([], [], sources);
    expect(rows).toEqual([]);
  });

  it("rows are sorted by revenue descending", () => {
    const rows = computeAcquisitionSourceBreakdown(
      [
        { amount: 1000, customerFirstVisitAcquisitionSourceId: "src-instagram" },
        { amount: 9000, customerFirstVisitAcquisitionSourceId: "src-threads" },
      ],
      [],
      sources,
    );
    expect(rows.map((r) => r.sourceId)).toEqual(["src-threads", "src-instagram"]);
  });

  it("a source id not present in the (possibly inactive) label map still resolves to a name, never crashing", () => {
    const rows = computeAcquisitionSourceBreakdown([{ amount: 1000, customerFirstVisitAcquisitionSourceId: "src-hidden" }], [], sources);
    expect(rows[0].sourceId).toBe("src-hidden");
    expect(rows[0].revenue).toBe(1000);
  });
});
