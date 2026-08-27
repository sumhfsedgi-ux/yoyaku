import Link from "next/link";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";
import type { ProductBreakdownRow, RetailKpis } from "@/lib/retail/kpi";

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString()}`;
}

/**
 * Aggregate-only retail section for the analytics page - always the
 * caller's own figures, same as the rest of this page's KPIs/charts. Never
 * renders a per-sale list, purchaser name, or staff name. Registration/edit/
 * cancel live entirely on the separate /retail screen.
 */
export function RetailAnalyticsSection({
  yearMonth,
  kpis,
  productBreakdown,
}: {
  yearMonth: string;
  kpis: RetailKpis;
  productBreakdown: ProductBreakdownRow[];
}) {
  const cards = [
    { label: "小売売上金額", value: formatYen(kpis.retailRevenue) },
    { label: "販売個数", value: `${kpis.unitsSold}個` },
    { label: "小売人数", value: `${kpis.retailCustomerCount}人` },
  ];

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">小売実績</h2>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className="mt-1 text-lg font-semibold tracking-tight text-foreground">{card.value}</p>
          </div>
        ))}
      </div>

      {productBreakdown.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {productBreakdown.map((row) => (
            <div key={row.productName} className="flex items-center justify-between text-sm">
              <span className="text-foreground">{row.productName}</span>
              <span className="text-muted-foreground">{row.quantity}個</span>
            </div>
          ))}
        </div>
      )}

      <Link
        href={`/retail?month=${yearMonth}`}
        className={cn(
          "mt-4 inline-block w-fit rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline",
          FOCUS_RING,
        )}
      >
        小売実績を見る・登録する →
      </Link>
    </section>
  );
}
