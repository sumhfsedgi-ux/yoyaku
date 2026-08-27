"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";
import { updateMyBookingSettings, type MyBookingSettings } from "@/actions/schedule";

type CutoffType = "HOURS_BEFORE" | "DAY_BEFORE_AT_TIME";

function minuteToTimeValue(minute: number): string {
  return `${Math.floor(minute / 60).toString().padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;
}

/**
 * `initialSettings`/`bookingUrl` come from the server (see
 * app/(admin)/settings/page.tsx) so the first paint already shows the
 * staff's real settings - no client-side fetch-on-mount round trip. The URL
 * is built server-side from NEXTAUTH_URL rather than window.location.origin
 * so there's no client/server render mismatch to reconcile on hydration.
 */
export function BookingSettingsForm({ initialSettings, bookingUrl }: { initialSettings: MyBookingSettings; bookingUrl: string }) {
  const [cutoffType, setCutoffType] = useState<CutoffType>(initialSettings.bookingCutoffType);
  const [hours, setHours] = useState(initialSettings.bookingCutoffHours ?? 3);
  const [daysBefore, setDaysBefore] = useState(initialSettings.bookingCutoffDaysBefore ?? 1);
  const [atTime, setAtTime] = useState(minuteToTimeValue(initialSettings.bookingCutoffAtMinute ?? 20 * 60));
  const [windowDays, setWindowDays] = useState(initialSettings.bookingWindowDays);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const [h, m] = atTime.split(":").map(Number);
    const cutoff =
      cutoffType === "HOURS_BEFORE"
        ? ({ type: "HOURS_BEFORE", hours } as const)
        : ({ type: "DAY_BEFORE_AT_TIME", daysBefore, atMinute: h * 60 + m } as const);

    startTransition(async () => {
      try {
        await updateMyBookingSettings({ cutoff, bookingWindowDays: windowDays });
        toast.success("予約設定を保存しました");
      } catch {
        toast.error("入力内容をご確認ください。");
      }
    });
  }

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(bookingUrl);
      toast.success("予約URLをコピーしました");
    } catch {
      toast.error("コピーに失敗しました");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-sm font-semibold text-foreground">あなたの予約URL</p>
        <div className="flex items-center gap-2">
          <Input readOnly value={bookingUrl} className="h-11 text-base" />
          <Button variant="outline" size="icon-touch" aria-label="URLをコピー" onClick={handleCopyUrl}>
            <CopyIcon className="size-4" />
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-sm font-semibold text-foreground">予約締切</p>
        <div className="mb-3 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={cutoffType === "HOURS_BEFORE"}
              onChange={() => setCutoffType("HOURS_BEFORE")}
              className={cn("size-4 cursor-pointer accent-primary", FOCUS_RING)}
            />
            予約開始の
            <Input
              type="number"
              min={0}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="h-11 w-16 text-base"
            />
            時間前まで
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={cutoffType === "DAY_BEFORE_AT_TIME"}
              onChange={() => setCutoffType("DAY_BEFORE_AT_TIME")}
              className={cn("size-4 cursor-pointer accent-primary", FOCUS_RING)}
            />
            <Input
              type="number"
              min={1}
              value={daysBefore}
              onChange={(e) => setDaysBefore(Number(e.target.value))}
              className="h-11 w-16 text-base"
            />
            日前の
            <Input
              type="time"
              step={900}
              value={atTime}
              onChange={(e) => setAtTime(e.target.value)}
              className="h-11 w-auto text-base"
            />
            まで
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-sm font-semibold text-foreground">何日先まで予約可能か</p>
        <div className="flex items-center gap-2 text-sm">
          <Input
            type="number"
            min={1}
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="h-11 w-24 text-base"
          />
          日先まで
        </div>
      </section>

      <Button size="touch" disabled={isPending} onClick={handleSave}>
        {isPending ? "保存中..." : "保存する"}
      </Button>
    </div>
  );
}
