/**
 * Splits a day's timeline entries into what a month cell can actually show
 * plus an overflow count, without growing the cell taller than maxVisible
 * rows - see MonthGrid.tsx.
 */
export function truncateMonthEntries<T>(entries: T[], maxVisible: number): { visible: T[]; overflowCount: number } {
  if (entries.length <= maxVisible) return { visible: entries, overflowCount: 0 };
  return { visible: entries.slice(0, maxVisible), overflowCount: entries.length - maxVisible };
}

export interface MonthCellTier<T> {
  visible: T[];
  overflowCount: number;
}

export interface MonthCellTiers<T> {
  mobile: MonthCellTier<T>;
  tablet: MonthCellTier<T>;
  desktop: MonthCellTier<T>;
}

/**
 * Precomputes all three responsive tiers (mobile/tablet/desktop) for a day's
 * entries in one call, so MonthGrid.tsx can render all three into the DOM
 * and let CSS breakpoints (not a JS viewport hook) decide which one is
 * actually visible - see MonthGrid.tsx for why that's preferred over a
 * useIsMobile()-style boolean check here.
 */
export function computeMonthCellTiers<T>(entries: T[]): MonthCellTiers<T> {
  return {
    mobile: truncateMonthEntries(entries, 2),
    tablet: truncateMonthEntries(entries, 2),
    desktop: truncateMonthEntries(entries, 3),
  };
}
