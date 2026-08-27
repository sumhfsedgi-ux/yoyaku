import { DateTime } from "luxon";
import { requireStaffSession } from "@/lib/auth/session";
import { getMyBookingSettings } from "@/actions/schedule";
import { getSlotRangeStatusForManualBooking } from "@/actions/manualReservationAvailability";
import { ManualReservationForm } from "@/components/admin/ManualReservationForm";
import { SALON_TIME_ZONE } from "@/lib/availability/types";

export default async function NewReservationPage() {
  const todayISO = DateTime.now().setZone(SALON_TIME_ZONE).toISODate()!;
  // Independent - requireStaffSession is React cache()-deduped, so calling it
  // again inside getSlotRangeStatusForManualBooking doesn't re-decode the
  // session; this just lets the FIRST 2-week window's ○/× compute in
  // parallel with the page's own session/settings lookups instead of after
  // them, so ManualReservationForm's initial paint has real data already.
  const [session, settings, initialGrid] = await Promise.all([
    requireStaffSession(),
    getMyBookingSettings(),
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
        bookingWindowDays={settings.bookingWindowDays}
        initialWindowStartISO={todayISO}
        initialGridDays={initialGrid.ok ? initialGrid.days : []}
        initialGridError={initialGrid.ok ? null : (initialGrid.reason ?? "UNKNOWN")}
      />
    </div>
  );
}
