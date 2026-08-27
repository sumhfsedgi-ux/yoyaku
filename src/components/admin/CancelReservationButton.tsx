"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cancelReservationAction } from "@/actions/adminReservations";
import { toUserMessage } from "@/lib/errors/userMessages";

export function CancelReservationButton({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!window.confirm("この予約をキャンセルしますか？")) return;
    startTransition(async () => {
      const result = await cancelReservationAction(reservationId);
      if (!result.ok) {
        toast.error(toUserMessage(result.reason));
        return;
      }
      toast.success("予約をキャンセルしました");
      router.refresh();
    });
  }

  return (
    <Button variant="destructive" size="touch" disabled={isPending} onClick={handleClick}>
      {isPending ? "処理中..." : "予約をキャンセル"}
    </Button>
  );
}
