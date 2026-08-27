/**
 * Pure aggregation logic for retail-sales KPIs - no DB access, unit-testable
 * in isolation (same split as lib/analytics/kpi.ts). Deliberately scope-
 * agnostic: the caller (lib/retail/queries.ts) decides whether `sales`
 * represents one staff member's own checkouts or the whole salon's by
 * choosing what it queries - these functions just reduce whatever array
 * they're given, so "自分の実績" and "サロン全体" share the exact same math.
 */

export interface RetailKpis {
  retailRevenue: number;
  unitsSold: number;
  retailCustomerCount: number;
}

/**
 * retailCustomerCount = distinct non-null customerIds + count of null-
 * customerId sales (each unregistered-buyer checkout counts as one person,
 * since repeat unregistered buyers can't be told apart - see plan §5/§6).
 */
export function computeRetailKpis(sales: { totalAmount: number; customerId: string | null; itemQuantities: number[] }[]): RetailKpis {
  const retailRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
  const unitsSold = sales.reduce((sum, s) => sum + s.itemQuantities.reduce((a, b) => a + b, 0), 0);

  const uniqueCustomerIds = new Set(sales.filter((s) => s.customerId !== null).map((s) => s.customerId));
  const unregisteredSaleCount = sales.filter((s) => s.customerId === null).length;
  const retailCustomerCount = uniqueCustomerIds.size + unregisteredSaleCount;

  return { retailRevenue, unitsSold, retailCustomerCount };
}

export interface ProductBreakdownRow {
  productName: string;
  quantity: number;
}

/**
 * Grouped strictly by the product name as typed at sale time - no product
 * master to resolve against, and per the user's explicit correction, no
 * catch-all "その他商品" bucket either. Typo/variant reduction is handled
 * upstream by surfacing past product names as input suggestions (see
 * lib/retail/queries.ts's listRecentProductNames), not by merging here.
 */
export function computeProductBreakdown(sales: { items: { productName: string; quantity: number }[] }[]): ProductBreakdownRow[] {
  const quantityByProduct = new Map<string, number>();
  for (const sale of sales) {
    for (const item of sale.items) {
      quantityByProduct.set(item.productName, (quantityByProduct.get(item.productName) ?? 0) + item.quantity);
    }
  }
  return Array.from(quantityByProduct.entries())
    .map(([productName, quantity]) => ({ productName, quantity }))
    .sort((a, b) => b.quantity - a.quantity);
}
