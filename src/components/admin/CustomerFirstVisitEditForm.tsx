"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateMyCustomerFirstVisitInfo } from "@/actions/customers";

const NO_SOURCE_VALUE = "__none__";

/**
 * "訂正用" editor for Customer.firstVisitDate/firstVisitAcquisitionSourceId -
 * see plan §3. Normal recording happens automatically from the customer's
 * first VisitRecord; this form exists to backfill an existing customer or fix
 * a mistake, not as the primary entry point.
 */
export function CustomerFirstVisitEditForm({
  customerId,
  firstVisitDate,
  firstVisitAcquisitionSourceId,
  acquisitionSourceOptions,
}: {
  customerId: string;
  firstVisitDate: Date | null;
  firstVisitAcquisitionSourceId: string | null;
  acquisitionSourceOptions: { id: string; name: string; active: boolean }[];
}) {
  const router = useRouter();
  const [dateISO, setDateISO] = useState(firstVisitDate ? firstVisitDate.toISOString().slice(0, 10) : "");
  const [sourceId, setSourceId] = useState(firstVisitAcquisitionSourceId ?? NO_SOURCE_VALUE);
  const [isPending, startTransition] = useTransition();

  const visibleSourceOptions = acquisitionSourceOptions.filter((o) => o.active || o.id === firstVisitAcquisitionSourceId);

  function handleSave() {
    startTransition(async () => {
      try {
        await updateMyCustomerFirstVisitInfo({
          customerId,
          firstVisitDateISO: dateISO || null,
          firstVisitAcquisitionSourceId: sourceId === NO_SOURCE_VALUE ? null : sourceId,
        });
        toast.success("初回来店情報を保存しました");
        router.refresh();
      } catch {
        toast.error("入力内容をご確認ください。");
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-3 text-sm font-semibold text-foreground">初回来店情報(訂正)</p>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="firstVisitDate">初回来店日</Label>
          <Input id="firstVisitDate" type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} className="h-11 text-base" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="firstVisitSource">流入経路</Label>
          <Select
            items={{
              [NO_SOURCE_VALUE]: "未設定",
              ...Object.fromEntries(visibleSourceOptions.map((option) => [option.id, `${option.name}${option.active ? "" : "(非表示)"}`])),
            }}
            value={sourceId}
            onValueChange={(value) => setSourceId(value ?? NO_SOURCE_VALUE)}
          >
            <SelectTrigger id="firstVisitSource" className="h-11 w-full text-base">
              <SelectValue placeholder="未設定" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SOURCE_VALUE}>未設定</SelectItem>
              {visibleSourceOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                  {!option.active ? "(非表示)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button size="sm" disabled={isPending} onClick={handleSave}>
        {isPending ? "保存中..." : "保存する"}
      </Button>
    </div>
  );
}
