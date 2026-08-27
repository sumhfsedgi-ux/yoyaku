import { prisma } from "@/lib/db/prisma";
import { assertOwnsCustomer } from "@/lib/auth/authorization";

export interface CustomerListItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  firstVisitDate: Date | null;
  totalVisits: number;
  totalRevenue: number;
  lastVisitDate: Date | null;
}

/**
 * Per-row totals come from a single visitRecord.groupBy alongside the
 * customer.findMany, joined in JS by customerId - the one place in the
 * customer chart feature that uses groupBy (see plan §5), specifically
 * because the row count here scales with the number of customers, unlike
 * getCustomerDetail below where per-customer visit history is bounded.
 */
export async function listCustomers(ownerStaffId: string): Promise<CustomerListItem[]> {
  const [customers, totals] = await Promise.all([
    prisma.customer.findMany({
      where: { ownerStaffId },
      select: { id: true, name: true, email: true, phone: true, firstVisitDate: true },
      orderBy: { name: "asc" },
    }),
    prisma.visitRecord.groupBy({
      by: ["customerId"],
      where: { staffId: ownerStaffId },
      _sum: { amount: true },
      _count: { _all: true },
      _max: { visitDate: true },
    }),
  ]);

  const totalsByCustomerId = new Map(totals.map((t) => [t.customerId, t]));

  return customers.map((c) => {
    const totalsForCustomer = totalsByCustomerId.get(c.id);
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      firstVisitDate: c.firstVisitDate,
      totalVisits: totalsForCustomer?._count._all ?? 0,
      totalRevenue: totalsForCustomer?._sum.amount ?? 0,
      lastVisitDate: totalsForCustomer?._max.visitDate ?? null,
    };
  });
}

export interface VisitRecordListItem {
  id: string;
  reservationId: string | null;
  visitDate: Date;
  amount: number;
  concerns: { id: string; name: string }[];
  concernDetail: string | null;
  customerImpression: string | null;
  staffComment: string | null;
  nextVisitMemo: string | null;
}

export interface CustomerDetail {
  id: string;
  name: string;
  email: string;
  phone: string;
  firstVisitDate: Date | null;
  firstVisitAcquisitionSource: { id: string; name: string } | null;
  totalVisits: number;
  totalRevenue: number;
  visitRecords: VisitRecordListItem[];
}

/**
 * Fetches full customer detail INCLUDING PII - but only after confirming
 * viewerStaffId owns it. Same two-step shape as getReservationDetail
 * (lib/reservations/queries.ts): a PII-free ownership check first, the real
 * PII-bearing query only after assertOwnsCustomer has passed. Concerns on
 * each VisitRecord are read via the direct relation (not filtered by
 * active), so a since-hidden concern still displays correctly on old chart
 * entries - see plan §4.
 */
export async function getCustomerDetail(customerId: string, viewerStaffId: string): Promise<CustomerDetail> {
  const ownershipCheck = await prisma.customer.findUnique({ where: { id: customerId }, select: { ownerStaffId: true } });
  if (!ownershipCheck) throw new Error("NOT_FOUND");
  assertOwnsCustomer(viewerStaffId, ownershipCheck);

  const [customer, totals, visitRecords] = await Promise.all([
    prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        firstVisitDate: true,
        firstVisitAcquisitionSource: { select: { id: true, name: true } },
      },
    }),
    prisma.visitRecord.aggregate({ where: { customerId }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.visitRecord.findMany({
      where: { customerId },
      orderBy: { visitDate: "desc" },
      select: {
        id: true,
        reservationId: true,
        visitDate: true,
        amount: true,
        concerns: { select: { id: true, name: true } },
        concernDetail: true,
        customerImpression: true,
        staffComment: true,
        nextVisitMemo: true,
      },
    }),
  ]);

  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    firstVisitDate: customer.firstVisitDate,
    firstVisitAcquisitionSource: customer.firstVisitAcquisitionSource,
    totalVisits: totals._count._all,
    totalRevenue: totals._sum.amount ?? 0,
    visitRecords,
  };
}
