import { prisma } from "@/lib/db/prisma";
import { normalizePhoneDigits } from "./normalize";

export interface CustomerSearchRow {
  id: string;
  name: string;
  /** Last 4 digits only - see plan: the search list must never carry a full phone/email. */
  phoneLast4: string;
  lastVisitDate: Date | null;
  visitCount: number;
}

const PAGE_SIZE = 20;

/**
 * Server-side, paginated customer search for the manual-reservation "既存の
 * お客様" picker. Deliberately selects only name/phone (last 4 digits)/derived
 * stats - never the full phone or email - so PII beyond what's needed for a
 * picker row can't leak through this query's result type, regardless of what
 * a future UI change does with it (same intent as listReservationsForDay's
 * "never selects the customer relation" comment in reservations/queries.ts).
 * Full PII is only ever returned once a specific customer is selected, via
 * the existing getCustomerDetail (customers/queries.ts).
 */
export async function searchCustomersForBooking(
  ownerStaffId: string,
  query: string,
  offset: number,
): Promise<{ items: CustomerSearchRow[]; hasMore: boolean }> {
  const trimmed = query.trim();
  const digits = normalizePhoneDigits(trimmed);

  const rows = await prisma.customer.findMany({
    where: {
      ownerStaffId,
      ...(trimmed
        ? {
            OR: [
              { name: { contains: trimmed, mode: "insensitive" as const } },
              { email: { contains: trimmed, mode: "insensitive" as const } },
              ...(digits ? [{ phoneDigits: { contains: digits } }] : []),
            ],
          }
        : {}),
    },
    select: { id: true, name: true, phoneDigits: true },
    orderBy: trimmed ? { name: "asc" as const } : { updatedAt: "desc" as const },
    skip: offset,
    take: PAGE_SIZE + 1,
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const ids = page.map((r) => r.id);

  const stats = ids.length
    ? await prisma.reservation.groupBy({
        by: ["customerId"],
        where: { customerId: { in: ids }, status: "CONFIRMED" },
        _count: { _all: true },
        _max: { startAt: true },
      })
    : [];
  const statsByCustomerId = new Map(stats.map((s) => [s.customerId, s]));

  return {
    items: page.map((r) => {
      const s = statsByCustomerId.get(r.id);
      return {
        id: r.id,
        name: r.name,
        phoneLast4: r.phoneDigits.slice(-4),
        lastVisitDate: s?._max.startAt ?? null,
        visitCount: s?._count._all ?? 0,
      };
    }),
    hasMore,
  };
}
