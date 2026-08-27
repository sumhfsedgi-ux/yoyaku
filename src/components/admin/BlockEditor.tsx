"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DateTime } from "luxon";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateStrip } from "@/components/reserve/DateStrip";
import { EmptyState } from "@/components/ui/empty-state";
import { createMyStaffBlock, deleteMyStaffBlock, getMyStaffBlocks } from "@/actions/schedule";
import { formatRangeForStaff } from "@/lib/time/tz";

interface BlockItem {
  id: string;
  startAt: Date;
  endAt: Date;
  reason: string | null;
}

/**
 * `initialBlocks` comes from the server (see
 * app/(admin)/schedule/blocks/page.tsx) so the first paint already shows the
 * staff's upcoming blocks - no client-side fetch-on-mount round trip.
 */
export function BlockEditor({ initialBlocks }: { initialBlocks: BlockItem[] }) {
  const [dateISO, setDateISO] = useState<string | null>(null);
  const [startTime, setStartTime] = useState("13:00");
  const [endTime, setEndTime] = useState("14:00");
  const [reason, setReason] = useState("");
  const [upcoming, setUpcoming] = useState<BlockItem[]>(initialBlocks);
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    const now = new Date();
    const in90days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const rows = await getMyStaffBlocks(now.toISOString(), in90days.toISOString());
    setUpcoming(rows);
  }

  function handleAdd() {
    if (!dateISO) return;
    const startAt = DateTime.fromISO(`${dateISO}T${startTime}`, { zone: "Asia/Tokyo" }).toUTC().toISO()!;
    const endAt = DateTime.fromISO(`${dateISO}T${endTime}`, { zone: "Asia/Tokyo" }).toUTC().toISO()!;

    startTransition(async () => {
      try {
        await createMyStaffBlock({ startAt, endAt, reason: reason.trim() || undefined });
        toast.success("受付不可時間を追加しました");
        setDateISO(null);
        setReason("");
        refresh();
      } catch {
        toast.error("入力内容をご確認ください。");
      }
    });
  }

  function handleDelete(id: string) {
    if (!window.confirm("この受付不可時間を削除しますか？")) return;
    startTransition(async () => {
      try {
        await deleteMyStaffBlock(id);
        toast.success("削除しました");
        refresh();
      } catch {
        toast.error("削除できませんでした。もう一度お試しください。");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-sm font-semibold text-foreground">受付不可時間を追加</p>
        <div className="mb-3">
          <DateStrip selectedISO={dateISO} onSelect={setDateISO} windowDays={90} />
        </div>
        {dateISO && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                type="time"
                step={900}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-11 w-auto"
              />
              <span className="text-muted-foreground">〜</span>
              <Input
                type="time"
                step={900}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="h-11 w-auto"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="blockReason">メモ（任意・スタッフのみ表示）</Label>
              <Input id="blockReason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-11 text-base" />
            </div>
            <Button size="touch" disabled={isPending} onClick={handleAdd}>
              {isPending ? "追加中..." : "受付不可時間を追加"}
            </Button>
          </div>
        )}
      </section>

      <section>
        <p className="mb-2 text-sm font-medium text-foreground">設定済みの受付不可時間</p>
        {upcoming.length === 0 ? (
          <EmptyState title="設定されている受付不可時間はありません" />
        ) : (
          <div className="flex flex-col gap-2">
            {upcoming.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
                <div>
                  <p className="text-foreground">{formatRangeForStaff(b.startAt, b.endAt)}</p>
                  {b.reason && <p className="text-xs text-muted-foreground">{b.reason}</p>}
                </div>
                <Button variant="ghost" size="icon-touch" aria-label="削除" onClick={() => handleDelete(b.id)}>
                  <Trash2Icon className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
