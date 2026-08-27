import Link from "next/link";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/interactionStyles";

export type AnalyticsRangeParam = "month" | "all";

const RANGE_OPTIONS: { value: AnalyticsRangeParam; label: string }[] = [
  { value: "month", label: "月別" },
  { value: "all", label: "全期間" },
];

/**
 * 月別/全期間の2択トグル。CalendarToggles.tsx内のToggleGroupと同じ見た目だが、
 * あちらと違い選択をDBへ保存しない(ユーザー確認済み)ため、副作用のない
 * <Link>ナビゲーションのみで完結する - "use client"は不要。
 */
export function AnalyticsRangeToggle({ range, yearMonth }: { range: AnalyticsRangeParam; yearMonth: string }) {
  return (
    <div className="inline-flex rounded-lg bg-muted p-[3px]" role="group" aria-label="表示範囲">
      {RANGE_OPTIONS.map((opt) => (
        <Link
          key={opt.value}
          href={opt.value === "month" ? `/analytics?month=${yearMonth}` : "/analytics?range=all"}
          aria-current={range === opt.value ? "page" : undefined}
          className={cn(
            "flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-all active:scale-[0.97] md:min-h-8",
            FOCUS_RING,
            range === opt.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background/60 hover:text-foreground active:bg-background/80",
          )}
        >
          {opt.label}
        </Link>
      ))}
    </div>
  );
}
