"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveDialogOrSheet } from "@/components/ui/responsive-dialog-or-sheet";
import { Button } from "@/components/ui/button";
import { ConcernChipPicker } from "@/components/admin/ConcernChipPicker";
import { createMyVisitRecord, updateMyVisitRecord } from "@/actions/visitRecords";
import type { VisitRecordListItem } from "@/lib/customers/queries";
import { toUserMessage } from "@/lib/errors/userMessages";

export interface ConcernMasterOption {
  id: string;
  name: string;
  active: boolean;
}

export interface AcquisitionSourceOption {
  id: string;
  name: string;
}

type VisitRecordFormDialogProps = {
  allConcernMasters: ConcernMasterOption[];
  trigger: (openProps: { onClick: () => void }) => React.ReactNode;
} & (
  | {
      mode: "create";
      customerId: string;
      reservationId?: string;
      defaultVisitDateISO: string;
      /** true when this customer has no VisitRecord/firstVisitDate yet - shows the flow-source Select. See plan §7. */
      isFirstVisit: boolean;
      acquisitionSourceOptions: AcquisitionSourceOption[];
    }
  | {
      mode: "edit";
      visitRecord: VisitRecordListItem;
    }
);

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function VisitRecordFormDialog(props: VisitRecordFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [visitDateISO, setVisitDateISO] = useState(
    props.mode === "create" ? props.defaultVisitDateISO : toISODate(props.visitRecord.visitDate),
  );
  const [amount, setAmount] = useState(props.mode === "edit" ? String(props.visitRecord.amount) : "");
  const [concernIds, setConcernIds] = useState<string[]>(props.mode === "edit" ? props.visitRecord.concerns.map((c) => c.id) : []);
  const [concernDetail, setConcernDetail] = useState(props.mode === "edit" ? (props.visitRecord.concernDetail ?? "") : "");
  const [customerImpression, setCustomerImpression] = useState(props.mode === "edit" ? (props.visitRecord.customerImpression ?? "") : "");
  const [staffComment, setStaffComment] = useState(props.mode === "edit" ? (props.visitRecord.staffComment ?? "") : "");
  const [nextVisitMemo, setNextVisitMemo] = useState(props.mode === "edit" ? (props.visitRecord.nextVisitMemo ?? "") : "");
  const [acquisitionSourceId, setAcquisitionSourceId] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  // Active concerns are always selectable; a currently-selected concern that
  // has since been hidden stays visible (suffixed) instead of silently
  // disappearing - see plan §4. In create mode concernIds starts empty, so
  // this is equivalent to "active only" there.
  const visibleConcernOptions = props.allConcernMasters.filter((c) => c.active || concernIds.includes(c.id));

  const showAcquisitionSourceField = props.mode === "create" && props.isFirstVisit;
  const amountNumber = Number(amount);
  const canSubmit = visitDateISO.length > 0 && amount.trim().length > 0 && Number.isInteger(amountNumber) && amountNumber >= 0;

  function resetForNextCreate() {
    if (props.mode !== "create") return;
    setVisitDateISO(props.defaultVisitDateISO);
    setAmount("");
    setConcernIds([]);
    setConcernDetail("");
    setCustomerImpression("");
    setStaffComment("");
    setNextVisitMemo("");
    setAcquisitionSourceId("");
  }

  function handleSubmit() {
    startTransition(async () => {
      const shared = {
        visitDateISO,
        amount: amountNumber,
        concernIds,
        concernDetail: concernDetail.trim() || undefined,
        customerImpression: customerImpression.trim() || undefined,
        staffComment: staffComment.trim() || undefined,
        nextVisitMemo: nextVisitMemo.trim() || undefined,
      };

      const result =
        props.mode === "create"
          ? await createMyVisitRecord({
              ...shared,
              customerId: props.customerId,
              reservationId: props.reservationId,
              firstVisitAcquisitionSourceId: acquisitionSourceId || undefined,
            })
          : await updateMyVisitRecord({ ...shared, id: props.visitRecord.id });

      if (!result.ok) {
        toast.error(toUserMessage(result.reason));
        return;
      }
      toast.success(props.mode === "create" ? "来店記録を保存しました" : "来店記録を更新しました");
      setOpen(false);
      resetForNextCreate();
      router.refresh();
    });
  }

  return (
    <>
      {props.trigger({ onClick: () => setOpen(true) })}
      <ResponsiveDialogOrSheet
        open={open}
        onOpenChange={setOpen}
        title={props.mode === "create" ? "来店記録を追加" : "来店記録を編集"}
        footer={
          <Button size="touch" disabled={!canSubmit || isPending} onClick={handleSubmit}>
            {isPending ? "保存中..." : "保存する"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="visitDate">来店日</Label>
            <Input id="visitDate" type="date" value={visitDateISO} onChange={(e) => setVisitDateISO(e.target.value)} className="h-11 text-base" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="amount">金額(実際にお預かりした金額)</Label>
            <Input
              id="amount"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-11 text-base"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>お悩み</Label>
            <ConcernChipPicker options={visibleConcernOptions} selectedIds={concernIds} onChange={setConcernIds} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="concernDetail">お悩み(自由記入)</Label>
            <Textarea id="concernDetail" value={concernDetail} onChange={(e) => setConcernDetail(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customerImpression">お客様感想</Label>
            <Textarea id="customerImpression" value={customerImpression} onChange={(e) => setCustomerImpression(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staffComment">スタッフコメント</Label>
            <Textarea id="staffComment" value={staffComment} onChange={(e) => setStaffComment(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nextVisitMemo">次回への申し送り</Label>
            <Textarea id="nextVisitMemo" value={nextVisitMemo} onChange={(e) => setNextVisitMemo(e.target.value)} />
          </div>

          {showAcquisitionSourceField && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="acquisitionSource">どこから来たか(初回来店のみ)</Label>
              <Select
                items={Object.fromEntries(props.acquisitionSourceOptions.map((option) => [option.id, option.name]))}
                value={acquisitionSourceId}
                onValueChange={(value) => setAcquisitionSourceId(value ?? "")}
              >
                <SelectTrigger id="acquisitionSource" className="h-11 w-full text-base">
                  <SelectValue placeholder="選択してください(あとで訂正できます)" />
                </SelectTrigger>
                <SelectContent>
                  {props.acquisitionSourceOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </ResponsiveDialogOrSheet>
    </>
  );
}
