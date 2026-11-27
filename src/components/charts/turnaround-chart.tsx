"use client";

import { Bar, BarChart, CartesianGrid, ErrorBar, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ApprovalTurnaround } from "@/server/reports/queries";
import { AXIS, tooltip, useChartAnimation } from "./chart-kit";
import { CHART_COLOR } from "./chart-tokens";

const formatHours = (value: number) => `${value} hr${value === 1 ? "" : "s"}`;

/**
 * How long each approval stage takes, in hours.
 *
 * The bar is the average and the whisker is the range, because an average on
 * its own hides the case that matters: a stage averaging 20 hours where one
 * request sat for four days is a different problem from one that is reliably
 * 20 hours. Stages with a single decision have no range, so the whisker
 * collapses to a tick and the bar still reads correctly.
 */
export default function TurnaroundChart({ data }: { data: ApprovalTurnaround[] }) {
  const animate = useChartAnimation();

  const rows = data
    .filter((stage) => stage.avgHours !== null)
    .map((stage) => {
      const avg = stage.avgHours ?? 0;
      return {
        label: stage.stageName,
        Average: avg,
        // recharts wants the distance either side of the bar's own value, not
        // the min and max themselves.
        range: [Math.max(avg - (stage.minHours ?? avg), 0), Math.max((stage.maxHours ?? avg) - avg, 0)],
      };
    });

  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* See `department-spend-chart.tsx`: the accessible copy is the table. */}
      <BarChart data={rows} accessibilityLayer={false} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART_COLOR.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={formatHours} {...AXIS} />
        <YAxis type="category" dataKey="label" width={104} {...AXIS} />
        <Tooltip content={tooltip(formatHours)} cursor={{ fill: CHART_COLOR.grid, fillOpacity: 0.3 }} />
        <Bar dataKey="Average" fill={CHART_COLOR.primary} radius={[0, 3, 3, 0]} isAnimationActive={animate}>
          <ErrorBar dataKey="range" stroke={CHART_COLOR.comparison} strokeWidth={1} width={4} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
