"use client";

import { DateTime } from "luxon";
import { cn } from "@/lib/utils";
import { FOCUS_RING, chipStateClasses } from "@/lib/ui/interactionStyles";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * Horizontally-scrollable date strip - a common, thumb-friendly mobile
 * pattern for picking a near-future date without opening a full month
 * calendar widget. `windowDays` bounds how far ahead can be selected
 * (mirrors a staff's booking_window_days), enforced visually here and always
 * re-validated server-side regardless (see plan §20/§22).
 */
export function DateStrip({
  selectedISO,
  onSelect,
  windowDays,
}: {
  selectedISO: string | null;
  onSelect: (dateISO: string) => void;
  windowDays: number;
}) {
  const today = DateTime.now().setZone("Asia/Tokyo").startOf("day");
  const days = Array.from({ length: windowDays + 1 }, (_, i) => today.plus({ days: i }));

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2" role="group" aria-label="日付を選択">
      {days.map((day) => {
        const iso = day.toISODate()!;
        const selected = iso === selectedISO;
        return (
          <button
            key={iso}
            type="button"
            onClick={() => onSelect(iso)}
            aria-pressed={selected}
            className={cn(
              "flex h-16 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border text-sm transition-all",
              FOCUS_RING,
              chipStateClasses({ selected }),
            )}
          >
            <span className={cn("text-[11px]", selected ? "text-primary-foreground/80" : "text-muted-foreground")}>
              {WEEKDAY_JA[day.weekday % 7]}
            </span>
            <span className="text-base font-semibold">{day.day}</span>
          </button>
        );
      })}
    </div>
  );
}
