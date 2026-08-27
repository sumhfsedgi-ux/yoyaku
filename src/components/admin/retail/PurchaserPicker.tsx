"use client";

import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";
import { dateToJst } from "@/lib/time/tz";
import { searchMyCustomers } from "@/actions/customerSearch";
import type { CustomerSearchRow } from "@/lib/customers/search";

export interface RetailPurchaser {
  id: string;
  name: string;
}

const DEBOUNCE_MS = 300;

function formatLastVisit(date: Date | null): string {
  return date ? dateToJst(date).toFormat("yyyy年M月d日") : "来店履歴なし";
}

/**
 * Purchaser picker for the retail-sale form - deliberately lighter than
 * ManualReservationForm's RegisteredCustomerPicker (no contact editing, no
 * duplicate check, no "new customer" registration - a retail sale only ever
 * attaches to an EXISTING self-owned customer or explicitly "顧客登録なし").
 * Reuses the same self-only searchMyCustomers action.
 */
export function PurchaserPicker({
  selected,
  noCustomer,
  onSelect,
  onSelectNoCustomer,
  onClear,
}: {
  selected: RetailPurchaser | null;
  noCustomer: boolean;
  onSelect: (purchaser: RetailPurchaser) => void;
  onSelectNoCustomer: () => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CustomerSearchRow[]>([]);
  const [searchState, setSearchState] = useState<"loading" | "loaded" | "error">("loading");

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
    if (selected || noCustomer) return;
    const handle = setTimeout(() => runSearch(query), query ? DEBOUNCE_MS : 0);
    return () => clearTimeout(handle);
  }, [query, selected, noCustomer]);

  if (noCustomer) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-sm font-medium text-foreground">顧客登録なし</p>
        <p className="mt-1 text-xs text-muted-foreground">
          同じ未登録のお客様が複数回購入した場合、同一人物とは判定できません。正確なユニーク人数を集計したい場合は顧客登録が必要です。
        </p>
        <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onClear}>
          お客様を検索する
        </Button>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-primary bg-primary/5 p-4">
        <p className="min-w-0 truncate text-sm font-medium text-foreground">{selected.name}</p>
        <Button type="button" size="sm" variant="outline" onClick={onClear}>
          選択を解除
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="氏名・電話番号・メールアドレスで検索"
          className="h-11 pl-9 text-base"
        />
      </div>
      <Button type="button" size="touch" variant="outline" onClick={onSelectNoCustomer}>
        顧客登録なしで登録する
      </Button>

      {searchState === "error" ? (
        <ErrorState reasonCode="UNKNOWN" onRetry={() => runSearch(query)} />
      ) : searchState === "loading" ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">検索中...</p>
      ) : rows.length === 0 ? (
        <EmptyState title="該当するお客様が見つかりませんでした" />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onSelect({ id: row.id, name: row.name })}
              className={cn(
                "flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left shadow-sm transition-colors hover:bg-muted/40 active:bg-muted/60",
                FOCUS_RING,
              )}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
                <p className="text-xs text-muted-foreground">
                  下4桁 {row.phoneLast4} ・ 最終来店 {formatLastVisit(row.lastVisitDate)}
                </p>
              </div>
              <p className="shrink-0 text-xs text-muted-foreground">来店{row.visitCount}回</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
