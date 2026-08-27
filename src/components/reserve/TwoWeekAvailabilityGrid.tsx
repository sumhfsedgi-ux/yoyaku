"use client";

import { DateTime } from "luxon";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isJpHoliday } from "@/lib/holidays/jpHolidays";
import { formatGridDayLabel } from "@/lib/reserve/dateGrid";
import { SALON_TIME_ZONE } from "@/lib/availability/types";
import { FOCUS_RING, chipStateClasses } from "@/lib/ui/interactionStyles";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** Saturday=blue, Sunday=red; a holiday (date-specific, so not applicable to the weekday header row) overrides Saturday-blue to red too. */
function weekdayAccentClass(weekday: number, holiday: boolean): string {
  if (weekday === 0 || holiday) return "text-rose-600 dark:text-rose-400";
  if (weekday === 6) return "text-sky-600 dark:text-sky-400";
  return "text-foreground";
}

export interface TwoWeekDayStatus {
  dateISO: string;
  available: boolean;
}

function DayCell({
  day,
  label,
  isToday,
  isSelected,
  onSelect,
}: {
  day: TwoWeekDayStatus;
  label: string;
  isToday: boolean;
  isSelected: boolean;
  onSelect: (dateISO: string) => void;
}) {
  const dt = DateTime.fromISO(day.dateISO, { zone: SALON_TIME_ZONE });
  const weekday = dt.weekday % 7; // 0=Sun..6=Sat
  const holiday = isJpHoliday(day.dateISO);
  const accentClass = weekdayAccentClass(weekday, holiday);

  return (
    <button
      type="button"
      disabled={!day.available}
      aria-pressed={day.available ? isSelected : undefined}
      aria-label={`${dt.toFormat("M月d日")}(${WEEKDAY_JA[weekday]}) ${day.available ? "予約可能" : "予約不可"}`}
      onClick={() => onSelect(day.dateISO)}
      className={cn(
        "relative flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl border text-sm transition-all sm:h-[4.5rem]",
        FOCUS_RING,
        chipStateClasses({ selected: isSelected, disabled: !day.available }),
      )}
    >
      {isToday && <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />}
      <span className={cn("text-[11px]", isSelected ? "text-primary-foreground/80" : accentClass)}>
        {WEEKDAY_JA[weekday]}
      </span>
      <span className={cn("text-sm font-semibold", isSelected ? "text-primary-foreground" : accentClass)}>{label}</span>
      <span
        className={cn(
          "text-xs font-medium",
          isSelected ? "text-primary-foreground" : day.available ? "text-success" : "text-muted-foreground/70",
        )}
      >
        {day.available ? "○" : "×"}
      </span>
    </button>
  );
}

/**
 * Shared 14-day (7x2) date grid for the customer booking page and the staff
 * manual-reservation page - replaces the old horizontal-scroll DateStrip on
 * those two screens only (DateStrip itself is unchanged and still used by
 * the reschedule dialog / block / override editors). Pagination lives here,
 * not in each consumer, so both pages page through 2-week windows identically.
 */
export function TwoWeekAvailabilityGrid({
  days,
  selectedISO,
  onSelectDate,
  loading,
  onPrevWindow,
  onNextWindow,
  canGoPrev,
  canGoNext,
}: {
  days: TwoWeekDayStatus[];
  selectedISO: string | null;
  onSelectDate: (dateISO: string) => void;
  loading: boolean;
  onPrevWindow: () => void;
  onNextWindow: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
}) {
  const todayISO = DateTime.now().setZone(SALON_TIME_ZONE).toISODate()!;
  const firstWeekday = days[0] ? DateTime.fromISO(days[0].dateISO, { zone: SALON_TIME_ZONE }).weekday % 7 : 0;
  const weekdayHeaders = Array.from({ length: 7 }, (_, i) => WEEKDAY_JA[(firstWeekday + i) % 7]);

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="icon-touch" onClick={onPrevWindow} disabled={!canGoPrev || loading} aria-label="前の2週間">
          <ChevronLeftIcon />
        </Button>
        <p className="text-sm font-medium text-foreground">
          {days[0] && days[13]
            ? `${DateTime.fromISO(days[0].dateISO, { zone: SALON_TIME_ZONE }).toFormat("M/d")} 〜 ${DateTime.fromISO(days[13].dateISO, { zone: SALON_TIME_ZONE }).toFormat("M/d")}`
            : ""}
        </p>
        <Button type="button" variant="outline" size="icon-touch" onClick={onNextWindow} disabled={!canGoNext || loading} aria-label="次の2週間">
          <ChevronRightIcon />
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 14 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl sm:h-[4.5rem]" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-1 grid grid-cols-7 gap-1.5">
            {weekdayHeaders.map((wd, i) => (
              <p key={i} className={cn("text-center text-[11px] font-medium", weekdayAccentClass((firstWeekday + i) % 7, false))}>
                {wd}
              </p>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="日付を選択">
            {days.map((day, i) => (
              <DayCell
                key={day.dateISO}
                day={day}
                label={formatGridDayLabel(day.dateISO, i > 0 ? days[i - 1].dateISO : null)}
                isToday={day.dateISO === todayISO}
                isSelected={day.dateISO === selectedISO}
                onSelect={onSelectDate}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
