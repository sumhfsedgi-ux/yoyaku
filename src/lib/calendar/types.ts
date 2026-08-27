export type CalendarViewParam = "day" | "month";
export type CalendarScopeParam = "mine" | "room";

/**
 * A single row on the calendar (day timeline or a month cell). `label` is
 * always a fully-resolved, display-safe string - "田中様" / "スタッフB" /
 * "部屋使用中" - never a raw Customer object. See lib/calendar/roomUsage.ts:
 * for any entry where isMine is false, the underlying Prisma query never
 * selects the customer relation in the first place, so there is no `label`
 * value this type could carry that would leak PII even by mistake.
 */
export interface RoomTimelineEntry {
  kind: "reservation" | "googleBusy";
  id: string;
  startAt: Date;
  endAt: Date;
  isMine: boolean;
  /** Present only for kind:"reservation". */
  staffId?: string;
  label: string;
}
