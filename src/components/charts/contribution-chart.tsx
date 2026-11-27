"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, moneyTick, tooltip, useChartAnimation } from "./chart-kit";
import { CHART_COLOR } from "./chart-tokens";

/** Who paid for one department's events. */
export type ContributionBar = { label: string; motadata: number; partner: number; mdf: number };

/**
 * Who funds each department's events: Motadata, the partner, or MDF.
 *
 * Stacked, because the three figures add up to one budget and the useful
 * comparison is their proportions. Three distinct hues rather than three shades
 * of coral — shades of one colour read as an ordered scale, and these are
 * unordered categories. All three are existing tokens.
 */
export default function ContributionChart({ data }: { data: ContributionBar[] }) {
  const animate = useChartAnimation();
  const rows = data.map((row) => ({
    label: row.label,
    Motadata: row.motadata,
    Partner: row.partner,
    MDF: row.mdf,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* See `department-spend-chart.tsx`: the accessible copy is the table. */}
      <BarChart data={rows} accessibilityLayer={false} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART_COLOR.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={moneyTick} {...AXIS} />
        <YAxis type="category" dataKey="label" width={104} {...AXIS} />
        <Tooltip content={tooltip()} cursor={{ fill: CHART_COLOR.grid, fillOpacity: 0.3 }} />
        {/* `stackId` is what makes the three segments one bar. The last one in
            the stack carries the rounded end so the bar does not look clipped. */}
        <Bar dataKey="Motadata" stackId="funding" fill={CHART_COLOR.primary} isAnimationActive={animate} />
        <Bar dataKey="Partner" stackId="funding" fill={CHART_COLOR.info} isAnimationActive={animate} />
        <Bar dataKey="MDF" stackId="funding" fill={CHART_COLOR.warning} radius={[0, 3, 3, 0]} isAnimationActive={animate} />
      </BarChart>
    </ResponsiveContainer>
  );
}
