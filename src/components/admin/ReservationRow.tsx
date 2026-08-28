import Link from "next/link";
import { UserIcon } from "lucide-react";
import { dateToJst } from "@/lib/time/tz";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";
import type { RoomUsageRow } from "@/lib/reservations/queries";

function timeRange(row: RoomUsageRow): string {
  const start = dateToJst(row.startAt);
  const end = dateToJst(row.endAt);
  return `${start.toFormat("HH:mm")}〜${end.toFormat("HH:mm")}`;
}

/**
 * A single room-usage entry, used on the dashboard and calendar day view. Own
 * reservations link to their detail page and are visually distinguished with
 * a filled badge + person icon (not color alone) - other staff's show only
 * name + time, matching the PII boundary already enforced server-side in
 * listReservationsForDay().
 */
export function ReservationRow({ row }: { row: RoomUsageRow }) {
  const content = (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-muted/40 active:bg-muted/60">
      <div className="flex items-center gap-3">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
            row.isMine ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
          aria-hidden="true"
        >
          <UserIcon className="size-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{timeRange(row)}</p>
          <p className="text-xs text-muted-foreground">{row.staffDisplayName}</p>
        </div>
      </div>
      <Badge variant={row.isMine ? "default" : "outline"}>{row.isMine ? "自分" : row.staffDisplayName}</Badge>
    </div>
  );

  if (!row.isMine) {
    return <div aria-disabled="true">{content}</div>;
  }
  return (
    <Link href={`/reservations/${row.id}`} prefetch={false} className={cn("block rounded-xl", FOCUS_RING)}>
      {content}
    </Link>
  );
}
