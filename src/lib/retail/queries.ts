import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { computeProductBreakdown, computeRetailKpis, type ProductBreakdownRow, type RetailKpis } from "./kpi";
import { DEFAULT_PRODUCT_NAMES } from "./constants";

/**
 * soldAt is @db.Date (no time-of-day, no timezone) - same "utc as a pure
 * calendar-date calculator" convention as VisitRecord.visitDate
 * (lib/analytics/queries.ts). Never dateToJst()/utcIsoToJst() here.
 */
function dateOnly(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function monthRange(year: number, month: number): { monthStart: Date; monthEnd: Date } {
  const start = DateTime.fromObject({ year, month, day: 1 }, { zone: "utc" }).startOf("month");
  const end = start.endOf("month");
  return { monthStart: dateOnly(start.toISODate()!), monthEnd: dateOnly(end.toISODate()!) };
}

export interface MonthlyRetailAnalytics {
  kpis: RetailKpis;
  productBreakdown: ProductBreakdownRow[];
}

/**
 * Always self-only (staffId required) - the analytics page's retail section
 * shows the caller's own figures only, same as the rest of that page's KPIs/
 * charts. The select list is deliberately limited to
 * totalAmount/customerId/items - it never joins the `customer` relation.
 * `soldAtFilter` undefined = no date condition at all (all-time).
 */
async function getRetailAnalyticsForRange(staffId: string, soldAtFilter: { gte: Date; lte: Date } | undefined): Promise<MonthlyRetailAnalytics> {
  const sales = await prisma.retailSale.findMany({
    where: {
      staffId,
      status: "COMPLETED",
      ...(soldAtFilter ? { soldAt: soldAtFilter } : {}),
    },
    select: {
      totalAmount: true,
      customerId: true,
      items: { select: { productName: true, quantity: true } },
    },
  });

  const kpis = computeRetailKpis(sales.map((s) => ({ totalAmount: s.totalAmount, customerId: s.customerId, itemQuantities: s.items.map((i) => i.quantity) })));
  const productBreakdown = computeProductBreakdown(sales);

  return { kpis, productBreakdown };
}

export async function getMonthlyRetailAnalytics(year: number, month: number, staffId: string): Promise<MonthlyRetailAnalytics> {
  const { monthStart, monthEnd } = monthRange(year, month);
  return getRetailAnalyticsForRange(staffId, { gte: monthStart, lte: monthEnd });
}

/** Lifetime totals (no date filter) - see getAllTimeAnalytics in lib/analytics/queries.ts for the matching KPI-section variant. */
export async function getAllTimeRetailAnalytics(staffId: string): Promise<MonthlyRetailAnalytics> {
  return getRetailAnalyticsForRange(staffId, undefined);
}

export interface RetailSaleListItem {
  id: string;
  soldAt: Date;
  customerId: string | null;
  customerName: string | null;
  items: { productName: string; quantity: number }[];
  totalAmount: number;
  memo: string | null;
  status: "COMPLETED" | "CANCELLED";
}

/**
 * Always self-only (staffId required, no salon-wide variant) - this backs
 * the /retail screen's own register/edit/cancel list, which per plan §7 only
 * ever shows what the caller registered. Includes CANCELLED rows (with
 * status) so the list can show cancelled entries with a badge instead of
 * silently hiding history - see plan §7/§8.
 */
export async function listRetailSales(year: number, month: number, staffId: string): Promise<RetailSaleListItem[]> {
  const { monthStart, monthEnd } = monthRange(year, month);

  const sales = await prisma.retailSale.findMany({
    where: { staffId, soldAt: { gte: monthStart, lte: monthEnd } },
    orderBy: { soldAt: "desc" },
    select: {
      id: true,
      soldAt: true,
      customerId: true,
      customer: { select: { name: true } },
      items: { select: { productName: true, quantity: true } },
      totalAmount: true,
      memo: true,
      status: true,
    },
  });

  return sales.map((s) => ({
    id: s.id,
    soldAt: s.soldAt,
    customerId: s.customerId,
    customerName: s.customer?.name ?? null,
    items: s.items,
    totalAmount: s.totalAmount,
    memo: s.memo,
    status: s.status,
  }));
}

/** Self-only distinct product names from the caller's own past sales, merged with the fixed starter suggestions - see plan §4. */
export async function listRecentProductNames(staffId: string): Promise<string[]> {
  const rows = await prisma.retailSaleItem.findMany({
    where: { retailSale: { staffId } },
    distinct: ["productName"],
    orderBy: { createdAt: "desc" },
    select: { productName: true },
    take: 20,
  });

  const names = new Set(DEFAULT_PRODUCT_NAMES);
  for (const r of rows) names.add(r.productName);
  return Array.from(names);
}
