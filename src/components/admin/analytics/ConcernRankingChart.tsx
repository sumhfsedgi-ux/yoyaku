"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import type { ConcernRankingRow } from "@/lib/analytics/kpi";

// --chart-1..5 are an unused grayscale placeholder ramp - use the app's
// actual primary blue instead, same as the other single-series charts.
const chartConfig = {
  count: { label: "件数", color: "var(--color-primary)" },
} satisfies ChartConfig;

/** A visit with 2 concerns selected counts +1 toward each - the summed total can exceed visitCount, which is expected (plan §6). */
export function ConcernRankingChart({ rows }: { rows: ConcernRankingRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="この期間の記録はまだありません" />;
  }

  return (
    <ChartContainer config={chartConfig} className="aspect-auto w-full" style={{ height: Math.max(rows.length * 40, 120) }}>
      <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" domain={[0, (max: number) => max * 1.15]} tickLine={false} axisLine={false} hide />
        <YAxis dataKey="concernName" type="category" tickLine={false} axisLine={false} width={100} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} activeBar={false}>
          <LabelList dataKey="count" position="right" formatter={(value) => `${value}件`} className="fill-foreground text-xs" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
