import { getMyBookingSettings } from "@/actions/schedule";
import { getMySalonName } from "@/actions/profile";
import { BookingSettingsForm } from "@/components/admin/BookingSettingsForm";
import { SalonNameForm } from "@/components/admin/SalonNameForm";

export default async function SettingsPage() {
  const [settings, salonName] = await Promise.all([getMyBookingSettings(), getMySalonName()]);
  const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const bookingUrl = `${origin}/reserve/${settings.bookingSlug}`;

  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-6 text-xl font-semibold tracking-tight text-foreground">予約設定</h1>
      <div className="flex flex-col gap-6">
        <SalonNameForm initialSalonName={salonName} />
        <BookingSettingsForm initialSettings={settings} bookingUrl={bookingUrl} />
      </div>
    </div>
  );
}
