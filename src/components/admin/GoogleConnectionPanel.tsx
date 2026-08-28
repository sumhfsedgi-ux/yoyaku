"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2Icon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getGoogleConnectionStatus,
  startGoogleCalendarConnection,
  startGoogleGmailConnection,
  testGoogleCalendarConnection,
  testGoogleGmailConnection,
  sendGoogleGmailTestEmail,
  updateRoomCalendarId,
  type GoogleConnectionStatus,
  type GoogleIntegrationStatus,
} from "@/actions/googleConnection";

/**
 * `initialStatus` comes from the server (see app/(admin)/settings/google/page.tsx)
 * so the first paint already shows the real connection status - no
 * client-side fetch-on-mount round trip.
 */
export function GoogleConnectionPanel({ initialStatus }: { initialStatus: GoogleConnectionStatus }) {
  const [status, setStatus] = useState<GoogleConnectionStatus>(initialStatus);
  const [isPending, startTransition] = useTransition();
  const [testingCalendar, startTestingCalendar] = useTransition();
  const [testingGmail, startTestingGmail] = useTransition();
  const [sendingTestEmail, startSendingTestEmail] = useTransition();

  async function refresh() {
    setStatus(await getGoogleConnectionStatus());
  }

  function handleTestCalendar() {
    startTestingCalendar(async () => {
      const result = await testGoogleCalendarConnection();
      if (result.ok) toast.success("部屋カレンダーとの接続を確認できました");
      else toast.error("設定されているカレンダーを確認できません。Calendar IDまたはアクセス権限をご確認ください。");
    });
  }

  function handleTestGmail() {
    startTestingGmail(async () => {
      const result = await testGoogleGmailConnection();
      if (result.ok) toast.success("Gmailとの接続を確認できました");
      else toast.error("接続を確認できませんでした。しばらくしてから再度お試しください。");
    });
  }

  function handleSendTestEmail() {
    startSendingTestEmail(async () => {
      const result = await sendGoogleGmailTestEmail();
      if (result.ok) toast.success("テストメールを送信しました");
      else toast.error("テストメールの送信に失敗しました。");
    });
  }

  function handleUpdateCalendarId(roomId: string, value: string) {
    startTransition(async () => {
      await updateRoomCalendarId(roomId, value);
      toast.success("カレンダーIDを更新しました");
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <GoogleIntegrationSection
        title="Googleカレンダー"
        status={status.calendar}
        connectAction={startGoogleCalendarConnection}
        onTest={handleTestCalendar}
        testing={testingCalendar}
      >
        {status.calendar.connected && status.calendar.roomCalendars.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-3 text-sm font-semibold text-foreground">部屋ごとのカレンダーID</p>
            {status.calendar.roomCalendars.map((rc) => (
              <div key={rc.roomId} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-sm text-muted-foreground">{rc.roomName}</span>
                <Input
                  defaultValue={rc.googleCalendarId}
                  disabled={isPending}
                  onBlur={(e) => {
                    if (e.target.value !== rc.googleCalendarId) handleUpdateCalendarId(rc.roomId, e.target.value);
                  }}
                  className="h-11 text-base"
                />
              </div>
            ))}
          </div>
        )}
      </GoogleIntegrationSection>

      <GoogleIntegrationSection
        title="Gmail送信"
        status={status.gmail}
        connectAction={startGoogleGmailConnection}
        onTest={handleTestGmail}
        testing={testingGmail}
        onSendTestEmail={handleSendTestEmail}
        sendingTestEmail={sendingTestEmail}
      />
    </div>
  );
}

function GoogleIntegrationSection({
  title,
  status,
  connectAction,
  onTest,
  testing,
  onSendTestEmail,
  sendingTestEmail,
  children,
}: {
  title: string;
  status: GoogleIntegrationStatus;
  connectAction: () => Promise<never>;
  onTest: () => void;
  testing: boolean;
  onSendTestEmail?: () => void;
  sendingTestEmail?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      <div className="mb-3 flex items-center gap-2">
        {status.connected ? (
          <CheckCircle2Icon className="size-5 text-success" aria-hidden="true" />
        ) : (
          <XCircleIcon className="size-5 text-muted-foreground" aria-hidden="true" />
        )}
        <p className="text-sm font-semibold text-foreground">{status.connected ? "連携済み" : "未連携"}</p>
      </div>
      {status.connected && (
        <dl className="mb-4 flex flex-col gap-1 text-sm text-muted-foreground">
          <div className="flex justify-between">
            <dt>接続アカウント</dt>
            <dd className="text-foreground">{status.googleAccountEmail ?? "-"}</dd>
          </div>
          {status.connectedAt && (
            <div className="flex justify-between">
              <dt>接続日時</dt>
              <dd className="text-foreground">{new Date(status.connectedAt).toLocaleString("ja-JP")}</dd>
            </div>
          )}
          {status.connectedByStaffName && (
            <div className="flex justify-between">
              <dt>接続した担当者</dt>
              <dd className="text-foreground">{status.connectedByStaffName}</dd>
            </div>
          )}
        </dl>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <form action={connectAction}>
          <Button type="submit" size="touch">
            {status.connected ? "再接続する" : "連携を開始"}
          </Button>
        </form>
        {status.connected && (
          <Button variant="outline" size="touch" disabled={testing} onClick={onTest}>
            {testing ? "確認中..." : "接続確認"}
          </Button>
        )}
        {status.connected && onSendTestEmail && (
          <Button variant="outline" size="touch" disabled={sendingTestEmail} onClick={onSendTestEmail}>
            {sendingTestEmail ? "送信中..." : "テストメール送信"}
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}
