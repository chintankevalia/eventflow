"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, moneyTick, tooltip, useChartAnimation } from "./chart-kit";
import { CHART_COLOR } from "./chart-tokens";

/** One department's two figures. The label is already the readable name. */
export type DepartmentBar = { label: string; estimated: number; actual: number };

/**
 * Estimated and actual spend per department, as horizontal bars.
 *
 * Horizontal because department names are words — "Channel Partnerships" reads
 * straight along a y axis and would have to be rotated or truncated on an x
 * one. Two bars side by side rather than one overlaid on the other: overlaid
 * bars have to be read as a ratio, and the question here is which department
 * spent what.
 */
export default function DepartmentSpendChart({ data }: { data: DepartmentBar[] }) {
  const animate = useChartAnimation();
  const rows = data.map((row) => ({ label: row.label, Estimated: row.estimated, Actual: row.actual }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* `accessibilityLayer` off: `ChartFrame` hides this SVG from assistive
          technology and renders the same figures as a real table, so recharts'
          own `tabindex="0" role="application"` would be a keyboard stop inside
          an `aria-hidden` subtree. */}
      <BarChart data={rows} accessibilityLayer={false} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }} barGap={2}>
        {/* Vertical rules only — the money axis is the horizontal one here. */}
        <CartesianGrid stroke={CHART_COLOR.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={moneyTick} {...AXIS} />
        <YAxis type="category" dataKey="label" width={104} {...AXIS} />
        <Tooltip content={tooltip()} cursor={{ fill: CHART_COLOR.grid, fillOpacity: 0.3 }} />
        <Bar dataKey="Estimated" fill={CHART_COLOR.comparison} fillOpacity={0.35} radius={[0, 3, 3, 0]} isAnimationActive={animate} />
        <Bar dataKey="Actual" fill={CHART_COLOR.primary} radius={[0, 3, 3, 0]} isAnimationActive={animate} />
      </BarChart>
    </ResponsiveContainer>
  );
}
