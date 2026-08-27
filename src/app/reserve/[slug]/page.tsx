import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { BookingFlow } from "@/components/reserve/BookingFlow";
import { getAvailableSlotRangeStatus } from "@/actions/availability";
import { SALON_TIME_ZONE } from "@/lib/availability/types";

/**
 * Shared with generateMetadata below via React's cache() so both resolve to
 * the same in-flight/resolved query within one request instead of hitting
 * Prisma twice - same technique as resolvePrimaryRoomId/getStaffSession.
 */
const getStaffForReserve = cache((slug: string) =>
  prisma.staff.findUnique({
    where: { bookingSlug: slug },
    select: { bookingSlug: true, bookingWindowDays: true, active: true, salonName: true },
  }),
);

/**
 * A link to this page is what staff actually send customers (LINE, SMS,
 * etc.) - without this, every staff member's booking link previewed with the
 * same generic app-wide title/description from the root layout, giving the
 * customer no way to tell which salon/staff the link was for.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const staff = await getStaffForReserve(slug);
  if (!staff || !staff.active || !staff.salonName) {
    return {};
  }
  return {
    title: `${staff.salonName} - ご予約`,
    description: `${staff.salonName}のご予約はこちらから`,
  };
}

export default async function ReservePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const todayISO = DateTime.now().setZone(SALON_TIME_ZONE).toISODate()!;

  // Independent - getAvailableSlotRangeStatus does its own staff lookup by
  // slug internally, so it doesn't need to wait on this page's own lookup.
  // Precomputing the FIRST 2-week window here means BookingFlow's initial
  // paint already has real ○/× data - no client fetch-on-mount round trip
  // (paging to a later window is still a client fetch, see BookingFlow.tsx).
  const [staff, initialGrid] = await Promise.all([getStaffForReserve(slug), getAvailableSlotRangeStatus(slug, todayISO)]);

  if (!staff || !staff.active) notFound();

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md px-4 py-8">
        {staff.salonName && (
          <p className="mb-1 text-sm font-medium text-muted-foreground">{staff.salonName}</p>
        )}
        <h1 className="mb-6 text-lg font-semibold tracking-tight text-foreground">ご予約</h1>
        <BookingFlow
          bookingSlug={staff.bookingSlug}
          bookingWindowDays={staff.bookingWindowDays}
          initialWindowStartISO={todayISO}
          initialGridDays={initialGrid.ok ? initialGrid.days : []}
          initialGridError={initialGrid.ok ? null : (initialGrid.reason ?? "UNKNOWN")}
        />
      </div>
    </div>
  );
}
