"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { tooltip, useChartAnimation } from "@/components/charts/chart-kit";
import { seriesColor } from "@/components/charts/chart-tokens";
import { formatTick } from "../format";
import { capCategories, type WidgetData } from "../types";

/**
 * A share-of-total donut.
 *
 * A donut rather than a pie because the hole gives the total somewhere to live, and a reader
 * comparing parts to a whole wants to see that whole. Categories beyond the palette are folded
 * into one "Other" slice rather than given an invented colour or a repeated one.
 *
 * Rows whose value is zero are dropped: a 0-degree wedge with a label pointing at nothing is
 * noise, and the figure is in the table beside the chart either way.
 */
export default function DonutWidget({ data }: { data: WidgetData }) {
  const animate = useChartAnimation();
  const metric = data.metrics[0];
  const { rows } = capCategories(
    data.rows.filter((r) => (r.values[metric.key] ?? 0) > 0),
    metric.key,
  );

  const slices = rows.map((row) => ({
    name: row.dim ?? "—",
    value: row.values[metric.key] ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart accessibilityLayer={false} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <Tooltip content={tooltip((v: number) => formatTick(v, metric.format))} />
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          innerRadius="55%"
          outerRadius="80%"
          // A 2px gap in the surface colour between segments, so touching slices stay separable
          // without relying on the colours alone.
          paddingAngle={1}
          stroke="var(--card)"
          strokeWidth={2}
          isAnimationActive={animate}
        >
          {slices.map((slice, index) => (
            <Cell key={slice.name} fill={seriesColor(index)} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
