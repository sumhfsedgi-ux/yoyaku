"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateMySalonName } from "@/actions/profile";

/**
 * `initialSalonName` comes from the server (see app/(admin)/settings/page.tsx)
 * so the first paint already shows the staff's real value - no client-side
 * fetch-on-mount round trip, same convention as BookingSettingsForm.
 */
export function SalonNameForm({ initialSalonName }: { initialSalonName: string | null }) {
  const [salonName, setSalonName] = useState(initialSalonName ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      try {
        await updateMySalonName({ salonName });
        toast.success("サロン名を保存しました");
      } catch {
        toast.error("入力内容をご確認ください。");
      }
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="mb-1 text-sm font-semibold text-foreground">サロン名</p>
      <p className="mb-3 text-xs text-muted-foreground">お客様の予約画面に表示されます</p>
      <div className="flex flex-col gap-3">
        <Input
          id="salon-name"
          value={salonName}
          onChange={(e) => setSalonName(e.target.value)}
          maxLength={100}
          className="h-11 text-base"
        />
        <Button size="touch" disabled={isPending} onClick={handleSave} className="self-start">
          {isPending ? "保存中..." : "保存する"}
        </Button>
      </div>
    </section>
  );
}
