/**
 * The wire shape a widget renders from.
 *
 * Deliberately a mirror of what `src/server/dashboards/run.ts` returns rather than the type
 * itself: that module is `server-only` and importing it from a chart would drag the Prisma
 * client into the browser bundle. A server component maps one to the other.
 */
import { CHART_SERIES, MAX_SERIES } from "@/components/charts/chart-tokens";
import type { NumberFormat, WidgetView } from "@/server/dashboards/spec";

export type WidgetMetric = { key: string; label: string; format: NumberFormat };

export type WidgetRowData = {
  dim: string | null;
  dimIsNull: boolean;
  series: string | null;
  seriesIsNull: boolean;
  grain: string | null;
  grainLabel: string | null;
  values: Record<string, number | null>;
};

export type WidgetData = {
  view: WidgetView;
  metrics: WidgetMetric[];
  dimensionLabel: string | null;
  seriesLabel: string | null;
  hasGrain: boolean;
  rows: WidgetRowData[];
  truncated: boolean;
  limit: number;
  /** Gauge only. */
  target: number | null;
};

/** The axis label for a row: its time bucket when there is one, otherwise its group. */
export function rowLabel(row: WidgetRowData): string {
  return row.grainLabel ?? row.dim ?? "All";
}

/**
 * Turns rows into recharts' one-object-per-x-position shape, and names the keys to plot.
 *
 * Two modes, because a chart can carry one of two kinds of comparison but not both at once:
 *
 *  - **No second grouping:** each metric is its own key, so "estimated vs actual by department"
 *    draws two bars per department.
 *  - **A second grouping:** the first metric is plotted and each *value* of that grouping
 *    becomes a key, so "events by department, split by region" draws one bar per region.
 *    Only the first metric is used; plotting several metrics across several series at once makes
 *    a chart nobody can read.
 *
 * Keys are returned in first-seen order and colours are assigned by position, so a series keeps
 * its colour when another one is filtered out.
 */
export function pivot(data: WidgetData): { rows: Record<string, string | number | null>[]; keys: string[] } {
  const { metrics, rows: source } = data;

  if (!data.seriesLabel) {
    const keys = metrics.map((m) => m.label);
    return {
      keys,
      rows: source.map((row) => {
        const out: Record<string, string | number | null> = { label: rowLabel(row) };
        for (const metric of metrics) out[metric.label] = row.values[metric.key] ?? null;
        return out;
      }),
    };
  }

  const metric = metrics[0];
  const byLabel = new Map<string, Record<string, string | number | null>>();
  const keys: string[] = [];
  for (const row of source) {
    const label = rowLabel(row);
    if (!byLabel.has(label)) byLabel.set(label, { label });
    const key = row.series ?? "—";
    if (!keys.includes(key)) keys.push(key);
    byLabel.get(label)![key] = row.values[metric.key] ?? null;
  }
  return { rows: [...byLabel.values()], keys };
}

/**
 * Keeps the palette honest when there are more categories than colours.
 *
 * A seventh slice is not given a made-up hue and not given a repeat of the first — both lie. The
 * smallest are folded into one "Other" row, and the caller says so on screen.
 */
export function capCategories(
  rows: WidgetRowData[],
  metricKey: string,
): { rows: WidgetRowData[]; folded: number } {
  if (rows.length <= MAX_SERIES) return { rows, folded: 0 };
  const sorted = [...rows].sort((a, b) => (b.values[metricKey] ?? 0) - (a.values[metricKey] ?? 0));
  const keep = sorted.slice(0, MAX_SERIES - 1);
  const rest = sorted.slice(MAX_SERIES - 1);
  const total = rest.reduce((n, r) => n + (r.values[metricKey] ?? 0), 0);
  return {
    rows: [
      ...keep,
      {
        dim: `Other (${rest.length})`,
        dimIsNull: false,
        series: null,
        seriesIsNull: false,
        grain: null,
        grainLabel: null,
        values: { [metricKey]: total },
      },
    ],
    folded: rest.length,
  };
}

export { CHART_SERIES, MAX_SERIES };
