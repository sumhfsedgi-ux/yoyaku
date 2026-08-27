"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PencilIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RetailSaleFormDialog } from "./RetailSaleFormDialog";
import { cancelMyRetailSale } from "@/actions/retail";
import { dateToJst } from "@/lib/time/tz";
import type { RetailSaleListItem } from "@/lib/retail/queries";

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString()}`;
}

export function RetailSaleList({
  sales,
  productSuggestions,
  defaultSoldAtISO,
}: {
  sales: RetailSaleListItem[];
  productSuggestions: string[];
  defaultSoldAtISO: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleCancel(id: string) {
    if (!window.confirm("この小売実績を取消しますか？")) return;
    startTransition(async () => {
      try {
        await cancelMyRetailSale(id);
        toast.success("小売実績を取消しました");
        router.refresh();
      } catch {
        toast.error("取消できませんでした。もう一度お試しください。");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">販売履歴</h2>
        <RetailSaleFormDialog
          mode="create"
          defaultSoldAtISO={defaultSoldAtISO}
          productSuggestions={productSuggestions}
          trigger={({ onClick }) => (
            <Button size="sm" variant="outline" onClick={onClick}>
              <PlusIcon data-icon="inline-start" />
              小売実績を登録
            </Button>
          )}
        />
      </div>

      {sales.length === 0 ? (
        <EmptyState title="この月の小売実績はまだありません" description="「小売実績を登録」から最初の実績を登録してください。" />
      ) : (
        <div className="flex flex-col gap-2">
          {sales.map((sale) => {
            const cancelled = sale.status === "CANCELLED";
            return (
              <div key={sale.id} className={cancelled ? "rounded-xl border border-border bg-card p-4 opacity-60" : "rounded-xl border border-border bg-card p-4"}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{dateToJst(sale.soldAt).toFormat("yyyy年M月d日")}</p>
                  <div className="flex items-center gap-2">
                    {cancelled && <Badge variant="outline">取消済み</Badge>}
                    <span className="text-sm font-semibold text-foreground">{formatYen(sale.totalAmount)}</span>
                    {!cancelled && (
                      <RetailSaleFormDialog
                        mode="edit"
                        sale={sale}
                        productSuggestions={productSuggestions}
                        trigger={({ onClick }) => (
                          <Button size="icon-touch" variant="ghost" aria-label="編集" onClick={onClick}>
                            <PencilIcon />
                          </Button>
                        )}
                      />
                    )}
                  </div>
                </div>

                <p className="text-sm text-foreground">{sale.customerName ?? "顧客登録なし"}</p>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sale.items.map((item, idx) => (
                    <Badge key={`${sale.id}-${idx}`} variant="outline">
                      {item.productName} × {item.quantity}
                    </Badge>
                  ))}
                </div>

                {sale.memo && <p className="mt-2 text-sm text-muted-foreground">{sale.memo}</p>}

                {!cancelled && (
                  <div className="mt-3">
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={isPending} onClick={() => handleCancel(sale.id)}>
                      取消
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
