"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setMyWeeklyAvailability, type WeeklyRangeInput } from "@/actions/schedule";

const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

interface Range {
  key: string;
  startMinute: number;
  endMinute: number;
}

export interface WeeklyAvailabilityRow {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

function minuteToTimeValue(minute: number): string {
  const h = Math.floor(minute / 60)
    .toString()
    .padStart(2, "0");
  const m = (minute % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function timeValueToMinute(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `r${keySeq}`;
}

function groupByDay(rows: WeeklyAvailabilityRow[]): Record<number, Range[]> {
  const grouped: Record<number, Range[]> = {};
  for (const row of rows) {
    grouped[row.dayOfWeek] ??= [];
    grouped[row.dayOfWeek].push({ key: nextKey(), startMinute: row.startMinute, endMinute: row.endMinute });
  }
  return grouped;
}

/**
 * `initialRows` comes from the server (see app/(admin)/schedule/weekly/page.tsx)
 * so the first paint already shows the staff's real schedule - no client-side
 * fetch-on-mount round trip before anything appears.
 */
export function WeeklyAvailabilityEditor({ initialRows }: { initialRows: WeeklyAvailabilityRow[] }) {
  const [byDay, setByDay] = useState<Record<number, Range[]>>(() => groupByDay(initialRows));
  const [isPending, startTransition] = useTransition();

  function addRange(day: number) {
    setByDay((prev) => ({
      ...prev,
      [day]: [...(prev[day] ?? []), { key: nextKey(), startMinute: 10 * 60, endMinute: 19 * 60 }],
    }));
  }

  function removeRange(day: number, key: string) {
    setByDay((prev) => ({ ...prev, [day]: (prev[day] ?? []).filter((r) => r.key !== key) }));
  }

  function updateRange(day: number, key: string, field: "startMinute" | "endMinute", value: string) {
    setByDay((prev) => ({
      ...prev,
      [day]: (prev[day] ?? []).map((r) => (r.key === key ? { ...r, [field]: timeValueToMinute(value) } : r)),
    }));
  }

  function handleSave() {
    const ranges: WeeklyRangeInput[] = [];
    for (let day = 0; day <= 6; day++) {
      for (const r of byDay[day] ?? []) {
        ranges.push({ dayOfWeek: day, startMinute: r.startMinute, endMinute: r.endMinute });
      }
    }
    startTransition(async () => {
      try {
        await setMyWeeklyAvailability(ranges);
        toast.success("週間スケジュールを保存しました");
      } catch {
        toast.error("入力内容をご確認ください。");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {DAY_LABELS.map((label, day) => {
        const ranges = byDay[day] ?? [];
        return (
          <div key={day} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">{label}曜日</p>
              <Button variant="ghost" size="sm" onClick={() => addRange(day)}>
                <PlusIcon data-icon="inline-start" className="size-3.5" />
                時間帯を追加
              </Button>
            </div>
            {ranges.length === 0 ? (
              <p className="text-sm text-muted-foreground">休み</p>
            ) : (
              <div className="flex flex-col gap-2">
                {ranges.map((r) => (
                  <div key={r.key} className="flex items-center gap-2">
                    <Input
                      type="time"
                      step={900}
                      value={minuteToTimeValue(r.startMinute)}
                      onChange={(e) => updateRange(day, r.key, "startMinute", e.target.value)}
                      className="h-11 w-auto"
                    />
                    <span className="text-muted-foreground">〜</span>
                    <Input
                      type="time"
                      step={900}
                      value={minuteToTimeValue(r.endMinute)}
                      onChange={(e) => updateRange(day, r.key, "endMinute", e.target.value)}
                      className="h-11 w-auto"
                    />
                    <Button
                      variant="ghost"
                      size="icon-touch"
                      onClick={() => removeRange(day, r.key)}
                      aria-label="この時間帯を削除"
                    >
                      <Trash2Icon className="size-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <Button size="touch" disabled={isPending} onClick={handleSave} className="mt-2">
        {isPending ? "保存中..." : "保存する"}
      </Button>
    </div>
  );
}
