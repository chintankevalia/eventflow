"use client";

import * as React from "react";
import type { TooltipContentProps } from "recharts";
import { formatINRCompact } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { CHART_COLOR } from "./chart-tokens";

/**
 * Shared axis chrome, so twelve months on the dashboard and twelve months on
 * the reports page look like the same chart rather than two charts about the
 * same thing.
 */
export const AXIS = {
  stroke: CHART_COLOR.grid,
  tickLine: false,
  tick: { fill: CHART_COLOR.comparison, fontSize: 11 },
} as const;

/** Money on an axis has to be short: `₹4.2 L`, not `₹4,20,000`. */
export const moneyTick = (value: number) => formatINRCompact(value);

/**
 * Whether a chart should animate.
 *
 * recharts animates by interpolating its own paths in JavaScript, which the
 * `prefers-reduced-motion` block in `globals.css` cannot reach, so every chart
 * passes this to `isAnimationActive`.
 */
export function useChartAnimation(): boolean {
  return !usePrefersReducedMotion();
}

/**
 * The hover card.
 *
 * recharts' default tooltip is a white box with its own fonts and borders, which
 * is wrong in dark mode and wrong next to our cards in either. This is the same
 * chrome as `Card`, and the figures use `tabular-nums` so they do not jitter as
 * the pointer moves along the series.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  format = formatINRCompact,
}: TooltipContentProps & { format?: (value: number) => string }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      {label != null && <p className="mb-1.5 font-medium text-card-foreground">{String(label)}</p>}
      <ul className="space-y-1">
        {payload.map((entry, index) => (
          <li key={`${entry.name ?? index}`} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-sm"
              style={{ backgroundColor: entry.color ?? CHART_COLOR.primary }}
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto pl-3 font-medium tabular-nums text-card-foreground">
              {typeof entry.value === "number" ? format(entry.value) : String(entry.value ?? "—")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * `content` wants an element or a render function; a function keeps the props
 * typed. Curried so a chart can say `content={tooltip(formatHours)}`.
 *
 * The returned function is declared with a name rather than written as an arrow,
 * because anything returning JSX is a component as far as React DevTools and
 * `react/display-name` are concerned — and an anonymous one shows up in the tree
 * as `Unknown`.
 */
export function tooltip(format?: (value: number) => string) {
  return function ChartTooltipContent(props: TooltipContentProps) {
    return <ChartTooltip {...props} format={format} />;
  };
}
