"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, tooltip, useChartAnimation } from "@/components/charts/chart-kit";
import { CHART_COLOR, seriesColor } from "@/components/charts/chart-tokens";
import { formatTick } from "../format";
import { pivot, type WidgetData } from "../types";

/**
 * A grouped bar chart for any widget whose question is "how much, by what".
 *
 * Horizontal when the categories are words — city and partner names read straight along a y axis
 * and would otherwise be rotated or truncated — and vertical for a time axis, where the reading
 * order is left to right. The same reasoning as the department-spend chart beside it.
 */
export default function BarWidget({ data }: { data: WidgetData }) {
  const animate = useChartAnimation();
  const { rows, keys } = pivot(data);
  const format = data.metrics[0]?.format ?? "integer";
  const horizontal = !data.hasGrain;

  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* `accessibilityLayer` off, as elsewhere: the widget renders the same figures as a real
          table, so recharts' own focusable wrapper would be a keyboard stop over nothing. */}
      <BarChart
        data={rows}
        accessibilityLayer={false}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
        barGap={2}
      >
        <CartesianGrid
          stroke={CHART_COLOR.grid}
          strokeDasharray="3 3"
          horizontal={!horizontal}
          vertical={horizontal}
        />
        {horizontal ? (
          <>
            <XAxis type="number" tickFormatter={(v: number) => formatTick(v, format)} {...AXIS} />
            <YAxis type="category" dataKey="label" width={104} {...AXIS} />
          </>
        ) : (
          <>
            <XAxis type="category" dataKey="label" {...AXIS} />
            <YAxis type="number" tickFormatter={(v: number) => formatTick(v, format)} {...AXIS} />
          </>
        )}
        <Tooltip
          content={tooltip((v: number) => formatTick(v, format))}
          cursor={{ fill: CHART_COLOR.grid, fillOpacity: 0.3 }}
        />
        {keys.map((key, index) => (
          <Bar
            key={key}
            dataKey={key}
            // Colour by position, so filtering one series out never repaints the others.
            fill={seriesColor(index)}
            radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
            isAnimationActive={animate}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
