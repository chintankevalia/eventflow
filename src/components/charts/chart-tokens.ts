/**
 * The pieces both halves of a chart need: the server-rendered frame and legend,
 * and the client-rendered chart itself. Kept free of hooks and of `"use client"`
 * so importing it does not pull a page into the client bundle.
 */

/**
 * Chart colours, as CSS variables rather than resolved values.
 *
 * recharts writes `fill` and `stroke` straight onto the SVG, and `var(--…)` is
 * legal there, so a chart follows the theme without re-rendering: switching to
 * dark mode changes the tokens and the bars change with them. Resolving the
 * variables in JavaScript would freeze whichever theme was active when the
 * chart mounted.
 *
 * Every entry is an existing token from `src/styles/tokens.css`. No new brand
 * colour is invented here — a wider series palette is a branding decision.
 */
/**
 * The categorical series palette, in fixed order.
 *
 * Assigned by position and **never cycled**: a seventh category folds into "Other" rather than
 * reusing a colour, because two slices of the same colour in one chart is worse than a grouped
 * remainder. Colour follows the entity, not its rank, so `seriesColor` is called with a stable
 * index — filtering a group out must not repaint the ones that remain.
 *
 * Defined in `src/styles/tokens.css` per theme and consumed as `var(--…)` so dark mode recolours
 * without a re-render. See that file for why these exist and how they were validated.
 */
export const CHART_SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
] as const;

/** How many distinct categories a chart may colour before the rest become "Other". */
export const MAX_SERIES = CHART_SERIES.length;

/** The colour for a category at a given position. Out of range reuses the muted grey. */
export function seriesColor(index: number): string {
  return CHART_SERIES[index] ?? "var(--muted-foreground)";
}

export const CHART_COLOR = {
  /** The figure the chart is about: coral, the Motadata accent. */
  primary: "var(--brand-coral)",
  /** The figure it is compared against — plan vs actual, budget vs spend. */
  comparison: "var(--muted-foreground)",
  /** Grid lines and axes. */
  grid: "var(--border)",
  info: "var(--info)",
  success: "var(--success)",
  warning: "var(--warning)",
} as const;

const MONTH_FORMAT = new Intl.DateTimeFormat("en-IN", {
  month: "short",
  year: "2-digit",
  timeZone: "Asia/Kolkata",
});

/**
 * `2026-10` → `Oct 26`, for an axis tick or a table row header.
 *
 * Read as midnight IST, the same way `getMonthlySpend` buckets the month, so
 * the label can never name the month next door to the one it counts.
 */
export function monthLabel(key: string): string {
  const date = new Date(`${key}-01T00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return key;
  return MONTH_FORMAT.format(date).replace(/,/g, "");
}
