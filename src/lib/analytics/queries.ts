import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { nowJst } from "@/lib/time/tz";
import {
  computeAcquisitionSourceBreakdown,
  computeConcernRanking,
  computeMonthlyKpis,
  computeMonthlyRevenueTrend,
  type AcquisitionSourceBreakdownRow,
  type ConcernRankingRow,
  type MonthlyKpis,
  type MonthlyRevenuePoint,
} from "./kpi";

const TREND_MONTHS = 12;

/**
 * visitDate/firstVisitDate are @db.Date (no time-of-day, no timezone) - all
 * arithmetic here uses Luxon's "utc" zone purely as a calendar-date
 * calculator, never dateToJst()/utcIsoToJst() (those are for precise
 * Timestamptz instants and would risk an off-by-one-day bug on a date-only
 * column - see plan §6).
 */
function dateOnly(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function monthStartUtc(year: number, month: number): DateTime {
  return DateTime.fromObject({ year, month, day: 1 }, { zone: "utc" }).startOf("month");
}

export interface MonthlyAnalytics {
  kpis: MonthlyKpis;
  revenueTrend: MonthlyRevenuePoint[];
  acquisitionBreakdown: AcquisitionSourceBreakdownRow[];
  concernRanking: ConcernRankingRow[];
}

interface DateRangeFilter {
  gte: Date;
  lte: Date;
}

interface AnalyticsRange {
  /** undefined = no date filter at all (all-time). */
  periodFilter: DateRangeFilter | undefined;
  /** Month the "trailing 12 months" revenue trend chart should end at. */
  trendEnd: DateTime;
}

/**
 * 5 fixed queries run via Promise.all regardless of data volume, then pure-JS
 * reduction (lib/analytics/kpi.ts) - no groupBy/aggregate/raw SQL here, same
 * "fetch simple columns once, reduce in JS" idiom as
 * getReservationCountsForMonth/listRoomUsageForMonth (plan §6).
 *
 * sources/concerns are fetched WITHOUT an active filter on purpose: the
 * breakdown/ranking rows are built from what's actually referenced in
 * periodVisits/newCustomers, so a since-hidden master item still appears here
 * if it has usage in this period (plan §4) - these two queries exist only to
 * resolve id -> name.
 *
 * `range.periodFilter` being undefined means "no date condition at all" -
 * used by getAllTimeAnalytics for a lifetime total instead of one month.
 * computeMonthlyKpis/computeAcquisitionSourceBreakdown/computeConcernRanking
 * are pure reductions with no date awareness of their own (see kpi.ts), so
 * this is the only place the month-vs-all-time distinction is made.
 */
async function getAnalyticsForRange(staffId: string, range: AnalyticsRange): Promise<MonthlyAnalytics> {
  const trendStart = dateOnly(range.trendEnd.minus({ months: TREND_MONTHS - 1 }).toISODate()!);
  const trendEnd = dateOnly(range.trendEnd.endOf("month").toISODate()!);

  const [periodVisits, newCustomers, trendVisits, sources, concerns] = await Promise.all([
    prisma.visitRecord.findMany({
      where: { staffId, ...(range.periodFilter ? { visitDate: range.periodFilter } : {}) },
      select: { amount: true, customer: { select: { firstVisitAcquisitionSourceId: true } }, concerns: { select: { id: true } } },
    }),
    prisma.customer.findMany({
      where: { ownerStaffId: staffId, ...(range.periodFilter ? { firstVisitDate: range.periodFilter } : {}) },
      select: { firstVisitAcquisitionSourceId: true },
    }),
    prisma.visitRecord.findMany({
      where: { staffId, visitDate: { gte: trendStart, lte: trendEnd } },
      select: { visitDate: true, amount: true },
    }),
    prisma.acquisitionSourceMaster.findMany({ where: { staffId }, select: { id: true, name: true } }),
    prisma.concernMaster.findMany({ where: { staffId }, select: { id: true, name: true } }),
  ]);

  const kpis = computeMonthlyKpis(
    periodVisits.map((v) => ({ amount: v.amount })),
    newCustomers.length,
  );

  const months: string[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    months.push(range.trendEnd.minus({ months: i }).toFormat("yyyy-MM"));
  }
  const revenueTrend = computeMonthlyRevenueTrend(
    trendVisits.map((v) => ({ yearMonth: DateTime.fromJSDate(v.visitDate, { zone: "utc" }).toFormat("yyyy-MM"), amount: v.amount })),
    months,
  );

  const acquisitionBreakdown = computeAcquisitionSourceBreakdown(
    periodVisits.map((v) => ({ amount: v.amount, customerFirstVisitAcquisitionSourceId: v.customer.firstVisitAcquisitionSourceId })),
    newCustomers,
    sources,
  );

  const concernRanking = computeConcernRanking(
    periodVisits.map((v) => ({ concernIds: v.concerns.map((c) => c.id) })),
    concerns,
  );

  return { kpis, revenueTrend, acquisitionBreakdown, concernRanking };
}

export async function getMonthlyAnalytics(year: number, month: number, staffId: string): Promise<MonthlyAnalytics> {
  const start = monthStartUtc(year, month);
  const end = start.endOf("month");
  return getAnalyticsForRange(staffId, {
    periodFilter: { gte: dateOnly(start.toISODate()!), lte: dateOnly(end.toISODate()!) },
    trendEnd: start,
  });
}

/**
 * Lifetime totals (no date filter at all) - trendEnd anchors the "trailing 12
 * months" chart to the real current JST month instead of a selected one,
 * since an all-time view has no "selected month" of its own (see plan).
 */
export async function getAllTimeAnalytics(staffId: string): Promise<MonthlyAnalytics> {
  const now = nowJst();
  return getAnalyticsForRange(staffId, {
    periodFilter: undefined,
    trendEnd: monthStartUtc(now.year, now.month),
  });
}
