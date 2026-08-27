import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db/prisma";
import { BookingFlow } from "@/components/reserve/BookingFlow";
import { getAvailableSlotRangeStatus } from "@/actions/availability";
import { SALON_TIME_ZONE } from "@/lib/availability/types";

export default async function ReservePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const todayISO = DateTime.now().setZone(SALON_TIME_ZONE).toISODate()!;

  // Independent - getAvailableSlotRangeStatus does its own staff lookup by
  // slug internally, so it doesn't need to wait on this page's own lookup.
  // Precomputing the FIRST 2-week window here means BookingFlow's initial
  // paint already has real ○/× data - no client fetch-on-mount round trip
  // (paging to a later window is still a client fetch, see BookingFlow.tsx).
  const [staff, initialGrid] = await Promise.all([
    prisma.staff.findUnique({
      where: { bookingSlug: slug },
      select: { bookingSlug: true, bookingWindowDays: true, active: true, salonName: true },
    }),
    getAvailableSlotRangeStatus(slug, todayISO),
  ]);

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
