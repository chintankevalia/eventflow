/**
 * A single figure, the way the dashboard's own KPI tiles read it.
 *
 * No chart library: a number is a number, and the existing `Stat` already handles the no-data
 * dash and announces it to a screen reader. Server-rendered, so it paints with the page.
 */
import { formatValue } from "../format";
import type { WidgetData } from "../types";

export default function KpiWidget({ data }: { data: WidgetData }) {
  const [primary, ...rest] = data.metrics;
  // With no grouping the query returns one row; with one, the widget shows the leading group.
  const row = data.rows[0];
  const value = row?.values[primary.key] ?? null;

  return (
    <div className="flex h-full flex-col justify-center">
      <p className="text-3xl leading-none font-semibold tabular-nums">
        {value === null ? (
          <>
            <span aria-hidden>—</span>
            <span className="sr-only">No data</span>
          </>
        ) : (
          formatValue(value, primary.format)
        )}
      </p>
      {data.dimensionLabel && row?.dim && (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {row.dim}
          {data.rows.length > 1 && ` · top of ${data.rows.length} by ${data.dimensionLabel.toLowerCase()}`}
        </p>
      )}
      {rest.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {rest.map((metric) => (
            <div key={metric.key} className="min-w-0">
              <dt className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                {metric.label}
              </dt>
              <dd className="text-sm font-medium tabular-nums">
                {formatValue(row?.values[metric.key] ?? null, metric.format)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
