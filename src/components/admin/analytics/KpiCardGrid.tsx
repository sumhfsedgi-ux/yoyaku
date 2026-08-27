import type { MonthlyKpis } from "@/lib/analytics/kpi";

function formatYen(amount: number): string {
  return `¥${Math.round(amount).toLocaleString()}`;
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * KPI labels/definitions match plan §6 exactly - "リピート来店比率" (not
 * "2回目来店率") with a caption, specifically to avoid conflating "月間来店に
 * 占めるリピート比率" with a per-customer repeat-visit rate.
 */
export function KpiCardGrid({ kpis, periodLabel }: { kpis: MonthlyKpis; periodLabel: "今月" | "全期間" }) {
  const cards = [
    { label: periodLabel === "全期間" ? "累計売上" : "月間売上", value: formatYen(kpis.monthlyRevenue) },
    { label: "来店数", value: `${kpis.visitCount}件` },
    { label: "新規顧客数", value: `${kpis.newCustomerCount}人` },
    { label: "リピート来店比率", value: formatPercent(kpis.repeatVisitRate), caption: `${periodLabel}の来店のうち新規以外の割合` },
    { label: "平均客単価", value: formatYen(kpis.averageRevenuePerVisit) },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{card.label}</p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-foreground">{card.value}</p>
          {card.caption && <p className="mt-1 text-[0.7rem] text-muted-foreground">{card.caption}</p>}
        </div>
      ))}
    </div>
  );
}
