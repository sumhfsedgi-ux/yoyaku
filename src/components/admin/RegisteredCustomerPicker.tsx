"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ResponsiveDialogOrSheet } from "@/components/ui/responsive-dialog-or-sheet";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";
import { dateToJst } from "@/lib/time/tz";
import { toUserMessage } from "@/lib/errors/userMessages";
import { searchMyCustomers } from "@/actions/customerSearch";
import { getMyCustomerDetail, updateMyCustomerContactInfo } from "@/actions/customers";
import type { CustomerSearchRow } from "@/lib/customers/search";

export interface SelectedCustomer {
  id: string;
  name: string;
  email: string;
  phone: string;
  lastVisitDate: Date | null;
  visitCount: number;
}

export interface ContactOverride {
  name: string;
  email: string;
  phone: string;
}

const DEBOUNCE_MS = 300;

function formatLastVisit(date: Date | null): string {
  return date ? dateToJst(date).toFormat("yyyy年M月d日") : "来店履歴なし";
}

export function RegisteredCustomerPicker({
  selected,
  onSelect,
  onDeselect,
  onRequestNewCustomer,
  contactOverride,
  onContactOverrideChange,
}: {
  selected: SelectedCustomer | null;
  onSelect: (customer: SelectedCustomer) => void;
  onDeselect: () => void;
  onRequestNewCustomer: () => void;
  contactOverride: ContactOverride | null;
  onContactOverrideChange: (override: ContactOverride | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CustomerSearchRow[]>([]);
  const [searchState, setSearchState] = useState<"loading" | "loaded" | "error">("loading");
  const [loadingRowId, setLoadingRowId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  function runSearch(q: string) {
    setSearchState("loading");
    searchMyCustomers(q)
      .then((result) => {
        setRows(result.items);
        setSearchState("loaded");
      })
      .catch(() => setSearchState("error"));
  }

  useEffect(() => {
    if (selected) return;
    const handle = setTimeout(() => runSearch(query), query ? DEBOUNCE_MS : 0);
    return () => clearTimeout(handle);
  }, [query, selected]);

  async function handlePick(row: CustomerSearchRow) {
    setLoadingRowId(row.id);
    try {
      const detail = await getMyCustomerDetail(row.id);
      onSelect({ id: detail.id, name: detail.name, email: detail.email, phone: detail.phone, lastVisitDate: row.lastVisitDate, visitCount: row.visitCount });
    } catch {
      toast.error("お客様情報を取得できませんでした。もう一度お試しください。");
    } finally {
      setLoadingRowId(null);
    }
  }

  function handleSearchAgain() {
    onDeselect();
    onContactOverrideChange(null);
    setQuery("");
    runSearch("");
    searchInputRef.current?.focus();
  }

  if (selected) {
    return (
      <SelectedCustomerCard
        selected={selected}
        contactOverride={contactOverride}
        onDeselect={() => {
          onDeselect();
          onContactOverrideChange(null);
        }}
        onSearchAgain={handleSearchAgain}
        onContactOverrideChange={onContactOverrideChange}
        onMasterUpdated={(updated) => onSelect({ ...selected, ...updated })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          ref={searchInputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名前・電話番号・メールアドレスで検索"
          className="h-11 pl-9 text-base"
        />
      </div>

      {searchState === "error" ? (
        <ErrorState reasonCode="UNKNOWN" onRetry={() => runSearch(query)} />
      ) : searchState === "loading" ? (
        <p className="px-1 py-4 text-sm text-muted-foreground">検索中...</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="該当するお客様が見つかりませんでした"
          action={
            <Button size="touch" onClick={onRequestNewCustomer}>
              初めてのお客様として登録する
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              disabled={loadingRowId !== null}
              onClick={() => handlePick(row)}
              className={cn(
                "flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left shadow-sm transition-colors hover:bg-muted/40 active:bg-muted/60 disabled:opacity-60",
                FOCUS_RING,
              )}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
                <p className="text-xs text-muted-foreground">下4桁 {row.phoneLast4} ・ 最終来店 {formatLastVisit(row.lastVisitDate)}</p>
              </div>
              <p className="shrink-0 text-xs text-muted-foreground">来店{row.visitCount}回</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SelectedCustomerCard({
  selected,
  contactOverride,
  onDeselect,
  onSearchAgain,
  onContactOverrideChange,
  onMasterUpdated,
}: {
  selected: SelectedCustomer;
  contactOverride: ContactOverride | null;
  onDeselect: () => void;
  onSearchAgain: () => void;
  onContactOverrideChange: (override: ContactOverride | null) => void;
  onMasterUpdated: (updated: ContactOverride) => void;
}) {
  const displayed = contactOverride ?? selected;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(displayed.name);
  const [editEmail, setEditEmail] = useState(displayed.email);
  const [editPhone, setEditPhone] = useState(displayed.phone);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function startEditing() {
    setEditName(displayed.name);
    setEditEmail(displayed.email);
    setEditPhone(displayed.phone);
    setEditing(true);
  }

  function handleSaveClick() {
    setConfirmOpen(true);
  }

  function applyThisBookingOnly() {
    onContactOverrideChange({ name: editName.trim(), email: editEmail.trim(), phone: editPhone.trim() });
    setConfirmOpen(false);
    setEditing(false);
  }

  function applyUpdateMaster() {
    startTransition(async () => {
      const result = await updateMyCustomerContactInfo({
        customerId: selected.id,
        name: editName.trim(),
        email: editEmail.trim(),
        phone: editPhone.trim(),
      });
      if (!result.ok) {
        toast.error(toUserMessage(result.reason));
        return;
      }
      onContactOverrideChange(null);
      onMasterUpdated({ name: editName.trim(), email: editEmail.trim(), phone: editPhone.trim() });
      toast.success("顧客情報を更新しました");
      setConfirmOpen(false);
      setEditing(false);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary bg-primary/5 p-4">
      {editing ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="editCustomerName">お名前</Label>
            <Input id="editCustomerName" value={editName} onChange={(e) => setEditName(e.target.value)} className="h-11 text-base" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="editCustomerEmail">メールアドレス</Label>
            <Input id="editCustomerEmail" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="h-11 text-base" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="editCustomerPhone">電話番号</Label>
            <Input id="editCustomerPhone" type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="090-1234-5678" className="h-11 text-base" />
          </div>
          <div className="flex gap-2">
            <Button size="touch" className="flex-1" onClick={handleSaveClick}>
              保存する
            </Button>
            <Button size="touch" variant="outline" className="flex-1" onClick={() => setEditing(false)}>
              キャンセル
            </Button>
          </div>

          <ResponsiveDialogOrSheet
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="顧客情報も更新しますか？"
            description="変更した内容を今後のためにお客様情報として保存するか、今回の予約だけに使うかを選べます。"
            footer={
              <div className="flex w-full flex-col gap-2">
                <Button size="touch" disabled={isPending} onClick={applyUpdateMaster}>
                  {isPending ? "更新中..." : "顧客情報を更新する"}
                </Button>
                <Button size="touch" variant="outline" disabled={isPending} onClick={applyThisBookingOnly}>
                  今回の予約情報だけ変更する
                </Button>
                <Button size="touch" variant="ghost" disabled={isPending} onClick={() => setConfirmOpen(false)}>
                  キャンセル
                </Button>
              </div>
            }
          >
            <div />
          </ResponsiveDialogOrSheet>
        </div>
      ) : (
        <>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{displayed.name}</p>
            <p className="truncate text-sm text-muted-foreground">{displayed.email}</p>
            <p className="truncate text-sm text-muted-foreground">{displayed.phone}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              最終来店 {formatLastVisit(selected.lastVisitDate)} ・ 予約{selected.visitCount}回
            </p>
            {contactOverride && <p className="mt-1 text-xs text-primary">今回の予約のみ連絡先を変更しています</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onDeselect}>
              選択を解除
            </Button>
            <Button size="sm" variant="outline" onClick={onSearchAgain}>
              別のお客様を検索
            </Button>
            <Button size="sm" variant="outline" onClick={startEditing}>
              顧客情報を編集
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
