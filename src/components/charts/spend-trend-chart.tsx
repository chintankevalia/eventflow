"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { istDay } from "@/lib/date-range";
import type { MonthlySeries } from "@/server/reports/queries";
import { AXIS, moneyTick, tooltip, useChartAnimation } from "./chart-kit";
import { CHART_COLOR, monthLabel } from "./chart-tokens";

/**
 * Estimated against actual spend, month by month.
 *
 * Areas rather than lines because the question is "how much", not "which way is
 * it heading", and the filled shape makes the gap between plan and spend the
 * thing you see first. Actual is coral — it is the figure the chart is about —
 * and estimated is the muted comparison behind it.
 *
 * The series runs six months past today (see `getMonthlySpend`), where actual
 * spend is legitimately zero because the event has not happened. Without a mark
 * for the present, the coral area dropping to the axis reads as spending having
 * collapsed rather than as the future, so the current month is ruled off.
 */
export default function SpendTrendChart({ data }: { data: MonthlySeries[] }) {
  const animate = useChartAnimation();
  // Safe to read the clock during render: this component is only ever loaded
  // with `ssr: false`, so there is no server pass to disagree with.
  const currentMonth = monthLabel(istDay(new Date()).slice(0, 7));
  // An SVG gradient is referenced by id, and ids are global to the document, so
  // two of these charts on one page would both paint from whichever `defs` won.
  // `useId` returns punctuation of its own choosing; stripped, because the id
  // goes into a `url(#…)` reference.
  const gradientId = `spend-trend-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const rows = data.map((month) => ({
    month: monthLabel(month.month),
    Estimated: month.estimated,
    Actual: month.actual,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* `accessibilityLayer` is off because `ChartFrame` hides this SVG from
          assistive technology and renders the same figures as a real table.
          Left on, recharts puts `tabindex="0" role="application"` on the
          surface — a keyboard stop inside an `aria-hidden` subtree, which is
          a focus landing on something screen readers are told to ignore. */}
      <AreaChart data={rows} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLOR.primary} stopOpacity={0.35} />
            <stop offset="100%" stopColor={CHART_COLOR.primary} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* Horizontal rules only. A line between two months says nothing; the
            one vertical line that does mean something is drawn below. */}
        <CartesianGrid stroke={CHART_COLOR.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" {...AXIS} interval="preserveStartEnd" minTickGap={8} />
        <YAxis tickFormatter={moneyTick} width={60} {...AXIS} />
        <Tooltip content={tooltip()} cursor={{ stroke: CHART_COLOR.grid }} />
        {/* Where the past stops. Muted, not coral: it is a note on the chart,
            not one of its series. A month that is not in the window — only
            possible for a caller that asks for a window without it — simply
            draws nothing. */}
        <ReferenceLine
          x={currentMonth}
          stroke={CHART_COLOR.comparison}
          strokeDasharray="2 3"
          label={{
            value: "Now",
            position: "top",
            fill: CHART_COLOR.comparison,
            fontSize: 10,
          }}
        />
        {/*
          `linear`, not `monotone`. A spline through monthly totals draws a
          curve between the points, and with a sparse month — one event in
          December and nothing either side — the hump spreads visible spend
          across November and January, which the table beside it reports as ₹0.
          Straight segments assert nothing the data does not say.
        */}
        <Area
          type="linear"
          dataKey="Estimated"
          stroke={CHART_COLOR.comparison}
          strokeDasharray="4 3"
          fill="none"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={animate}
        />
        <Area
          type="linear"
          dataKey="Actual"
          stroke={CHART_COLOR.primary}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: CHART_COLOR.primary }}
          isAnimationActive={animate}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
