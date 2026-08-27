/**
 * Shared interaction-state class fragments for hover/active(press)/selected/
 * disabled/focus-visible feedback, kept in one place so every clickable
 * element in the app converges on the same feel instead of each component
 * reinventing its own recipe. Plain functions/constants (not cva()) - this
 * project reserves cva for components with real variant *trees*
 * (Button/Tabs/Badge); everything here composes into a caller's own cn()
 * call alongside that component's own sizing/layout classes, which this
 * module intentionally never touches.
 */

/**
 * Canonical focus-visible ring - identical to components/ui/button.tsx's own
 * treatment. Every focusable element adopts this exact string, replacing the
 * outline-based one-offs (DayTimeline, ReservationRow) and filling gaps
 * elsewhere (nav links, chips, form inputs without it).
 */
export const FOCUS_RING = "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Default/hover/active/selected/disabled recipe shared by the app's
 * "selectable chip" tiles - TwoWeekAvailabilityGrid's DayCell, TimeSlotChips'
 * Chip, and DateStrip's day button. Each keeps its own sizing/layout classes
 * (height, width, radius, gap) and composes them with this via cn(); only
 * pass `disabled` for TwoWeekAvailabilityGrid - TimeSlotChips/DateStrip never
 * render a disabled chip.
 *
 * active = motion (scale), not a third color tier, matching button.tsx's own
 * hover=color / active=motion split. Callers adding `active:scale-*` must use
 * `transition-all` (not `transition-colors`, which doesn't animate transform).
 */
export function chipStateClasses({ selected, disabled = false }: { selected: boolean; disabled?: boolean }): string {
  if (disabled) {
    return "cursor-not-allowed border-border/60 bg-muted/20 opacity-50";
  }
  if (selected) {
    return "cursor-pointer border-primary bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] active:bg-primary/80";
  }
  return "cursor-pointer border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted/40 active:scale-[0.98] active:bg-muted/60";
}
