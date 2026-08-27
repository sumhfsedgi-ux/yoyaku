/**
 * Pure aggregation logic for the monthly analytics dashboard - no DB access,
 * unit-testable in isolation (see lib/calendar/monthCell.ts for the same
 * split elsewhere in this codebase). Wired to Prisma in lib/analytics/queries.ts.
 *
 * KPI definitions (plan §6, stated precisely to avoid the "2回目来店率" vs
 * "月間来店に占めるリピート比率" conflation):
 *  - monthlyRevenue: sum of amount over this month's VisitRecords.
 *  - visitCount: count of this month's VisitRecords.
 *  - newCustomerCount: count of CUSTOMERS whose firstVisitDate falls in this
 *    month (not a visit count).
 *  - repeatVisitCount: max(0, visitCount - newCustomerCount). A new
 *    customer's 2nd visit within the same calendar month as their 1st still
 *    counts as a repeat visit here - only their first-ever visit is netted
 *    out as "new".
 *  - averageRevenuePerVisit: monthlyRevenue / visitCount (0 when visitCount is 0).
 */

export interface MonthlyKpis {
  monthlyRevenue: number;
  visitCount: number;
  newCustomerCount: number;
  repeatVisitCount: number;
  repeatVisitRate: number;
  averageRevenuePerVisit: number;
}

export function computeMonthlyKpis(visits: { amount: number }[], newCustomerCount: number): MonthlyKpis {
  const monthlyRevenue = visits.reduce((sum, v) => sum + v.amount, 0);
  const visitCount = visits.length;
  const repeatVisitCount = Math.max(0, visitCount - newCustomerCount);
  return {
    monthlyRevenue,
    visitCount,
    newCustomerCount,
    repeatVisitCount,
    repeatVisitRate: visitCount === 0 ? 0 : repeatVisitCount / visitCount,
    averageRevenuePerVisit: visitCount === 0 ? 0 : monthlyRevenue / visitCount,
  };
}

export interface MonthlyRevenuePoint {
  yearMonth: string;
  revenue: number;
}

/** `months` is the ordered list of "yyyy-MM" buckets to include (even ones with no visits, so the chart has a continuous x-axis). */
export function computeMonthlyRevenueTrend(visits: { yearMonth: string; amount: number }[], months: string[]): MonthlyRevenuePoint[] {
  const revenueByMonth = new Map<string, number>();
  for (const v of visits) {
    revenueByMonth.set(v.yearMonth, (revenueByMonth.get(v.yearMonth) ?? 0) + v.amount);
  }
  return months.map((yearMonth) => ({ yearMonth, revenue: revenueByMonth.get(yearMonth) ?? 0 }));
}

export interface AcquisitionSourceBreakdownRow {
  sourceId: string | null;
  sourceName: string;
  newCustomerCount: number;
  revenue: number;
}

const UNSET_SOURCE_LABEL = "未設定";

/**
 * Rows are built strictly from what actually appears in this month's data
 * (monthVisits/newCustomers), never from iterating "all active sources" -
 * this is what makes a since-hidden (inactive) source still show up here as
 * long as it has usage in the period (plan §4). `sources` is used only to
 * resolve id -> name and is intentionally NOT filtered by active.
 */
export function computeAcquisitionSourceBreakdown(
  visits: { amount: number; customerFirstVisitAcquisitionSourceId: string | null }[],
  newCustomers: { firstVisitAcquisitionSourceId: string | null }[],
  sources: { id: string; name: string }[],
): AcquisitionSourceBreakdownRow[] {
  const nameById = new Map(sources.map((s) => [s.id, s.name]));
  const revenueBySource = new Map<string | null, number>();
  const newCountBySource = new Map<string | null, number>();

  for (const v of visits) {
    const key = v.customerFirstVisitAcquisitionSourceId;
    revenueBySource.set(key, (revenueBySource.get(key) ?? 0) + v.amount);
  }
  for (const c of newCustomers) {
    const key = c.firstVisitAcquisitionSourceId;
    newCountBySource.set(key, (newCountBySource.get(key) ?? 0) + 1);
  }

  const sourceIds = new Set<string | null>([...revenueBySource.keys(), ...newCountBySource.keys()]);

  return Array.from(sourceIds)
    .map((sourceId) => ({
      sourceId,
      sourceName: sourceId === null ? UNSET_SOURCE_LABEL : (nameById.get(sourceId) ?? UNSET_SOURCE_LABEL),
      newCustomerCount: newCountBySource.get(sourceId) ?? 0,
      revenue: revenueBySource.get(sourceId) ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export interface ConcernRankingRow {
  concernId: string;
  concernName: string;
  count: number;
}

/**
 * A VisitRecord with 2 concerns selected counts as +1 toward EACH concern -
 * the summed count can exceed visitCount, which is expected (plan §6). Same
 * "derive from actual usage, not from an active-filtered list" approach as
 * computeAcquisitionSourceBreakdown, for the same reason (plan §4).
 */
export function computeConcernRanking(visits: { concernIds: string[] }[], concerns: { id: string; name: string }[]): ConcernRankingRow[] {
  const nameById = new Map(concerns.map((c) => [c.id, c.name]));
  const countById = new Map<string, number>();

  for (const v of visits) {
    for (const concernId of v.concernIds) {
      countById.set(concernId, (countById.get(concernId) ?? 0) + 1);
    }
  }

  return Array.from(countById.entries())
    .map(([concernId, count]) => ({ concernId, concernName: nameById.get(concernId) ?? concernId, count }))
    .sort((a, b) => b.count - a.count);
}
