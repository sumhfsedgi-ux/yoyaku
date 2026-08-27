import { describe, expect, it } from "vitest";
import { computeProductBreakdown, computeRetailKpis } from "@/lib/retail/kpi";

describe("computeRetailKpis", () => {
  it("ファイバー3個+プロバイオ3個の1会計は合計6個, revenue/customer count 1", () => {
    const result = computeRetailKpis([{ totalAmount: 15000, customerId: "cust-1", itemQuantities: [3, 3] }]);
    expect(result).toEqual({ retailRevenue: 15000, unitsSold: 6, retailCustomerCount: 1 });
  });

  it("同一顧客の同月2回購入は小売人数1人", () => {
    const result = computeRetailKpis([
      { totalAmount: 3000, customerId: "cust-1", itemQuantities: [1] },
      { totalAmount: 5000, customerId: "cust-1", itemQuantities: [2] },
    ]);
    expect(result.retailCustomerCount).toBe(1);
    expect(result.retailRevenue).toBe(8000);
    expect(result.unitsSold).toBe(3);
  });

  it("別の顧客2人への販売は小売人数2人", () => {
    const result = computeRetailKpis([
      { totalAmount: 3000, customerId: "cust-1", itemQuantities: [1] },
      { totalAmount: 3000, customerId: "cust-2", itemQuantities: [1] },
    ]);
    expect(result.retailCustomerCount).toBe(2);
  });

  it("顧客登録なしの販売は1件につき1人として加算される(同月内の別々の未登録購入は別人として数える)", () => {
    const result = computeRetailKpis([
      { totalAmount: 3000, customerId: null, itemQuantities: [1] },
      { totalAmount: 3000, customerId: null, itemQuantities: [1] },
    ]);
    expect(result.retailCustomerCount).toBe(2);
  });

  it("登録済み顧客と顧客登録なしが混在する場合は正しく合算される", () => {
    const result = computeRetailKpis([
      { totalAmount: 3000, customerId: "cust-1", itemQuantities: [1] },
      { totalAmount: 3000, customerId: "cust-1", itemQuantities: [1] },
      { totalAmount: 3000, customerId: null, itemQuantities: [1] },
    ]);
    expect(result.retailCustomerCount).toBe(2); // 1 unique customer + 1 unregistered sale
  });

  it("販売が0件なら全て0", () => {
    expect(computeRetailKpis([])).toEqual({ retailRevenue: 0, unitsSold: 0, retailCustomerCount: 0 });
  });
});

describe("computeProductBreakdown", () => {
  it("商品名ごとに個数を合計する(その他商品への合算はしない)", () => {
    const result = computeProductBreakdown([
      { items: [{ productName: "ファイバー", quantity: 3 }, { productName: "プロバイオ", quantity: 3 }] },
      { items: [{ productName: "ファイバー", quantity: 9 }] },
      { items: [{ productName: "PMAS", quantity: 3 }] },
      { items: [{ productName: "トリプルX", quantity: 2 }] },
    ]);

    expect(result).toEqual([
      { productName: "ファイバー", quantity: 12 },
      { productName: "プロバイオ", quantity: 3 },
      { productName: "PMAS", quantity: 3 },
      { productName: "トリプルX", quantity: 2 },
    ]);
  });

  it("個数の多い順に並ぶ", () => {
    const result = computeProductBreakdown([
      { items: [{ productName: "A", quantity: 1 }] },
      { items: [{ productName: "B", quantity: 5 }] },
    ]);
    expect(result.map((r) => r.productName)).toEqual(["B", "A"]);
  });

  it("会計が無ければ空配列", () => {
    expect(computeProductBreakdown([])).toEqual([]);
  });
});
