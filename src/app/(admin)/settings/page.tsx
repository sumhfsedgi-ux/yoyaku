import { getMyBookingSettings } from "@/actions/schedule";
import { getMyReservationEmailTemplate } from "@/actions/emailTemplateSettings";
import { ReservationSettingsForm } from "@/components/admin/ReservationSettingsForm";
import { ReservationEmailTemplateForm } from "@/components/admin/ReservationEmailTemplateForm";

export default async function SettingsPage() {
  const [settings, reservationEmailBody] = await Promise.all([getMyBookingSettings(), getMyReservationEmailTemplate()]);
  const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const bookingUrl = `${origin}/reserve/${settings.bookingSlug}`;

  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-6 text-xl font-semibold tracking-tight text-foreground">予約設定</h1>
      <div className="flex flex-col gap-6">
        <ReservationSettingsForm initialSettings={settings} bookingUrl={bookingUrl} />
        <ReservationEmailTemplateForm initialBody={reservationEmailBody} staffSalonName={settings.salonName} />
      </div>
    </div>
  );
}
