import Link from "next/link";
import { DateTime } from "luxon";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { getMyAllTimeAnalytics, getMyMonthlyAnalytics } from "@/actions/analytics";
import { getMyAllTimeRetailAnalytics, getMyMonthlyRetailAnalytics } from "@/actions/retail";
import { nowJst } from "@/lib/time/tz";
import { Button } from "@/components/ui/button";
import { KpiCardGrid } from "@/components/admin/analytics/KpiCardGrid";
import { RevenueTrendChart } from "@/components/admin/analytics/RevenueTrendChart";
import { AcquisitionSourceChart } from "@/components/admin/analytics/AcquisitionSourceChart";
import { ConcernRankingChart } from "@/components/admin/analytics/ConcernRankingChart";
import { AnalyticsRangeToggle } from "@/components/admin/analytics/AnalyticsRangeToggle";
import { RetailAnalyticsSection } from "@/components/admin/retail/RetailAnalyticsSection";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ month?: string; range?: string }> }) {
  const params = await searchParams;
  const current = params.month ? DateTime.fromFormat(params.month, "yyyy-MM") : nowJst().startOf("month");
  const year = current.year;
  const month = current.month;
  const yearMonth = current.toFormat("yyyy-MM");
  const range = params.range === "all" ? "all" : "month";

  const [analytics, retailAnalytics] = range === "all"
    ? await Promise.all([getMyAllTimeAnalytics(), getMyAllTimeRetailAnalytics()])
    : await Promise.all([getMyMonthlyAnalytics(year, month), getMyMonthlyRetailAnalytics(year, month)]);

  const trendSelectedYearMonth = range === "all" ? nowJst().toFormat("yyyy-MM") : yearMonth;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">分析</h1>
          <AnalyticsRangeToggle range={range} yearMonth={yearMonth} />
        </div>
        {range === "month" ? (
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="icon-touch"
              render={<Link href={`/analytics?month=${current.minus({ months: 1 }).toFormat("yyyy-MM")}`} aria-label="前の月" />}
            >
              <ChevronLeftIcon />
            </Button>
            <p className="text-sm font-medium text-foreground">{current.toFormat("yyyy年M月")}</p>
            <Button
              variant="outline"
              size="icon-touch"
              render={<Link href={`/analytics?month=${current.plus({ months: 1 }).toFormat("yyyy-MM")}`} aria-label="次の月" />}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">開業から現在までの累計です</p>
        )}
      </div>

      <KpiCardGrid kpis={analytics.kpis} periodLabel={range === "all" ? "全期間" : "今月"} />

      <RetailAnalyticsSection
        yearMonth={yearMonth}
        kpis={retailAnalytics.kpis}
        productBreakdown={retailAnalytics.productBreakdown}
      />

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">月別売上推移(直近12ヶ月)</h2>
        <RevenueTrendChart data={analytics.revenueTrend} selectedYearMonth={trendSelectedYearMonth} />
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">流入経路別内訳</h2>
        <AcquisitionSourceChart rows={analytics.acquisitionBreakdown} />
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">お悩みランキング</h2>
        <ConcernRankingChart rows={analytics.concernRanking} />
      </section>
    </div>
  );
}
