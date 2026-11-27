/**
 * A figure measured against a target you type — "₹1.2 Cr of the ₹2 Cr FY budget".
 *
 * Drawn as an SVG arc rather than with the chart library: it is two arcs and a label, and
 * loading a charting bundle for that would delay the one number the widget exists to show. The
 * target is a literal on the widget, never a second query — a target that is itself a saved
 * question doubles the failure modes for a figure somebody types once.
 */
import { formatValue } from "../format";
import type { WidgetData } from "../types";

/** Semicircle geometry. A half dial reads as "progress along a scale" rather than as a clock. */
const RADIUS = 52;
const STROKE = 12;
const CIRCUMFERENCE = Math.PI * RADIUS;

export default function GaugeWidget({ data }: { data: WidgetData }) {
  const metric = data.metrics[0];
  const value = data.rows[0]?.values[metric.key] ?? null;
  const target = data.target;

  if (value === null || target === null || target <= 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <p className="text-2xl font-semibold tabular-nums">{formatValue(value, metric.format)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {target === null || target <= 0 ? "Set a target to see progress." : "Nothing measured yet."}
        </p>
      </div>
    );
  }

  const ratio = value / target;
  const clamped = Math.max(0, Math.min(1, ratio));
  // Over target is worth naming rather than silently pinning the arc at full.
  const over = ratio > 1;
  const colour = over ? "var(--destructive)" : ratio >= 0.9 ? "var(--warning)" : "var(--chart-1)";

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <svg viewBox="0 0 120 70" className="w-full max-w-[180px]" role="img" aria-label={`${formatValue(value, metric.format)} of ${formatValue(target, metric.format)}`}>
        {/* The track. */}
        <path
          d={`M 8 62 A ${RADIUS} ${RADIUS} 0 0 1 112 62`}
          fill="none"
          stroke="var(--border)"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {/* The measured part, drawn by dashing the same path. */}
        <path
          d={`M 8 62 A ${RADIUS} ${RADIUS} 0 0 1 112 62`}
          fill="none"
          stroke={colour}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - clamped)}
        />
      </svg>
      <p className="-mt-3 text-xl leading-none font-semibold tabular-nums">
        {formatValue(value, metric.format)}
      </p>
      <p className="mt-1 text-center text-xs text-muted-foreground">
        of {formatValue(target, metric.format)}
        <span className={over ? "ml-1 font-medium text-destructive" : "ml-1"}>
          ({Math.round(ratio * 100)}%{over ? " — over" : ""})
        </span>
      </p>
    </div>
  );
}
