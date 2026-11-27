"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, tooltip, useChartAnimation } from "@/components/charts/chart-kit";
import { CHART_COLOR, seriesColor } from "@/components/charts/chart-tokens";
import { formatTick } from "../format";
import { pivot, type WidgetData } from "../types";

/**
 * A trend over time, as lines or filled areas.
 *
 * `type="linear"` throughout, never a spline: a smoothed curve between two months draws spend
 * that did not happen, and a reader cannot tell the invention from the measurement. The same
 * decision as the existing spend-trend chart.
 */
export default function LineWidget({ data }: { data: WidgetData }) {
  const animate = useChartAnimation();
  const gradientId = useId();
  const { rows, keys } = pivot(data);
  const format = data.metrics[0]?.format ?? "integer";
  const filled = data.view === "area";

  const axes = (
    <>
      <CartesianGrid stroke={CHART_COLOR.grid} strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="label" {...AXIS} />
      <YAxis tickFormatter={(v: number) => formatTick(v, format)} {...AXIS} />
      <Tooltip content={tooltip((v: number) => formatTick(v, format))} />
    </>
  );

  if (filled) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} accessibilityLayer={false} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {keys.map((key, index) => (
              // Scoped by useId, so two area widgets on one dashboard cannot steal each other's
              // gradient — SVG ids are global to the document.
              <linearGradient key={key} id={`${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={seriesColor(index)} stopOpacity={0.35} />
                <stop offset="100%" stopColor={seriesColor(index)} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          {axes}
          {keys.map((key, index) => (
            <Area
              key={key}
              type="linear"
              dataKey={key}
              stroke={seriesColor(index)}
              strokeWidth={2}
              fill={`url(#${gradientId}-${index})`}
              isAnimationActive={animate}
              // A gap in the data stays a gap rather than being bridged.
              connectNulls={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} accessibilityLayer={false} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        {axes}
        {keys.map((key, index) => (
          <Line
            key={key}
            type="linear"
            dataKey={key}
            stroke={seriesColor(index)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={animate}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
