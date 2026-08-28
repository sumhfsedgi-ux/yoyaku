import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DateTime } from "luxon";
import { BookingFlow } from "@/components/reserve/BookingFlow";
import { getAvailableSlotRangeStatus } from "@/actions/availability";
import { resolveStaffByBookingSlug } from "@/lib/reservations/staffLookup";
import { SALON_TIME_ZONE } from "@/lib/availability/types";

/**
 * A link to this page is what staff actually send customers (LINE, SMS,
 * etc.) - without this, every staff member's booking link previewed with the
 * same generic app-wide title/description from the root layout, giving the
 * customer no way to tell which salon/staff the link was for.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const staff = await resolveStaffByBookingSlug(slug);
  if (!staff || !staff.active || !staff.salonName) {
    return {};
  }
  return {
    title: `${staff.salonName} - ご予約`,
    description: `${staff.salonName}のご予約はこちらから`,
  };
}

// TEMPORARY (perf investigation, see .claude/plans): when PERF_DEBUG=1, logs
// this page's own server-side breakdown - individual awaits vs the Promise.all
// wall-clock vs the whole function - so "is it the Staff lookup or the slot
// computation" is visible without re-deriving it from raw Prisma query logs.
const PERF_DEBUG = process.env.PERF_DEBUG === "1";

export default async function ReservePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const todayISO = DateTime.now().setZone(SALON_TIME_ZONE).toISODate()!;
  const t0 = performance.now();

  // getAvailableSlotRangeStatus resolves the same Staff row by bookingSlug
  // internally (via resolveStaffByBookingSlug, cache()-wrapped) - within this
  // one request that dedupes to a single Prisma query even though it's
  // awaited independently here. Precomputing the FIRST 2-week window here
  // means BookingFlow's initial paint already has real ○/× data - no client
  // fetch-on-mount round trip (paging to a later window is still a client
  // fetch, see BookingFlow.tsx).
  const [staff, initialGrid] = await Promise.all([resolveStaffByBookingSlug(slug), getAvailableSlotRangeStatus(slug, todayISO)]);
  const t1 = performance.now();
  if (PERF_DEBUG) console.log(`[perf:reserve] Promise.all(staff, initialGrid) ${(t1 - t0).toFixed(1)}ms`);

  if (!staff || !staff.active) notFound();
  if (PERF_DEBUG) console.log(`[perf:reserve] total ${(performance.now() - t0).toFixed(1)}ms`);

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
