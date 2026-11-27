/**
 * The saved shape of one widget's question: what to measure, how to group it, what to filter.
 *
 * The governing rule here is that **a spec is persisted user data that outlives the code**. If
 * this schema enumerated registry keys — `metric: z.enum(METRIC_KEYS)` — then retiring a single
 * metric would make every saved dashboard containing it fail to parse, and a whole page would
 * render an error because one widget went stale. So keys are plain strings, validated only for
 * shape and length here, and *resolved* against the registry at compile time, where a missing
 * key becomes a warning the widget can show as a footnote.
 *
 * Every field is `.catch()`-defaulted, the same convention `eventListFiltersSchema` uses, so
 * parsing can never throw: a corrupt field degrades to its default rather than taking the
 * dashboard down. The object is *loose*, so a field written by a newer deploy survives being
 * read and re-saved by an older one instead of being silently stripped.
 *
 * Pure: no database, no Prisma. Safe to import from a test or from server code alike.
 */
import { z } from "zod";

/** Bumped only for shape changes that need migrating. An unknown future version is tolerated. */
export const WIDGET_SPEC_VERSION = 1;

/** How a widget draws its rows. Decides row caps and whether a second dimension is allowed. */
export const WIDGET_VIEWS = ["kpi", "bar", "line", "area", "donut", "table", "gauge"] as const;
export type WidgetView = (typeof WIDGET_VIEWS)[number];

/**
 * How a figure is written out. Lives here rather than in the registry because the widgets that
 * render it are client components, and the registry is server-only — importing it in the browser
 * would drag the Prisma client into the bundle.
 */
export const NUMBER_FORMATS = ["integer", "money", "hours", "percent", "decimal"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

/**
 * Comparison operators. This one *is* a closed enum, because an operator becomes a SQL
 * fragment — but it still has a fallback rather than throwing.
 */
export const FILTER_OPS = [
  "in",
  "not_in",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "is_null",
  "is_not_null",
  "contains",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** Time bucketing. `none` means "do not add a time dimension at all". */
export const TIME_GRAINS = ["none", "day", "week", "month", "quarter", "fy"] as const;
export type TimeGrain = (typeof TIME_GRAINS)[number];

/**
 * One filter clause. `key` names a *filter* in the registry, never a column, and `values` is
 * deliberately loosely typed: the registry entry decides how to coerce each one (enum member,
 * cuid, ISO day, number) and drops the whole clause if coercion fails.
 */
export const widgetFilterSchema = z.object({
  key: z.string().trim().min(1).max(64),
  op: z.enum(FILTER_OPS).catch("in"),
  values: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .max(200)
    .catch([]),
});
export type WidgetFilter = z.infer<typeof widgetFilterSchema>;

/** The most rows any widget may pull back. A table paginates; a chart should never need more. */
export const MAX_WIDGET_ROWS = 500;

export const widgetSpecSchema = z.looseObject({
  v: z.number().int().catch(WIDGET_SPEC_VERSION),

  view: z.enum(WIDGET_VIEWS).catch("table"),

  /** Registry keys, resolved later — see the module note on why these are not enums. */
  metrics: z.array(z.string().trim().min(1).max(64)).min(1).max(6).catch(["events.count"]),
  dimension: z.string().trim().min(1).max(64).nullable().catch(null),
  /** An optional second grouping — the series split on a grouped or stacked bar. */
  series: z.string().trim().min(1).max(64).nullable().catch(null),

  grain: z.enum(TIME_GRAINS).catch("none"),
  /** Which date column the grain and the period apply to. A registry key. */
  timeField: z.string().trim().min(1).max(64).catch("event.proposedDate"),

  /**
   * The period by *name*, not by dates — the same decision as `?range=fy` on the reports page,
   * so a widget saved today still means "this financial year" next April. `from` and `to` speak
   * only for `range: "custom"`.
   */
  range: z.string().trim().max(16).catch("all"),
  from: z.string().trim().max(10).optional().catch(undefined),
  to: z.string().trim().max(10).optional().catch(undefined),

  filters: z.array(widgetFilterSchema).max(25).catch([]),

  sort: z
    .object({
      /** `"metric"`, `"dimension"` or `"grain"` — resolved to a select-list position, never SQL. */
      by: z.string().trim().max(80).catch("metric"),
      dir: z.enum(["asc", "desc"]).catch("desc"),
    })
    .catch({ by: "metric", dir: "desc" }),

  limit: z.number().int().min(1).max(MAX_WIDGET_ROWS).catch(50),

  /** Gauge only: the figure to measure against, typed by hand. Never a second query. */
  target: z.number().finite().nullable().catch(null),
});

export type WidgetSpec = z.infer<typeof widgetSpecSchema>;

/** What an empty widget starts as, and what a spec that is not even an object falls back to. */
export const DEFAULT_SPEC: WidgetSpec = widgetSpecSchema.parse({});

/**
 * Reads a spec out of the database's `Json` column.
 *
 * `widgetSpecSchema` cannot throw on an *object*, because every field catches — but it can still
 * fail on `null`, a string, or an array, which is what a hand-edited row or a failed migration
 * leaves behind. This is the only entry point, so no caller has to think about that.
 */
export function parseWidgetSpec(value: unknown): WidgetSpec {
  const parsed = widgetSpecSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_SPEC };
}

/** Dashboard-level filter defaults: the subset of a spec a whole dashboard can set. */
export const dashboardFiltersSchema = z.looseObject({
  range: z.string().trim().max(16).catch("all"),
  from: z.string().trim().max(10).optional().catch(undefined),
  to: z.string().trim().max(10).optional().catch(undefined),
  filters: z.array(widgetFilterSchema).max(25).catch([]),
});
export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;

export const DEFAULT_DASHBOARD_FILTERS: DashboardFilters = dashboardFiltersSchema.parse({});

export function parseDashboardFilters(value: unknown): DashboardFilters {
  const parsed = dashboardFiltersSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_DASHBOARD_FILTERS };
}

/**
 * Lays a dashboard's defaults underneath one widget's spec.
 *
 * A widget overrides the period only if it names one of its own, and filters are concatenated
 * rather than replaced: a dashboard-level "Channel only" must not be escapable by a widget, or
 * the filter bar at the top of the page would be a lie.
 */
export function withDashboardFilters(spec: WidgetSpec, dashboard: DashboardFilters): WidgetSpec {
  const ownPeriod = spec.range !== "all" || spec.from != null || spec.to != null;
  return {
    ...spec,
    range: ownPeriod ? spec.range : dashboard.range,
    from: ownPeriod ? spec.from : dashboard.from,
    to: ownPeriod ? spec.to : dashboard.to,
    filters: [...dashboard.filters, ...spec.filters].slice(0, 25),
  };
}
