"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { BAR_SIZE, CategoryAxisTick, MIN_CHART_HEIGHT, ROW_HEIGHT, Y_AXIS_WIDTH } from "@/components/admin/analytics/horizontalBarChartLayout";
import type { AcquisitionSourceBreakdownRow } from "@/lib/analytics/kpi";

type Metric = "newCustomerCount" | "revenue";

// Only one metric is ever visible at a time (人数/売上 toggle below), and
// --chart-1..5 are an unused grayscale placeholder ramp - both metrics use
// the app's actual primary blue, same as RevenueTrendChart.
const chartConfig = {
  newCustomerCount: { label: "新規顧客数", color: "var(--color-primary)" },
  revenue: { label: "売上", color: "var(--color-primary)" },
} satisfies ChartConfig;

/** Horizontal bar chart with a simple 人数/売上 display toggle (client state, not URL-driven - plan §9). */
export function AcquisitionSourceChart({ rows }: { rows: AcquisitionSourceBreakdownRow[] }) {
  const [metric, setMetric] = useState<Metric>("newCustomerCount");

  if (rows.length === 0) {
    return <EmptyState title="この期間の記録はまだありません" />;
  }

  // Rows arrive sorted by revenue (see computeAcquisitionSourceBreakdown) -
  // re-sort by whichever metric is currently displayed so "top to bottom" is
  // always largest-to-smallest for what's actually on screen, matching the
  // 人数/売上 toggle instead of staying fixed to the revenue order.
  const sortedRows = [...rows].sort((a, b) => b[metric] - a[metric]);

  return (
    <div>
      <div className="mb-3 flex justify-end gap-1">
        <Button size="xs" variant={metric === "newCustomerCount" ? "default" : "outline"} onClick={() => setMetric("newCustomerCount")}>
          人数
        </Button>
        <Button size="xs" variant={metric === "revenue" ? "default" : "outline"} onClick={() => setMetric("revenue")}>
          売上
        </Button>
      </div>
      <ChartContainer config={chartConfig} className="aspect-auto w-full" style={{ height: Math.max(rows.length * ROW_HEIGHT, MIN_CHART_HEIGHT) }}>
        <BarChart data={sortedRows} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" domain={[0, (max: number) => max * 1.15]} tickLine={false} axisLine={false} hide />
          <YAxis dataKey="sourceName" type="category" tickLine={false} axisLine={false} width={Y_AXIS_WIDTH} tick={<CategoryAxisTick />} />
          <Bar dataKey={metric} fill={`var(--color-${metric})`} radius={4} barSize={BAR_SIZE} activeBar={false}>
            <LabelList
              dataKey={metric}
              position="right"
              formatter={(value) => (metric === "revenue" ? `¥${Number(value).toLocaleString()}` : `${value}人`)}
              className="fill-foreground text-xs"
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}
