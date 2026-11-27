"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartLegend } from "@/components/charts/chart-frame";
import { seriesColor } from "@/components/charts/chart-tokens";
import { WidgetEmpty } from "../widget-frame";
import { capCategories, pivot, type WidgetData } from "../types";
import GaugeWidget from "./gauge-widget";
import KpiWidget from "./kpi-widget";
import TableWidget from "./table-widget";

/**
 * Picks a renderer for a widget, and keeps the chart library out of the first paint.
 *
 * The three views that are not charts — a number, a dial, a table — render on the server and
 * need no JavaScript at all. The three that are charts each get their own `dynamic()` chunk with
 * `ssr: false`, which is also what makes recharts' `ResponsiveContainer` measure correctly: it
 * sizes itself from its parent, and a server render has no layout to measure.
 */
const loading = () => <Skeleton className="size-full" />;

const BarWidget = dynamic(() => import("./bar-widget"), { ssr: false, loading });
const LineWidget = dynamic(() => import("./line-widget"), { ssr: false, loading });
const DonutWidget = dynamic(() => import("./donut-widget"), { ssr: false, loading });

export function WidgetBody({ data }: { data: WidgetData }) {
  if (!data.rows.length) return <WidgetEmpty />;

  switch (data.view) {
    case "kpi":
      return <KpiWidget data={data} />;
    case "gauge":
      return <GaugeWidget data={data} />;
    case "table":
      return <TableWidget data={data} />;
    case "bar":
      return <WithLegend data={data}>{<BarWidget data={data} />}</WithLegend>;
    case "line":
    case "area":
      return <WithLegend data={data}>{<LineWidget data={data} />}</WithLegend>;
    case "donut":
      return <DonutLegend data={data} />;
  }
}

/**
 * A legend is always present for two or more series, so identity never rests on colour alone.
 * One series needs none — the widget's own title names it.
 */
function WithLegend({ data, children }: { data: WidgetData; children: React.ReactNode }) {
  const { keys } = pivot(data);
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">{children}</div>
      {keys.length > 1 && (
        <ChartLegend
          className="mt-2 shrink-0"
          items={keys.map((key, index) => ({ label: key, color: seriesColor(index) }))}
        />
      )}
    </div>
  );
}

/** A donut's legend names its slices, in the same order and colours the chart used. */
function DonutLegend({ data }: { data: WidgetData }) {
  const metric = data.metrics[0];
  const { rows, folded } = capCategories(
    data.rows.filter((r) => (r.values[metric.key] ?? 0) > 0),
    metric.key,
  );
  if (!rows.length) return <WidgetEmpty message="Nothing with a value above zero." />;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <DonutWidget data={data} />
      </div>
      <ChartLegend
        className="mt-2 shrink-0"
        items={rows.map((row, index) => ({ label: row.dim ?? "—", color: seriesColor(index) }))}
      />
      {folded > 0 && (
        <p className="mt-1 shrink-0 text-[11px] text-muted-foreground">
          The smallest {folded} are grouped as Other — the full list is in the table view.
        </p>
      )}
    </div>
  );
}
