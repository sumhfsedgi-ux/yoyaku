import Link from "next/link";
import { DateTime } from "luxon";
import { dateToJst } from "@/lib/time/tz";
import { isJpHoliday } from "@/lib/holidays/jpHolidays";
import { weekdayAccentClass } from "@/lib/calendar/weekdayColor";
import type { CalendarScopeParam, RoomTimelineEntry } from "@/lib/calendar/types";
import { computeMonthCellTiers, type MonthCellTiers } from "@/lib/calendar/monthCell";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function entryColorClass(entry: RoomTimelineEntry): string {
  if (entry.kind === "googleBusy") return "bg-muted text-muted-foreground";
  if (entry.isMine) return "bg-primary/15 text-foreground font-medium";
  return "bg-warning/15 text-foreground";
}

/**
 * Month grid where each cell shows the day's actual entries (time + label),
 * not just a count, in plain chronological order (no reordering by
 * own/other/Google - calendarScope="room" is meant to show the room's
 * timeline as-is; entry type is distinguished visually via entryColorClass,
 * not by moving it earlier). Cells never grow unbounded with content: excess
 * entries collapse into "+N".
 *
 * Visible count is responsive to actual viewport width via CSS breakpoints
 * (sm/md), not a JS matchMedia hook (useIsMobile) - up to 3 entries per day
 * are always rendered into the DOM, and Tailwind's `hidden md:flex` classes
 * decide which are actually shown, so the transition is smooth at any width
 * instead of snapping at one hardcoded "mobile" boundary. Mobile and tablet
 * both cap at 2 (see lib/calendar/monthCell.ts), so only the 3rd entry needs
 * a breakpoint toggle at all.
 *
 * Each cell is a plain <div>, NOT a single wrapping <Link> (unlike the
 * previous version) - the day number is its own small Link to the day view,
 * and each entry is an independent sibling: an own reservation is a Link to
 * its detail page, everything else is an inert `aria-disabled` div. This
 * avoids ever nesting a <Link> inside another <Link>, at the cost of "tap
 * truly empty cell space" no longer doing anything on its own (a trailing
 * aria-hidden filler Link recovers most of that dead space without adding a
 * second keyboard/screen-reader stop for the same destination as the day
 * number).
 */
export function MonthGrid({
  year,
  month,
  entriesByDate,
  scope,
  selectedDateISO,
}: {
  year: number;
  month: number;
  entriesByDate: Record<string, RoomTimelineEntry[]>;
  scope: CalendarScopeParam;
  selectedDateISO: string;
}) {
  const monthStart = DateTime.fromObject({ year, month, day: 1 });
  // Luxon weeks start Monday by default; shift so the grid starts on Sunday to match WEEKDAY_LABELS.
  const firstCell = monthStart.minus({ days: monthStart.weekday % 7 });
  const days = Array.from({ length: 42 }, (_, i) => firstCell.plus({ days: i }));
  const todayISO = DateTime.now().setZone("Asia/Tokyo").toISODate();

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
        {WEEKDAY_LABELS.map((w, i) => (
          <div key={w} className={cn("py-1 sm:py-2", weekdayAccentClass(i, false))}>
            {w}
          </div>
        ))}
      </div>
      {/* Mobile "hairline grid" trick: the container itself carries a faint
          background color, cells sit on a 1px gap with no border of their
          own, so the 1px of container-bg peeking through each gap reads as a
          thin dividing line instead of "cards with space between them". From
          sm: up this reverts to today's look (real gap, transparent
          container, each cell gets its own border+radius). */}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-border/60 sm:gap-1.5 sm:overflow-visible sm:rounded-none sm:bg-transparent md:gap-2">
        {days.map((day) => {
          const dateISO = day.toISODate()!;
          const inMonth = day.month === month;
          const isToday = dateISO === todayISO;
          const isSelected = inMonth && dateISO === selectedDateISO;
          const entries = entriesByDate[dateISO] ?? [];
          const tiers = computeMonthCellTiers(entries);
          const dayHref = `/calendar?view=day&scope=${scope}&date=${dateISO}`;

          return (
            <MonthDayCell
              key={dateISO}
              day={day}
              dateISO={dateISO}
              inMonth={inMonth}
              isToday={isToday}
              isSelected={isSelected}
              tiers={tiers}
              dayHref={dayHref}
            />
          );
        })}
      </div>
    </div>
  );
}

