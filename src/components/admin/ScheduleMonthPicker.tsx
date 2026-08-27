"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";
import { getMyScheduleOverrides } from "@/actions/schedule";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

interface ScheduleMonthPickerProps {
  selectedISO: string | null;
  onSelect: (dateISO: string) => void;
  /** Bump this after an external save/delete so the "設定あり" dots refetch
   * immediately for the currently displayed month, instead of only updating
   * the next time the user changes month. */
  refreshToken?: number;
}

/**
 * Month-grid date picker for 個別日付変更 (ScheduleOverride) only - deliberately
 * NOT a reuse of admin/MonthGrid.tsx (that one renders RoomTimelineEntry lists
 * and whole-cell links to /calendar's day view; this one is a plain selectable
 * button grid with an "override set" dot and no navigation) and NOT a
 * modification of reserve/DateStrip.tsx (shared by the customer booking flow
 * and the reschedule dialog - must stay a horizontal strip there).
 *
 * Which dates in the displayed month have an override is fetched with a
 * single ranged query per month change (the same getMyScheduleOverrides
 * action OverrideEditor already uses for its list), never per cell.
 */
export function ScheduleMonthPicker({ selectedISO, onSelect, refreshToken }: ScheduleMonthPickerProps) {
  const [displayed, setDisplayed] = useState(() =>
    (selectedISO ? DateTime.fromISO(selectedISO) : DateTime.now().setZone("Asia/Tokyo")).startOf("month"),
  );
  const [overriddenDates, setOverriddenDates] = useState<Set<string>>(new Set());

  const todayISO = DateTime.now().setZone("Asia/Tokyo").toISODate();
  const firstCell = displayed.minus({ days: displayed.weekday % 7 });
  const days = Array.from({ length: 42 }, (_, i) => firstCell.plus({ days: i }));

  useEffect(() => {
    let cancelled = false;
    const fromISO = firstCell.toISODate()!;
    const toISO = firstCell.plus({ days: 41 }).toISODate()!;
    (async () => {
      const rows = await getMyScheduleOverrides(fromISO, toISO);
      if (cancelled) return;
      setOverriddenDates(new Set(rows.map((r) => DateTime.fromJSDate(r.date, { zone: "utc" }).toISODate()!)));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed, refreshToken]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between md:mb-4 lg:mb-5">
        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          aria-label="前の月"
          onClick={() => setDisplayed((d) => d.minus({ months: 1 }))}
        >
          <ChevronLeftIcon />
        </Button>
        <p className="text-sm font-medium text-foreground md:flex-1 md:text-center md:text-base lg:text-lg">
          {displayed.setLocale("ja").toFormat("yyyy年M月")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          aria-label="次の月"
          onClick={() => setDisplayed((d) => d.plus({ months: 1 }))}
        >
          <ChevronRightIcon />
        </Button>
      </div>

      <div className="mb-1 grid grid-cols-7 text-center text-xs font-medium text-muted-foreground md:mb-2 md:text-sm">
        {WEEKDAY_JA.map((w) => (
          <div key={w} className="py-1 md:py-1.5 lg:py-2">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 md:gap-1.5 lg:gap-2">
        {days.map((day) => {
          const dateISO = day.toISODate()!;
          const inMonth = day.month === displayed.month;
          const isToday = dateISO === todayISO;
          const selected = dateISO === selectedISO;
          const hasOverride = overriddenDates.has(dateISO);

          return (
            <button
              key={dateISO}
              type="button"
              onClick={() => onSelect(dateISO)}
              aria-pressed={selected}
              aria-current={isToday ? "date" : undefined}
              aria-label={`${day.toFormat("M月d日")}${hasOverride ? "（設定あり）" : ""}`}
              className={cn(
                "relative flex aspect-square min-h-9 cursor-pointer flex-col items-center justify-center rounded-lg border text-sm transition-all active:scale-[0.98] md:min-h-12 md:text-base md:rounded-xl lg:min-h-14",
                FOCUS_RING,
                selected
                  ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80"
                  : inMonth
                    ? "border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted/40 active:bg-muted/60"
                    : "border-transparent text-muted-foreground/40 hover:bg-muted/20 active:bg-muted/30",
              )}
            >
              <span className={cn(isToday && "font-semibold", !selected && isToday && "text-primary")}>
                {day.day}
              </span>
              {hasOverride && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute bottom-1.5 size-1.5 rounded-full md:bottom-2 md:size-2",
                    selected ? "bg-primary-foreground/80" : "bg-primary",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
