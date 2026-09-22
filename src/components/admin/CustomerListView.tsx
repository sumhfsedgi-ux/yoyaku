"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";
import { dateToJst } from "@/lib/time/tz";
import type { CustomerListItem } from "@/lib/customers/queries";

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString()}`;
}

/** Client-side incremental search over the already-fetched list - no server round-trip, fine at this feature's realistic data volume (plan §8). */
export function CustomerListView({ customers }: { customers: CustomerListItem[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(normalized) || c.email.toLowerCase().includes(normalized) || c.phone.includes(normalized),
    );
  }, [customers, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="お名前・メール・電話番号で検索"
          className="h-11 pl-9 text-base"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="顧客が見つかりません" description={customers.length === 0 ? "来店記録を追加すると顧客が表示されます。" : undefined} />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((customer) => (
            <Link
              key={customer.id}
              href={`/customers/${customer.id}`}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-muted/40 active:bg-muted/60",
                FOCUS_RING,
              )}
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium text-foreground">{customer.name}</p>
                  {customer.lineLinked && <Badge variant="secondary">LINE</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  前回来店: {customer.lastVisitDate ? dateToJst(customer.lastVisitDate).toFormat("yyyy年M月d日") : "未設定"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-foreground">{formatYen(customer.totalRevenue)}</p>
                <p className="text-xs text-muted-foreground">来店{customer.totalVisits}回</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
