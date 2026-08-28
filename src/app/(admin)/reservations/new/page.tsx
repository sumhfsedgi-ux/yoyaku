import { DateTime } from "luxon";
import { requireStaffSession } from "@/lib/auth/session";
import { getSlotRangeStatusForManualBooking } from "@/actions/manualReservationAvailability";
import { resolveBookingWindowDays } from "@/lib/reservations/staffLookup";
import { ManualReservationForm } from "@/components/admin/ManualReservationForm";
import { SALON_TIME_ZONE } from "@/lib/availability/types";

export default async function NewReservationPage() {
  const todayISO = DateTime.now().setZone(SALON_TIME_ZONE).toISODate()!;
  const session = await requireStaffSession();
  // bookingWindowDays and the FIRST 2-week window's ○/× compute in parallel,
  // so ManualReservationForm's initial paint has real data already.
  // bookingWindowDays is fetched via its own minimal select
  // (resolveBookingWindowDays) rather than the heavier getMyBookingSettings,
  // which this page doesn't otherwise need (bookingSlug/cutoff fields).
  // It's still a separate query from loadStaffConfig's own Staff lookup
  // inside getSlotRangeStatusForManualBooking, since that one also needs
  // relations (weeklyAvailability/scheduleOverrides) this flat select doesn't.
  const [windowDays, initialGrid] = await Promise.all([
    resolveBookingWindowDays(session.staffId),
    getSlotRangeStatusForManualBooking(todayISO),
  ]);

  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-foreground">新規予約</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        LINEやお電話でのご予約を、{session.displayName}さんの予約として登録します。
      </p>
      <ManualReservationForm
        staffDisplayName={session.displayName}
        bookingWindowDays={windowDays.bookingWindowDays}
        initialWindowStartISO={todayISO}
        initialGridDays={initialGrid.ok ? initialGrid.days : []}
        initialGridError={initialGrid.ok ? null : (initialGrid.reason ?? "UNKNOWN")}
      />
    </div>
  );
}
