"use client";

import { Text } from "recharts";

/**
 * Shared layout constants for the horizontal (vertical-layout) bar charts on
 * the analytics page (AcquisitionSourceChart, ConcernRankingChart) - kept in
 * one place so both charts stay visually consistent (same row height, bar
 * thickness, label column width) rather than drifting apart.
 */
export const ROW_HEIGHT = 32;
export const MIN_CHART_HEIGHT = 64;
export const Y_AXIS_WIDTH = 84;
export const BAR_SIZE = 16;

interface CategoryAxisTickProps {
  x?: number;
  y?: number;
  payload?: { value: string };
  maxWidth?: number;
}

/**
 * Left-aligned Y-axis category tick. recharts' default tick for a left-side
 * category axis right-anchors the text against the axis line, so short
 * labels leave a variable-width gap on the left and item names don't line
 * up - this renders every label flush against the same left position
 * instead, using recharts' own `Text` for its built-in wrap/truncate
 * behavior on long (staff-entered, unbounded-length) source/concern names.
 */
export function CategoryAxisTick({ y = 0, payload, maxWidth = Y_AXIS_WIDTH - 8 }: CategoryAxisTickProps) {
  return (
    <Text x={4} y={y} width={maxWidth} textAnchor="start" verticalAnchor="middle" className="fill-muted-foreground text-xs">
      {payload?.value ?? ""}
    </Text>
  );
}
