import Link from "next/link";
import { dateToJst } from "@/lib/time/tz";
import type { RoomTimelineEntry } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";

const TIMELINE_START_HOUR = 8;
const TIMELINE_END_HOUR = 21;
const PIXELS_PER_MINUTE = 1.1;
const TIMELINE_HEIGHT = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60 * PIXELS_PER_MINUTE;

function minutesFromTimelineStart(date: Date): number {
  const jst = dateToJst(date);
  return (jst.hour - TIMELINE_START_HOUR) * 60 + jst.minute;
}

function blockStyle(startAt: Date, endAt: Date): React.CSSProperties {
  const top = Math.max(0, minutesFromTimelineStart(startAt)) * PIXELS_PER_MINUTE;
  const bottom = Math.min((TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60, minutesFromTimelineStart(endAt)) * PIXELS_PER_MINUTE;
  return { top: `${top}px`, height: `${Math.max(bottom - top, 28)}px` };
}

/**
 * Vertical day timeline: 15-minute gridlines (bolder every hour), entries
 * positioned by time. `entries` already encodes everything needed to render
 * (kind/isMine/label) - see lib/calendar/roomUsage.ts for how "mine" vs
 * "room" scope produce different entry lists while keeping this component
 * itself scope-agnostic. Own reservations link to detail; other staff's and
 * Google busy blocks are not interactive.
 */
export function DayTimeline({ entries }: { entries: RoomTimelineEntry[] }) {
  const hours = Array.from({ length: TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1 }, (_, i) => TIMELINE_START_HOUR + i);

  return (
    <div className="relative flex" style={{ height: `${TIMELINE_HEIGHT}px` }}>
      <div className="relative w-14 shrink-0 text-right text-xs text-muted-foreground">
        {hours.map((h) => (
          <div key={h} className="absolute right-2 -translate-y-1/2" style={{ top: `${(h - TIMELINE_START_HOUR) * 60 * PIXELS_PER_MINUTE}px` }}>
            {h}:00
          </div>
        ))}
      </div>
      <div className="relative flex-1 border-l border-border">
        {hours.map((h) => (
          <div
            key={h}
            className="absolute inset-x-0 border-t border-border"
            style={{ top: `${(h - TIMELINE_START_HOUR) * 60 * PIXELS_PER_MINUTE}px` }}
          />
        ))}
        {hours.map((h) =>
          [15, 30, 45].map((m) => (
            <div
              key={`${h}-${m}`}
              className="absolute inset-x-0 border-t border-border/40"
              style={{ top: `${((h - TIMELINE_START_HOUR) * 60 + m) * PIXELS_PER_MINUTE}px` }}
            />
          )),
        )}

        {entries.map((entry) => {
          const content = (
            <>
              <p className={cn("text-xs font-medium", entry.kind === "googleBusy" && "text-muted-foreground")}>
                {dateToJst(entry.startAt).toFormat("HH:mm")}〜{dateToJst(entry.endAt).toFormat("HH:mm")}
              </p>
              <p
                className={cn(
                  "truncate text-xs",
                  entry.kind === "googleBusy"
                    ? "text-muted-foreground"
                    : entry.isMine
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground",
                )}
              >
                {entry.label}
              </p>
            </>
          );
          // The block's className/style live on whichever element is actually
          // rendered (the Link itself for isMine, the plain div otherwise) -
          // previously they lived on an always-present inner div that this
          // wrapper merely contained, which for the isMine <Link> case left
          // the Link with no sizing of its own (its only child was
          // position:absolute, taking it out of flow), collapsing the Link to
          // a 0x0 box and making its focus-visible outline invisible/
          // mispositioned. Putting position:absolute directly on the
          // focusable element fixes that.
          const blockClassName = cn(
            "absolute inset-x-1 overflow-hidden rounded-lg border px-2 py-1 shadow-sm transition-colors",
            entry.kind === "googleBusy"
              ? "border-muted-foreground/30 bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,var(--muted)_4px,var(--muted)_8px)]"
              : entry.isMine
                ? "border-primary/30 bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80"
                : "border-border bg-card text-foreground hover:bg-muted/40",
          );
          return entry.isMine ? (
            <Link
              key={entry.id}
              href={`/reservations/${entry.id}`}
              prefetch={false}
              className={cn(blockClassName, FOCUS_RING)}
              style={blockStyle(entry.startAt, entry.endAt)}
            >
              {content}
            </Link>
          ) : (
            <div key={entry.id} aria-disabled="true" className={blockClassName} style={blockStyle(entry.startAt, entry.endAt)}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
