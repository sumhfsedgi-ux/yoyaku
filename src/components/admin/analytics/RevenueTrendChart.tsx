"use client";

import type { Key } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import type { MonthlyRevenuePoint } from "@/lib/analytics/kpi";

// --chart-1..5 in globals.css are an unused grayscale placeholder ramp (never
// customized to real hues, since no chart existed before this feature) -
// --color-primary is the app's actual brand blue, used everywhere else in
// the UI, so single-series charts use it directly instead.
const chartConfig = {
  revenue: { label: "売上", color: "var(--color-primary)" },
} satisfies ChartConfig;

function formatMonthLabel(yearMonth: string): string {
  const [, month] = yearMonth.split("-");
  return `${Number(month)}月`;
}

/** Selected month's point renders larger/primary-colored via a custom dot renderer instead of a separate reference line. */
export function RevenueTrendChart({ data, selectedYearMonth }: { data: MonthlyRevenuePoint[]; selectedYearMonth: string }) {
  const hasData = data.some((point) => point.revenue > 0);
  if (!hasData) {
    return <EmptyState title="この期間の記録はまだありません" />;
  }

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
      <LineChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="yearMonth" tickFormatter={formatMonthLabel} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} tickFormatter={(value: number) => `¥${(value / 1000).toFixed(0)}k`} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => formatMonthLabel(String(value))} />} />
        <Line
          dataKey="revenue"
          type="monotone"
          stroke="var(--color-revenue)"
          strokeWidth={2}
          dot={(dotProps) => {
            const { cx, cy, payload, key } = dotProps as unknown as {
              cx?: number;
              cy?: number;
              payload?: MonthlyRevenuePoint;
              key?: Key;
            };
            const isSelected = payload?.yearMonth === selectedYearMonth;
            return (
              <circle
                key={key}
                cx={cx}
                cy={cy}
                r={isSelected ? 5 : 3}
                fill={isSelected ? "var(--color-revenue)" : "var(--color-background)"}
                stroke="var(--color-revenue)"
                strokeWidth={2}
              />
            );
          }}
        />
      </LineChart>
    </ChartContainer>
  );
}
