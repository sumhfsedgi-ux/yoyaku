import Link from "next/link";
import { DateTime } from "luxon";
import { dateToJst } from "@/lib/time/tz";
import type { CalendarScopeParam, RoomTimelineEntry } from "@/lib/calendar/types";
import { computeMonthCellTiers } from "@/lib/calendar/monthCell";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function entryStyle(entry: RoomTimelineEntry): string {
  if (entry.kind === "googleBusy") return "bg-muted text-muted-foreground";
  if (entry.isMine) return "bg-primary/15 text-foreground font-medium";
  return "bg-muted/70 text-muted-foreground";
}

/**
 * Month grid where each cell shows the day's actual entries (time + label),
 * not just a count, in plain chronological order (no reordering by
 * own/other/Google - calendarScope="room" is meant to show the room's
 * timeline as-is; "自分の予約" is distinguished visually via entryStyle
 * above, not by moving it earlier). Cells never grow with content: excess
 * entries collapse into "+N件".
 *
 * Visible count is responsive to actual viewport width via CSS breakpoints
 * (sm/md), not a JS matchMedia hook (useIsMobile) - up to 3 entries per day
 * are always rendered into the DOM, and Tailwind's `hidden sm:flex` /
 * `hidden md:flex` classes decide which ones are actually shown, so the
 * transition is smooth at any width instead of snapping at one hardcoded
 * "mobile" boundary. computeMonthCellTiers precomputes the visible/overflow
 * split for all three tiers in one call (lib/calendar/monthCell.ts).
 *
 * Whole cell is a single link to that day's day view (month = overview, day
 * = detail - tapping ANYTHING in a cell, including bare whitespace or the
 * day number, goes to the day view; entries are not independently clickable
 * to avoid nesting a second link inside the cell).
 */
export function MonthGrid({
  year,
  month,
  entriesByDate,
  scope,
}: {
  year: number;
  month: number;
  entriesByDate: Record<string, RoomTimelineEntry[]>;
  scope: CalendarScopeParam;
}) {
  const monthStart = DateTime.fromObject({ year, month, day: 1 });
  // Luxon weeks start Monday by default; shift so the grid starts on Sunday to match WEEKDAY_LABELS.
  const firstCell = monthStart.minus({ days: monthStart.weekday % 7 });
  const days = Array.from({ length: 42 }, (_, i) => firstCell.plus({ days: i }));
  const todayISO = DateTime.now().setZone("Asia/Tokyo").toISODate();

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="py-2">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const dateISO = day.toISODate()!;
          const inMonth = day.month === month;
          const isToday = dateISO === todayISO;
          const entries = entriesByDate[dateISO] ?? [];
          const tiers = computeMonthCellTiers(entries);
          const mobileEntry = tiers.mobile.visible[0];

          return (
            <Link
              key={dateISO}
              href={`/calendar?view=day&scope=${scope}&date=${dateISO}`}
              className={cn(
                "flex min-h-[4.5rem] flex-col gap-0.5 rounded-lg border p-1 text-sm transition-colors sm:min-h-[5.25rem] md:min-h-[6.5rem]",
                FOCUS_RING,
                inMonth
                  ? "border-border bg-card hover:bg-muted/50 active:bg-muted/70"
                  : "border-transparent text-muted-foreground/40 hover:bg-muted/20 active:bg-muted/30",
              )}
            >
              <span className={cn("px-0.5 text-xs", isToday && "font-semibold text-primary")}>{day.day}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                {/* Mobile-only: the single visible entry gets its own two-line
                    (time above, label below) rendering instead of squeezing
                    onto one line - a 7-column grid at phone width leaves
                    essentially no horizontal room left after "HH:mm", but
                    showing only 1 entry frees up enough VERTICAL room for a
                    second short line. Hidden from sm: up, where the
                    horizontal entries below take over. */}
                {mobileEntry && (
                  <div className={cn("flex flex-col gap-0 rounded px-1 py-0.5 text-[11px] leading-tight sm:hidden", entryStyle(mobileEntry))}>
                    <span className="font-medium">{dateToJst(mobileEntry.startAt).toFormat("HH:mm")}</span>
                    <span className="min-w-0 truncate">{mobileEntry.label}</span>
                  </div>
                )}

                {tiers.desktop.visible.map((entry, i) => (
                  <div
                    key={entry.id}
                    className={cn(
                      "hidden min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight",
                      i < 2 ? "sm:flex" : "md:flex",
                      entryStyle(entry),
                    )}
                  >
                    <span className="shrink-0 font-medium">{dateToJst(entry.startAt).toFormat("HH:mm")}</span>
                    {/* min-w-0 is required here - a flex item's default
                        min-width:auto overrides `truncate`'s overflow-hidden,
                        so without this the label would collapse to 0 width
                        instead of showing an ellipsis. */}
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  </div>
                ))}

                {tiers.mobile.overflowCount > 0 && (
                  <span className="px-1 text-[11px] font-medium text-muted-foreground sm:hidden">+{tiers.mobile.overflowCount}件</span>
                )}
                {tiers.tablet.overflowCount > 0 && (
                  <span className="hidden px-1 text-[11px] font-medium text-muted-foreground sm:inline md:hidden">
                    +{tiers.tablet.overflowCount}件
                  </span>
                )}
                {tiers.desktop.overflowCount > 0 && (
                  <span className="hidden px-1 text-[11px] font-medium text-muted-foreground md:inline">+{tiers.desktop.overflowCount}件</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
