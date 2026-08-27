"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DateTime } from "luxon";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScheduleMonthPicker } from "@/components/admin/ScheduleMonthPicker";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";
import {
  deleteMyScheduleOverride,
  getMyScheduleOverrides,
  upsertMyScheduleOverride,
} from "@/actions/schedule";

interface Range {
  key: string;
  startMinute: number;
  endMinute: number;
}

function minuteToTimeValue(minute: number): string {
  return `${Math.floor(minute / 60).toString().padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;
}
function formatRanges(ranges: { startMinute: number; endMinute: number }[]): string {
  if (ranges.length === 0) return "時間変更あり";
  return ranges.map((r) => `${minuteToTimeValue(r.startMinute)}〜${minuteToTimeValue(r.endMinute)}`).join("、");
}
function timeValueToMinute(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `o${keySeq}`;
}

export interface OverrideListItem {
  dateISO: string;
  isClosed: boolean;
  label: string;
  ranges: { startMinute: number; endMinute: number }[];
}

/**
 * `initialOverrides` comes from the server (see
 * app/(admin)/schedule/overrides/page.tsx), already shaped for display, so
 * the first paint shows the staff's real overrides with no client-side
 * fetch-on-mount round trip. Subsequent refreshes (after save/delete) still
 * go through the Server Action, since only THIS component knows when a
 * mutation just happened.
 */
export function OverrideEditor({ initialOverrides }: { initialOverrides: OverrideListItem[] }) {
  const [dateISO, setDateISO] = useState<string | null>(null);
  const [isClosed, setIsClosed] = useState(false);
  const [ranges, setRanges] = useState<Range[]>([]);
  const [existing, setExisting] = useState<OverrideListItem[]>(initialOverrides);
  const [isPending, startTransition] = useTransition();

  async function refreshList() {
    const today = DateTime.now().setZone("Asia/Tokyo");
    const rows = await getMyScheduleOverrides(today.toISODate()!, today.plus({ days: 90 }).toISODate()!);
    setExisting(
      rows.map((r) => ({
        dateISO: DateTime.fromJSDate(r.date, { zone: "utc" }).toISODate()!,
        isClosed: r.isClosed,
        label: DateTime.fromJSDate(r.date, { zone: "utc" }).setLocale("ja").toFormat("M月d日 (ccc)"),
        ranges: r.ranges,
      })),
    );
  }

  function handleSave() {
    if (!dateISO) return;
    startTransition(async () => {
      try {
        await upsertMyScheduleOverride({
          dateISO,
          isClosed,
          ranges: isClosed ? [] : ranges.map((r) => ({ startMinute: r.startMinute, endMinute: r.endMinute })),
        });
        toast.success("個別日付設定を保存しました");
        setDateISO(null);
        setIsClosed(false);
        setRanges([]);
        refreshList();
      } catch {
        toast.error("保存できませんでした。もう一度お試しください。");
      }
    });
  }

  function handleDelete(target: string) {
    if (!window.confirm("この個別日付設定を削除しますか？")) return;
    startTransition(async () => {
      try {
        await deleteMyScheduleOverride(target);
        toast.success("個別日付設定を削除しました");
        refreshList();
      } catch {
        toast.error("削除できませんでした。もう一度お試しください。");
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_320px] md:items-start lg:grid-cols-[minmax(420px,480px)_minmax(0,1fr)] lg:items-stretch">
      <section className="md:col-start-1 md:row-start-1">
        <p className="mb-2 text-sm font-medium text-foreground">日付を選択</p>
        <ScheduleMonthPicker selectedISO={dateISO} onSelect={setDateISO} />
      </section>

      {dateISO && (
        <section className="rounded-xl border border-border bg-card p-4 md:col-start-2 md:row-start-1 md:row-span-2 lg:row-span-1 lg:p-6">
          <p className="mb-3 text-sm font-semibold text-foreground">
            {DateTime.fromISO(dateISO).setLocale("ja").toFormat("M月d日 (ccc)")}
          </p>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isClosed}
              onChange={(e) => setIsClosed(e.target.checked)}
              className={cn("size-4 cursor-pointer accent-primary", FOCUS_RING)}
            />
            終日休みにする
          </label>

          {!isClosed && (
            <div className="flex flex-col gap-2">
              {ranges.map((r) => (
                <div key={r.key} className="flex items-center gap-2">
                  <Input
                    type="time"
                    step={900}
                    value={minuteToTimeValue(r.startMinute)}
                    onChange={(e) =>
                      setRanges((prev) => prev.map((x) => (x.key === r.key ? { ...x, startMinute: timeValueToMinute(e.target.value) } : x)))
                    }
                    className="h-11 w-auto"
                  />
                  <span className="text-muted-foreground">〜</span>
                  <Input
                    type="time"
                    step={900}
                    value={minuteToTimeValue(r.endMinute)}
                    onChange={(e) =>
                      setRanges((prev) => prev.map((x) => (x.key === r.key ? { ...x, endMinute: timeValueToMinute(e.target.value) } : x)))
                    }
                    className="h-11 w-auto"
                  />
                  <Button
                    variant="ghost"
                    size="icon-touch"
                    aria-label="削除"
                    onClick={() => setRanges((prev) => prev.filter((x) => x.key !== r.key))}
                  >
                    <Trash2Icon className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setRanges((prev) => [...prev, { key: nextKey(), startMinute: 10 * 60, endMinute: 19 * 60 }])}
              >
                <PlusIcon data-icon="inline-start" className="size-3.5" />
                時間帯を追加
              </Button>
            </div>
          )}

          <Button size="touch" disabled={isPending} onClick={handleSave} className="mt-4 w-full">
            {isPending ? "保存中..." : "保存する"}
          </Button>
        </section>
      )}

      {!dateISO && (
        <section className="hidden items-center justify-center rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground md:col-start-2 md:row-start-1 md:row-span-2 md:flex lg:row-span-1 lg:min-h-48 lg:self-start lg:p-6">
          日付を選択してください
        </section>
      )}

      <section className="md:col-start-1 md:row-start-2 lg:col-span-2">
        <p className="mb-2 text-sm font-medium text-foreground">設定済みの個別日付</p>
        {existing.length === 0 ? (
          <p className="text-sm text-muted-foreground">設定はありません。</p>
        ) : (
          <div className="flex flex-col gap-2">
            {existing.map((item) => (
              <div key={item.dateISO} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
                <span>
                  {item.label} - {item.isClosed ? "終日休み" : formatRanges(item.ranges)}
                </span>
                <Button variant="ghost" size="icon-touch" aria-label="削除" onClick={() => handleDelete(item.dateISO)}>
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
