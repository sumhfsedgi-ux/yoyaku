"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resyncCalendarEventAction } from "@/actions/adminReservations";

/**
 * Only rendered when googleSyncStatus is FAILED (see reservations/[id]/page.tsx) -
 * this was previously the one recovery path documented in
 * resyncReservationCalendarEvent's own comments but never reachable from any
 * screen. resyncCalendarEventAction is itself best-effort (it can leave the
 * status FAILED again if Google is still unreachable), so this only ever
 * reports that a retry was attempted, then refreshes to show the real
 * resulting badge.
 */
export function ResyncCalendarEventButton({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await resyncCalendarEventAction(reservationId);
        if (!result.ok) {
          toast.error("再同期できませんでした。もう一度お試しください。");
          return;
        }
        toast.success("Googleカレンダーへの再同期を実行しました");
        router.refresh();
      } catch {
        toast.error("再同期できませんでした。もう一度お試しください。");
      }
    });
  }

  return (
    <Button variant="outline" size="touch" disabled={isPending} onClick={handleClick}>
      {isPending ? "再同期中..." : "Googleカレンダーに再同期"}
    </Button>
  );
}