function MonthDayCell({
  day,
  dateISO,
  inMonth,
  isToday,
  isSelected,
  tiers,
  dayHref,
}: {
  day: DateTime;
  dateISO: string;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  tiers: MonthCellTiers<RoomTimelineEntry>;
  dayHref: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-14 flex-col gap-0.5 bg-card p-1 text-sm transition-colors sm:min-h-[5.25rem] sm:rounded-lg sm:border sm:p-1 md:min-h-[6.5rem]",
        inMonth ? "sm:border-border" : "sm:border-transparent",
        isSelected && "bg-primary/8",
        !inMonth && "text-muted-foreground/40",
      )}
    >
      {/* Today = filled circle (always wins over weekday color, for
          legibility against the fill). Selected = subtle cell-background
          tint on the wrapper above - a different day can be "selected"
          (last date the staff was looking at, carried across month
          navigation) than "today", and the two must never look identical. */}
      <Link
        href={dayHref}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center self-start rounded-full text-[11px] font-medium transition-colors sm:size-6 sm:text-xs md:size-7 md:text-sm",
          FOCUS_RING,
          !inMonth
            ? "text-muted-foreground/40 hover:bg-muted/40"
            : isToday
              ? "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80"
              : cn(weekdayAccentClass(day.weekday % 7, isJpHoliday(dateISO)), "hover:bg-muted/60 active:bg-muted/70"),
        )}
      >
        {day.day}
      </Link>

      <div className="mt-0.5 flex min-w-0 flex-col gap-0.5 overflow-hidden">
        {tiers.desktop.visible.map((entry, i) => {
          const chipClassName = cn(
            "min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight transition-colors",
            i === 2 ? "hidden md:flex" : "flex",
            entryColorClass(entry),
          );
          const chipContent = (
            <>
              <span className="shrink-0 font-medium">{dateToJst(entry.startAt).toFormat("HH:mm")}</span>
              {/* min-w-0 is required here - a flex item's default
                  min-width:auto overrides `truncate`'s overflow-hidden, so
                  without this the label would collapse to 0 width instead of
                  showing an ellipsis. */}
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            </>
          );
          return entry.isMine ? (
            <Link
              key={entry.id}
              href={`/reservations/${entry.id}`}
              className={cn(chipClassName, FOCUS_RING, "hover:bg-primary/25 active:bg-primary/30")}
            >
              {chipContent}
            </Link>
          ) : (
            <div key={entry.id} aria-disabled="true" className={chipClassName}>
              {chipContent}
            </div>
          );
        })}

        {tiers.mobile.overflowCount > 0 && (
          <Link href={dayHref} className={cn("px-1 text-[11px] font-medium text-muted-foreground md:hidden", FOCUS_RING)}>
            +{tiers.mobile.overflowCount}
          </Link>
        )}
        {tiers.desktop.overflowCount > 0 && (
          <Link href={dayHref} className={cn("hidden px-1 text-[11px] font-medium text-muted-foreground md:inline", FOCUS_RING)}>
            +{tiers.desktop.overflowCount}件
          </Link>
        )}
      </div>

      {/* Fills any leftover vertical space in quiet cells with an extra tap
          target to the day view. aria-hidden + tabIndex=-1 because the day
          number Link above already provides a fully accessible route to the
          same destination - this must not become a second, redundant
          keyboard/screen-reader stop. */}
      <Link href={dayHref} aria-hidden="true" tabIndex={-1} className="block flex-1" />
    </div>
  );
}
