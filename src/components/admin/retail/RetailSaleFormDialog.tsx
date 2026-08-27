"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ResponsiveDialogOrSheet } from "@/components/ui/responsive-dialog-or-sheet";
import { PurchaserPicker, type RetailPurchaser } from "./PurchaserPicker";
import { createMyRetailSale, updateMyRetailSale } from "@/actions/retail";
import { toUserMessage } from "@/lib/errors/userMessages";
import type { RetailSaleListItem } from "@/lib/retail/queries";

type RetailSaleFormDialogProps = {
  productSuggestions: string[];
  trigger: (openProps: { onClick: () => void }) => React.ReactNode;
} & ({ mode: "create"; defaultSoldAtISO: string } | { mode: "edit"; sale: RetailSaleListItem });

interface ItemRow {
  key: string;
  productName: string;
  quantity: string;
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `item${keySeq}`;
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function emptyItemRow(): ItemRow {
  return { key: nextKey(), productName: "", quantity: "1" };
}

export function RetailSaleFormDialog(props: RetailSaleFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [soldAtISO, setSoldAtISO] = useState(props.mode === "create" ? props.defaultSoldAtISO : toISODate(props.sale.soldAt));
  const [purchaser, setPurchaser] = useState<RetailPurchaser | null>(
    props.mode === "edit" && props.sale.customerId ? { id: props.sale.customerId, name: props.sale.customerName ?? "" } : null,
  );
  const [noCustomer, setNoCustomer] = useState(props.mode === "edit" ? props.sale.customerId === null : false);
  const [items, setItems] = useState<ItemRow[]>(
    props.mode === "edit" && props.sale.items.length > 0
      ? props.sale.items.map((i) => ({ key: nextKey(), productName: i.productName, quantity: String(i.quantity) }))
      : [emptyItemRow()],
  );
  const [totalAmount, setTotalAmount] = useState(props.mode === "edit" ? String(props.sale.totalAmount) : "");
  const [memo, setMemo] = useState(props.mode === "edit" ? (props.sale.memo ?? "") : "");
  const [isPending, startTransition] = useTransition();

  function resetForNextCreate() {
    if (props.mode !== "create") return;
    setSoldAtISO(props.defaultSoldAtISO);
    setPurchaser(null);
    setNoCustomer(false);
    setItems([emptyItemRow()]);
    setTotalAmount("");
    setMemo("");
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItemRow()]);
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((i) => i.key !== key) : prev));
  }

  function updateItem(key: string, field: "productName" | "quantity", value: string) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)));
  }

  const purchaserResolved = purchaser !== null || noCustomer;
  const amountNumber = Number(totalAmount);
  const itemsValid = items.every((i) => i.productName.trim().length > 0 && Number.isInteger(Number(i.quantity)) && Number(i.quantity) >= 1);
  const canSubmit =
    soldAtISO.length > 0 && purchaserResolved && itemsValid && totalAmount.trim().length > 0 && Number.isInteger(amountNumber) && amountNumber >= 0;

  function handleSubmit() {
    startTransition(async () => {
      const payload = {
        customerId: noCustomer ? null : purchaser!.id,
        soldAtISO,
        totalAmount: amountNumber,
        memo: memo.trim() || undefined,
        items: items.map((i) => ({ productName: i.productName.trim(), quantity: Number(i.quantity) })),
      };

      const result = props.mode === "create" ? await createMyRetailSale(payload) : await updateMyRetailSale({ ...payload, id: props.sale.id });

      if (!result.ok) {
        toast.error(toUserMessage(result.reason));
        return;
      }
      toast.success(props.mode === "create" ? "小売実績を登録しました" : "小売実績を更新しました");
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
        title={props.mode === "create" ? "小売実績を登録" : "小売実績を編集"}
        footer={
          <Button size="touch" disabled={!canSubmit || isPending} onClick={handleSubmit}>
            {isPending ? "保存中..." : "保存する"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="soldAt">販売日</Label>
            <Input id="soldAt" type="date" value={soldAtISO} onChange={(e) => setSoldAtISO(e.target.value)} className="h-11 text-base" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>購入者</Label>
            <PurchaserPicker
              selected={purchaser}
              noCustomer={noCustomer}
              onSelect={(p) => {
                setPurchaser(p);
                setNoCustomer(false);
              }}
              onSelectNoCustomer={() => {
                setNoCustomer(true);
                setPurchaser(null);
              }}
              onClear={() => {
                setPurchaser(null);
                setNoCustomer(false);
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>商品明細</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addItem}>
                <PlusIcon data-icon="inline-start" className="size-3.5" />
                商品を追加
              </Button>
            </div>
            <datalist id="retailProductNames">
              {props.productSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <div className="flex flex-col gap-2">
              {items.map((item) => (
                <div key={item.key} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`product-${item.key}`}>商品名</Label>
                    <Input
                      id={`product-${item.key}`}
                      list="retailProductNames"
                      value={item.productName}
                      onChange={(e) => updateItem(item.key, "productName", e.target.value)}
                      className="h-11 text-base"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label htmlFor={`quantity-${item.key}`}>数量</Label>
                      <Input
                        id={`quantity-${item.key}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(item.key, "quantity", e.target.value)}
                        className="h-11 text-base"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-touch"
                      onClick={() => removeItem(item.key)}
                      disabled={items.length === 1}
                      aria-label="この商品を削除"
                    >
                      <Trash2Icon className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="totalAmount">会計金額(全体)</Label>
            <Input
              id="totalAmount"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              className="h-11 text-base"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="memo">メモ</Label>
            <Textarea id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
        </div>
      </ResponsiveDialogOrSheet>
    </>
  );
}
