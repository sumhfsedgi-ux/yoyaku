import { getMyBookingSettings } from "@/actions/schedule";
import { getMyReservationEmailTemplate } from "@/actions/emailTemplateSettings";
import { getMyLineTemplateSettings } from "@/actions/lineTemplateSettings";
import { ReservationSettingsForm } from "@/components/admin/ReservationSettingsForm";
import { ReservationEmailTemplateForm } from "@/components/admin/ReservationEmailTemplateForm";
import { LineNotificationSettingsForm } from "@/components/admin/LineNotificationSettingsForm";

export default async function SettingsPage() {
  const [settings, reservationEmailBody, lineSettings] = await Promise.all([
    getMyBookingSettings(),
    getMyReservationEmailTemplate(),
    getMyLineTemplateSettings(),
  ]);
  const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const bookingUrl = `${origin}/reserve/${settings.bookingSlug}`;

  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-6 text-xl font-semibold tracking-tight text-foreground">予約設定</h1>
      <div className="flex flex-col gap-6">
        <ReservationSettingsForm initialSettings={settings} bookingUrl={bookingUrl} />
        <ReservationEmailTemplateForm
          initialBody={reservationEmailBody}
          staffSalonName={settings.salonName}
          testSendAvailable={lineSettings.testSendAvailable}
        />
        {/* Phase 1 staff scope (see lib/line/staffGate.ts): this card only ever renders for the one staff LINE is enabled for - every other staff sees no LINE-related UI at all. */}
        {lineSettings.lineEnabledForThisStaff && (
          <LineNotificationSettingsForm
            initialReminderBody={lineSettings.reminderBody}
            testSendAvailable={lineSettings.testSendAvailable}
            staffSalonName={settings.salonName}
          />
        )}
      </div>
    </div>
  );
}
