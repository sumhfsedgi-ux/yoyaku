"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { CalendarClockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveDialogOrSheet } from "@/components/ui/responsive-dialog-or-sheet";
import { DateStrip } from "@/components/reserve/DateStrip";
import { TimeSlotChips } from "@/components/reserve/TimeSlotChips";
import { getReschedulableSlots } from "@/actions/rescheduleAvailability";
import { rescheduleReservationAction } from "@/actions/reschedule";
import { toUserMessage } from "@/lib/errors/userMessages";

export function RescheduleReservationDialog({
  reservationId,
  bookingWindowDays,
}: {
  reservationId: string;
  bookingWindowDays: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dateISO, setDateISO] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || !dateISO) return;
    // See ManualReservationForm.tsx for why this synchronous setState is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingSlots(true);
    setSelectedSlot(null);
    getReschedulableSlots(reservationId, dateISO)
      .then((result) => setSlots(result.ok ? result.slots : []))
      .finally(() => setLoadingSlots(false));
  }, [open, dateISO, reservationId]);

  function handleConfirm() {
    if (!selectedSlot) return;
    startTransition(async () => {
      const result = await rescheduleReservationAction(reservationId, selectedSlot);
      if (!result.ok) {
        toast.error(toUserMessage(result.reason));
        return;
      }
      toast.success("予約日時を変更しました");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="touch" onClick={() => setOpen(true)}>
        <CalendarClockIcon data-icon="inline-start" />
        日時を変更
      </Button>
      <ResponsiveDialogOrSheet
        open={open}
        onOpenChange={setOpen}
        title="日時を変更"
        description="新しい日時を選択してください。"
        footer={
          <Button size="touch" disabled={!selectedSlot || isPending} onClick={handleConfirm}>
            {isPending ? "変更中..." : "この日時に変更する"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <DateStrip
            selectedISO={dateISO}
            onSelect={setDateISO}
            windowDays={bookingWindowDays}
          />
          {dateISO && (
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">
                {DateTime.fromISO(dateISO).toFormat("M月d日 (ccc)", { locale: "ja" })}
              </p>
              {loadingSlots ? (
                <p className="text-sm text-muted-foreground">読み込み中...</p>
              ) : (
                <TimeSlotChips slots={slots} selected={selectedSlot} onSelect={setSelectedSlot} />
              )}
            </div>
          )}
        </div>
      </ResponsiveDialogOrSheet>
    </>
  );
}
