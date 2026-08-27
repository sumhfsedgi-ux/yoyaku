import { describe, expect, it } from "vitest";
import { createVisitRecordInputSchema, updateMySalonNameInputSchema, VISIT_AMOUNT_MAX_YEN } from "@/lib/validation/schemas";

describe("updateMySalonNameInputSchema", () => {
  it("accepts a normal salon name and trims surrounding whitespace", () => {
    const result = updateMySalonNameInputSchema.parse({ salonName: "  腸もみサロン ゆきの  " });
    expect(result.salonName).toBe("腸もみサロン ゆきの");
  });

  it("accepts an empty string (used to clear the salon name)", () => {
    const result = updateMySalonNameInputSchema.parse({ salonName: "" });
    expect(result.salonName).toBe("");
  });

  it("accepts exactly 100 characters", () => {
    const salonName = "あ".repeat(100);
    const result = updateMySalonNameInputSchema.parse({ salonName });
    expect(result.salonName).toHaveLength(100);
  });

  it("rejects more than 100 characters", () => {
    const salonName = "あ".repeat(101);
    expect(() => updateMySalonNameInputSchema.parse({ salonName })).toThrow();
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
