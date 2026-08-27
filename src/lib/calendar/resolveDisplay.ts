import type { CalendarScopeParam, CalendarViewParam } from "./types";

export interface CalendarDisplay {
  view: CalendarViewParam;
  scope: CalendarScopeParam;
}

export const DEFAULT_CALENDAR_DISPLAY: CalendarDisplay = { view: "day", scope: "mine" };

/**
 * Precedence for what /calendar actually shows: an explicit URL query param
 * always wins (so a shared/bookmarked link behaves predictably); otherwise
 * fall back to the staff's saved preference; otherwise the hard default.
 * Pure and DB-free so it's unit-testable on its own - the DB read/write
 * itself lives in actions/calendar.ts.
 */
export function resolveCalendarDisplay(
  urlParams: { view?: string; scope?: string },
  saved: CalendarDisplay,
): CalendarDisplay {
  const view: CalendarViewParam =
    urlParams.view === "day" || urlParams.view === "month" ? urlParams.view : saved.view;
  const scope: CalendarScopeParam =
    urlParams.scope === "mine" || urlParams.scope === "room" ? urlParams.scope : saved.scope;
  return { view, scope };
}
