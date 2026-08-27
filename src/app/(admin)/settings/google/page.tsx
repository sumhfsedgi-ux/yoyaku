import { getGoogleConnectionStatus } from "@/actions/googleConnection";
import { GoogleConnectionPanel } from "@/components/admin/GoogleConnectionPanel";
import { GoogleConnectionCallbackToast } from "@/components/admin/GoogleConnectionCallbackToast";

export default async function GoogleSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const [params, initialStatus] = await Promise.all([searchParams, getGoogleConnectionStatus()]);
  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-foreground">Google連携</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Googleカレンダー(部屋の予約カレンダー)とGmail送信(予約確認・スタッフ通知メール)は、それぞれ別のGoogleアカウントで連携できます。全スタッフが操作できます。
      </p>
      <GoogleConnectionCallbackToast connected={params.connected} error={params.error} />
      <GoogleConnectionPanel initialStatus={initialStatus} />
    </div>
  );
}
