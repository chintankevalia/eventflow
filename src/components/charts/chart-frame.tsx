import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The numbers behind a chart, written out. `columns` are the headers and each
 * row is already formatted for reading aloud — "₹4.2 L", not 420000.
 */
export type ChartTable = {
  columns: string[];
  rows: React.ReactNode[][];
};

/**
 * The box a chart sits in.
 *
 * Two jobs, both of which have to happen on the server:
 *
 * 1. **Reserve the height.** The chart itself is loaded lazily, so without a
 *    fixed box the page would reflow the moment the bundle arrives. The chart
 *    area is the same height whether it holds a skeleton, a chart or an empty
 *    message.
 * 2. **Carry the data.** The chart is an SVG full of `<text>` nodes that a
 *    screen reader would read as a stream of loose numbers, and that a printed
 *    page may drop entirely. So the SVG is hidden from assistive technology and
 *    a real `<table>` of the same figures is rendered beside it — visually
 *    hidden, server-rendered, and present even if the chart script never loads.
 */
export function ChartFrame({
  label,
  height = 240,
  empty,
  table,
  tableVisible = false,
  children,
  className,
}: {
  /** Names the chart for the data table's caption. The visible heading is the card's. */
  label: string;
  /** Height of the chart area in pixels. */
  height?: number;
  /** Shown instead of the chart when there is nothing to plot. */
  empty?: string;
  table?: ChartTable;
  /**
   * Show the data table rather than hiding it.
   *
   * The dashboard is read at a glance, so there the table is only for assistive
   * technology and print. A report is read for its figures, so the same table
   * is on the page — one source of numbers either way, never a second copy
   * maintained by hand.
   */
  tableVisible?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn("m-0", className)}>
      <div style={{ height }} className="w-full">
        {empty ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border px-4">
            <p className="text-center text-sm text-muted-foreground">{empty}</p>
          </div>
        ) : (
          // The table below is the accessible copy of everything in here.
          <div aria-hidden className="size-full">
            {children}
          </div>
        )}
      </div>
      {table && !empty && <ChartDataTable caption={label} visible={tableVisible} {...table} />}
    </figure>
  );
}

/**
 * The key to a chart's series.
 *
 * Drawn here rather than with recharts' own `<Legend>` for two reasons: it is
 * server-rendered, so it is readable before the chart script arrives, and it is
 * ordinary text in the page's own type scale instead of SVG labels that ignore
 * it. The swatches are `aria-hidden` because the series names are the content.
 */
export function ChartLegend({ items, className }: { items: { label: string; color: string }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map(({ label, color }) => (
        <li key={label} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
          {label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The table that stands in for the chart — hidden by default, on the page when
 * `visible`.
 *
 * When it is hidden, `sr-only` goes on a wrapping `div`, not on the `<table>`.
 * A table refuses to lay out narrower than its own min-content width, so
 * `width: 1px` is ignored and the element keeps a real box — measured at
 * 336×72px — held off screen by nothing but the deprecated `clip`. A `div`
 * honours the 1px box and the `overflow: hidden`, so the table has no layout
 * and no hit area at all.
 */
function ChartDataTable({
  caption,
  columns,
  rows,
  visible,
}: ChartTable & { caption: string; visible: boolean }) {
  const cell = (index: number) =>
    visible ? cn("py-1 tabular-nums", index === 0 ? "text-left" : "pl-3 text-right") : undefined;

  const table = (
    <table className={visible ? "w-full text-xs" : undefined}>
      {/* The card's own heading is the visible one, so this never needs to show. */}
      <caption className={visible ? "sr-only" : undefined}>{caption}</caption>
      <thead>
        <tr className={visible ? "border-b border-border text-muted-foreground" : undefined}>
          {columns.map((column, index) => (
            <th key={column} scope="col" className={visible ? cn(cell(index), "font-medium") : undefined}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className={visible ? "border-b border-border/60 last:border-0" : undefined}>
            {row.map((value, valueIndex) =>
              // First cell of each row names it, so a screen reader reading a
              // figure out of order still says which month or department it is.
              valueIndex === 0 ? (
                <th
                  key={valueIndex}
                  scope="row"
                  className={visible ? cn(cell(valueIndex), "font-medium") : undefined}
                >
                  {value}
                </th>
              ) : (
                <td key={valueIndex} className={cell(valueIndex)}>
                  {value}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (!visible) return <div className="sr-only">{table}</div>;
  return <div className="mt-3 overflow-x-auto border-t border-border pt-2">{table}</div>;
}
