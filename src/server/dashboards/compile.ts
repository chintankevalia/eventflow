/**
 * Turns one saved `WidgetSpec` into a parameterised SQL statement, or into a refusal.
 *
 * Pure — no `PrismaClient`, no database. That is deliberate: almost everything worth testing
 * about this engine is the compilation, so it is all unit-testable without a server.
 *
 * ## Fan-out: the bug this file exists to prevent
 *
 * An event with 3 budget lines and 4 tasks, joined naively, yields 12 rows. `SUM(cl."actual")`
 * then reports four times the real spend and `COUNT(t."id")` three times the real tasks —
 * silently, and plausibly enough that nobody notices. So:
 *
 *  1. At most **one** table with many rows per event may appear in a widget. Two different ones
 *     (budget lines *and* tasks) is refused, because a budget line does not belong to a task and
 *     the number being asked for does not exist.
 *  2. When such a table is present, every metric must either read from that same table or be
 *     fan-out-immune — which means `COUNT(DISTINCT e."id")` and nothing else. A `SUM` over the
 *     event's own columns, or over the 1:1 results row, would be multiplied, so it is refused.
 *
 * Nothing is lost by rule 2: the event's `estimatedCost` *is* the sum of its lines' estimates,
 * so "estimated by expense category" simply uses the budget-line metric instead.
 *
 * A refusal is a feature. It is shown on the widget in words, never papered over with a
 * fallback that would draw a confident, wrong chart.
 *
 * ## Every `Prisma.raw` here takes a string literal
 *
 * Column aliases, select-list ordinals and sort directions are all drawn from frozen arrays of
 * literal fragments below, so nothing derived from a spec can ever reach raw SQL text. A test
 * and an ESLint rule both hold this in place.
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { resolveDateRange } from "@/lib/date-range";
import {
  enumArrayCast,
  JOINS,
  lookupDimension,
  lookupFilter,
  lookupMetric,
  lookupTimeField,
  MULTI_ROW_SOURCES,
  OPS_BY_KIND,
  type DimensionDef,
  type FactSource,
  type JoinKey,
  type MetricDef,
  type NumberFormat,
} from "./registry";
import type { LabelSet } from "./labels";
import { MAX_WIDGET_ROWS, type TimeGrain, type WidgetFilter, type WidgetSpec } from "./spec";

/** Something in the spec could not be honoured. The widget renders these as a footnote. */
export type Warning = { field: string; key?: string; message: string };

export type MetricColumn = {
  key: string;
  label: string;
  format: NumberFormat;
  /** The column alias this metric's value arrives under. */
  alias: string;
  /** Set for a ratio: the aliases of the two figures to divide, worked out in `run.ts`. */
  ratio?: { numerator: string; denominator: string };
  money: boolean;
};

export type GroupingPlan = { key: string; label: string; nullLabel: string; valueLabels?: LabelSet };

export type QueryPlan = {
  dimension: GroupingPlan | null;
  series: GroupingPlan | null;
  grain: TimeGrain;
  metrics: MetricColumn[];
  /** Aliases selected only to feed a ratio, not shown in their own right. */
  hidden: string[];
  limit: number;
};

export type CompileResult =
  | { ok: true; sql: Prisma.Sql; plan: QueryPlan; warnings: Warning[] }
  | { ok: false; refusal: string; warnings: Warning[] };

/**
 * IST, as a fixed offset rather than `AT TIME ZONE 'Asia/Kolkata'`.
 *
 * Both are correct for India, which has no daylight saving — but the fixed interval is exactly
 * what `istDay` does in TypeScript, so a month or quarter boundary computed here can never
 * disagree with one computed there. `proposedDate` is stored as IST midnight, which is 18:30 UTC
 * the previous day, so without the shift a 1 October event files under September.
 */
const IST = Prisma.sql`INTERVAL '5 hours 30 minutes'`;

/**
 * Literal fragments for the places SQL needs an identifier or a keyword rather than a value.
 * Writing them out means `Prisma.raw` never sees a computed string.
 */
const ALIAS_SQL = [
  Prisma.raw('"m0"'),
  Prisma.raw('"m1"'),
  Prisma.raw('"m2"'),
  Prisma.raw('"m3"'),
  Prisma.raw('"m4"'),
  Prisma.raw('"m5"'),
  Prisma.raw('"m6"'),
  Prisma.raw('"m7"'),
  Prisma.raw('"m8"'),
  Prisma.raw('"m9"'),
  Prisma.raw('"m10"'),
  Prisma.raw('"m11"'),
] as const;
const ALIAS_NAME = ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11"] as const;
/** The most aggregates one widget can select: six metrics, each possibly a ratio of two. */
export const MAX_AGGREGATES = ALIAS_SQL.length;

const ORDINAL = [
  Prisma.raw("1"),
  Prisma.raw("2"),
  Prisma.raw("3"),
  Prisma.raw("4"),
  Prisma.raw("5"),
  Prisma.raw("6"),
  Prisma.raw("7"),
  Prisma.raw("8"),
  Prisma.raw("9"),
  Prisma.raw("10"),
  Prisma.raw("11"),
  Prisma.raw("12"),
  Prisma.raw("13"),
  Prisma.raw("14"),
  Prisma.raw("15"),
  Prisma.raw("16"),
  Prisma.raw("17"),
] as const;
const ASC = Prisma.raw("ASC");
const DESC = Prisma.raw("DESC");

/** The bucket expression for each grain, and the key format it returns. */
function grainSql(grain: Exclude<TimeGrain, "none">, ts: Prisma.Sql): Prisma.Sql {
  const shifted = Prisma.sql`(${ts} + ${IST})`;
  switch (grain) {
    case "day":
      return Prisma.sql`to_char(date_trunc('day', ${shifted}), 'YYYY-MM-DD')`;
    case "week":
      // ISO week, so the year in the label always belongs to the week, not to 1 January.
      return Prisma.sql`to_char(date_trunc('week', ${shifted}), 'IYYY-"W"IW')`;
    case "month":
      // "YYYY-MM", the same key the reports page's monthly series uses, so a widget and that
      // chart can be read side by side.
      return Prisma.sql`to_char(date_trunc('month', ${shifted}), 'YYYY-MM')`;
    case "quarter":
      return Prisma.sql`to_char(date_trunc('quarter', ${shifted}), 'YYYY-"Q"Q')`;
    case "fy":
      // Motadata's financial year runs 1 April – 31 March, so the year is truncated three
      // months early and pushed back. The "FY 2026-27" label is built in `run.ts`.
      return Prisma.sql`to_char(date_trunc('year', ${shifted} - INTERVAL '3 months') + INTERVAL '3 months', 'YYYY')`;
  }
}

/** Builds one filter's predicate, or null when the clause has to be dropped. */
function predicate(spec: WidgetFilter, warnings: Warning[]): Prisma.Sql | null {
  const def = lookupFilter(spec.key);
  if (!def) {
    warnings.push({ field: "filter", key: spec.key, message: "This filter is no longer available." });
    return null;
  }
  if (!OPS_BY_KIND[def.kind].includes(spec.op)) {
    warnings.push({ field: "filter", key: spec.key, message: `"${def.label}" cannot be filtered that way.` });
    return null;
  }

  const col = def.column;
  if (spec.op === "is_null") return Prisma.sql`${col} IS NULL`;
  if (spec.op === "is_not_null") return Prisma.sql`${col} IS NOT NULL`;

  // Coerce the saved values to what this filter accepts. A value that does not coerce is
  // dropped, and if that empties the clause the whole clause goes — never a silent `IN ()`.
  let values: (string | number)[];
  if (def.kind === "number") {
    values = spec.values.map(Number).filter((n) => Number.isFinite(n));
  } else if (def.kind === "enum") {
    const legal = new Set(def.members ?? []);
    values = spec.values.filter((v): v is string => typeof v === "string" && legal.has(v));
    if (values.length !== spec.values.length) {
      warnings.push({
        field: "filter",
        key: spec.key,
        message: `Some saved values for "${def.label}" are no longer valid and were ignored.`,
      });
    }
  } else {
    values = spec.values.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200);
  }

  if (!values.length) {
    warnings.push({ field: "filter", key: spec.key, message: `"${def.label}" had no usable value.` });
    return null;
  }

  // Enums compare against a parameter cast to the enum array, never a column cast to text:
  // casting the column throws away its statistics and wrecks the planner's row estimates.
  const cast = def.kind === "enum" ? enumArrayCast(def) : null;
  const anyOf = cast ? Prisma.sql`ANY(${values}::${cast})` : Prisma.sql`ANY(${values})`;

  switch (spec.op) {
    case "in":
      return Prisma.sql`${col} = ${anyOf}`;
    case "not_in":
      // NULL is not "not in" anything in SQL, so say so explicitly or those rows vanish.
      return Prisma.sql`(${col} IS NULL OR NOT (${col} = ${anyOf}))`;
    case "eq":
      return Prisma.sql`${col} = ${values[0]}`;
    case "neq":
      return Prisma.sql`(${col} IS NULL OR ${col} <> ${values[0]})`;
    case "gt":
      return Prisma.sql`${col} > ${values[0]}`;
    case "gte":
      return Prisma.sql`${col} >= ${values[0]}`;
    case "lt":
      return Prisma.sql`${col} < ${values[0]}`;
    case "lte":
      return Prisma.sql`${col} <= ${values[0]}`;
    case "between": {
      if (values.length < 2) {
        warnings.push({ field: "filter", key: spec.key, message: `"${def.label}" needs two values.` });
        return null;
      }
      return Prisma.sql`${col} BETWEEN ${values[0]} AND ${values[1]}`;
    }
    case "contains":
      return Prisma.sql`${col} ILIKE ${`%${String(values[0])}%`}`;
  }
  return null;
}

/** The table a source is joined from, when it is not the event itself. */
const SOURCE_JOIN: Record<Exclude<FactSource, "event">, Prisma.Sql> = {
  costLine: Prisma.sql`LEFT JOIN "cost_line_items" cl ON cl."eventId" = e."id"`,
  task: Prisma.sql`LEFT JOIN "tasks" t ON t."eventId" = e."id"`,
  // Rounds first, then their decisions: a decision-level metric needs both.
  approval: Prisma.sql`LEFT JOIN "approval_rounds" ar ON ar."eventId" = e."id" LEFT JOIN "approval_decisions" ad ON ad."roundId" = ar."id"`,
  // 1:1 — `PostEventResult.eventId` is unique, so this adds no rows.
  outcome: Prisma.sql`LEFT JOIN "post_event_results" per ON per."eventId" = e."id"`,
};

const SOURCE_LABEL: Record<FactSource, string> = {
  event: "events",
  costLine: "budget lines",
  task: "tasks",
  approval: "approvals",
  outcome: "post-event results",
};

const singular = (plural: string) => plural.replace(/s$/, "");

export type CompileOptions = {
  now?: Date;
  /**
   * Whether this viewer may see money. Checked here rather than only in the builder, so a widget
   * saved while someone had access stops working the moment it is revoked.
   */
  allowMoney?: boolean;
  /**
   * The viewer's department-visibility predicate, already compiled to SQL by
   * `eventVisibilitySql` — `null` when it imposes no restriction (an administrator, or a
   * department policy of "ALL"). Taken as a finished fragment rather than a `Viewer`/`AccessPolicy`
   * pair so this file never has to import the access-policy module to stay pure and
   * database-free; the caller (`run.ts`) is where the policy is actually read. Checked here
   * rather than only where the engine's callers happen to filter, for the same reason
   * `allowMoney` is: a widget saved while someone could see a department must stop returning its
   * rows the moment that department is revoked, not keep working until the dashboard is resaved.
   */
  visibility?: Prisma.Sql | null;
};

export function compileWidget(spec: WidgetSpec, options: CompileOptions | Date = {}): CompileResult {
  // A bare Date is accepted for the common "just fix the clock" call in tests.
  const { now = new Date(), allowMoney = true, visibility = null } =
    options instanceof Date ? { now: options, allowMoney: true, visibility: null } : options;
  const warnings: Warning[] = [];

  // ── Resolve the metrics, expanding each ratio into the two parts it needs ──
  const requested: { key: string; def: MetricDef }[] = [];
  for (const key of spec.metrics) {
    const def = lookupMetric(key);
    if (!def) {
      warnings.push({ field: "metric", key, message: "This measure is no longer available." });
      continue;
    }
    requested.push({ key, def });
  }
  if (!requested.length) {
    return { ok: false, refusal: "This widget has no measure the portal still recognises.", warnings };
  }

  if (!allowMoney) {
    const money = requested.filter(({ def }) => def.money);
    if (money.length) {
      return {
        ok: false,
        refusal: `This widget measures ${money.map((m) => `"${m.def.label}"`).join(", ")}, which your role cannot see. Ask an administrator if you need budget figures on a dashboard.`,
        warnings,
      };
    }
  }

  /** Aggregates that must be selected, in order, including a ratio's parts. */
  const selected = new Map<string, MetricDef>();
  const addAggregate = (key: string): MetricDef | null => {
    const def = lookupMetric(key);
    // A ratio has no aggregate of its own, so it can never be a part of another ratio.
    if (!def || def.ratioOf) return null;
    if (selected.size >= MAX_AGGREGATES && !selected.has(key)) return null;
    selected.set(key, def);
    return def;
  };

  const metrics: MetricColumn[] = [];
  const shown = new Set<string>();
  for (const { key, def } of requested) {
    if (def.ratioOf) {
      const num = addAggregate(def.ratioOf.numerator);
      const den = addAggregate(def.ratioOf.denominator);
      if (!num || !den) {
        warnings.push({ field: "metric", key, message: `"${def.label}" cannot be worked out any more.` });
        continue;
      }
      metrics.push({
        key,
        label: def.label,
        format: def.format,
        // A ratio has no column of its own; `run.ts` writes it under this name.
        alias: key,
        ratio: { numerator: def.ratioOf.numerator, denominator: def.ratioOf.denominator },
        money: Boolean(def.money),
      });
      continue;
    }
    if (!addAggregate(key)) {
      warnings.push({ field: "metric", key, message: `"${def.label}" could not be included.` });
      continue;
    }
    shown.add(key);
    metrics.push({ key, label: def.label, format: def.format, alias: key, money: Boolean(def.money) });
  }
  if (!metrics.length) {
    return { ok: false, refusal: "None of this widget's measures can be worked out any more.", warnings };
  }

  // ── Resolve the groupings ─────────────────────────────────────────────────
  const dimension = resolveGrouping(spec.dimension, "dimension", warnings);
  const series = resolveGrouping(spec.series, "series", warnings);

  const fallbackTime = lookupTimeField("event.proposedDate")!;
  const timeField = lookupTimeField(spec.timeField);
  if (!timeField) {
    warnings.push({ field: "timeField", key: spec.timeField, message: "Falling back to the proposed date." });
  }
  const ts = (timeField ?? fallbackTime).sql;

  let grain: TimeGrain = spec.grain;
  if (grain !== "none" && (spec.view === "donut" || spec.view === "kpi" || spec.view === "gauge")) {
    // A single number or a pie has nowhere to put a time axis, and bucketing would split
    // one figure into many rows.
    warnings.push({ field: "grain", message: "A time grain does not apply to this widget type; ignored." });
    grain = "none";
  }

  // ── The fan-out rules ─────────────────────────────────────────────────────
  const sources = new Set<FactSource>();
  for (const def of selected.values()) sources.add(def.source);
  if (dimension) sources.add(dimension.def.source);
  if (series) sources.add(series.def.source);
  for (const f of spec.filters) {
    const def = lookupFilter(f.key);
    if (def) sources.add(def.source);
  }

  const multi = [...sources].filter((s) => MULTI_ROW_SOURCES.has(s));
  if (multi.length > 1) {
    const names = multi.map((s) => SOURCE_LABEL[s]);
    const last = names[names.length - 1];
    return {
      ok: false,
      refusal: `${names.slice(0, -1).join(", ")} and ${last} can't be combined in one widget — a ${singular(names[0])} doesn't belong to a ${singular(last)}, so there is no such number.`,
      warnings,
    };
  }
  const joined = multi[0];
  if (joined) {
    const unsafe = [...selected.values()].filter((def) => def.source !== joined && !def.fanoutSafe);
    if (unsafe.length) {
      const labels = unsafe.map((d) => `"${d.label}"`).join(", ");
      return {
        ok: false,
        refusal: `${labels} can't be measured alongside ${SOURCE_LABEL[joined]} — each event would be counted once per ${singular(SOURCE_LABEL[joined])}. Use the ${SOURCE_LABEL[joined]} version of the measure instead.`,
        warnings,
      };
    }
  }

  // ── Assemble ──────────────────────────────────────────────────────────────
  const joins: Prisma.Sql[] = [];
  for (const source of sources) if (source !== "event") joins.push(SOURCE_JOIN[source]);
  const joinKeys = new Set<JoinKey>([...(dimension?.def.joins ?? []), ...(series?.def.joins ?? [])]);
  for (const key of joinKeys) joins.push(JOINS[key]);

  // Select list, tracking each column's 1-based position for GROUP BY and ORDER BY.
  const select: Prisma.Sql[] = [];
  const groupOrdinals: number[] = [];
  let position = 0;
  const push = (sql: Prisma.Sql) => {
    select.push(sql);
    return ++position;
  };

  let dimOrdinal: number | null = null;
  if (dimension) {
    // COALESCE in SQL so no row ever carries a blank label, with the sentinel bound as a
    // parameter rather than quoted into the text. The companion boolean lets a chart style a
    // non-value as a non-value instead of treating "No partner" as a partner.
    dimOrdinal = push(Prisma.sql`COALESCE(${dimension.def.sql}::text, ${dimension.def.nullLabel}) AS "dim"`);
    groupOrdinals.push(dimOrdinal, push(Prisma.sql`${dimension.def.sql} IS NULL AS "dim_is_null"`));
  }
  let seriesOrdinal: number | null = null;
  if (series) {
    seriesOrdinal = push(Prisma.sql`COALESCE(${series.def.sql}::text, ${series.def.nullLabel}) AS "series"`);
    groupOrdinals.push(seriesOrdinal, push(Prisma.sql`${series.def.sql} IS NULL AS "series_is_null"`));
  }
  let grainOrdinal: number | null = null;
  if (grain !== "none") {
    grainOrdinal = push(Prisma.sql`${grainSql(grain, ts)} AS "grain"`);
    groupOrdinals.push(grainOrdinal);
  }

  /** Registry key → the `m0`…`m11` column its value arrives in. */
  const columnOf = new Map<string, string>();
  const metricOrdinals = new Map<string, number>();
  let slot = 0;
  for (const [key, def] of selected) {
    columnOf.set(key, ALIAS_NAME[slot]);
    metricOrdinals.set(key, push(Prisma.sql`${def.agg} AS ${ALIAS_SQL[slot]}`));
    slot++;
  }

  // Point each metric column at where its figures actually landed.
  for (const m of metrics) {
    if (m.ratio) {
      m.ratio = {
        numerator: columnOf.get(m.ratio.numerator)!,
        denominator: columnOf.get(m.ratio.denominator)!,
      };
    } else {
      m.alias = columnOf.get(m.key)!;
    }
  }
  const hidden = [...selected.keys()].filter((k) => !shown.has(k)).map((k) => columnOf.get(k)!);

  // ── WHERE ─────────────────────────────────────────────────────────────────
  const where: Prisma.Sql[] = [];
  if (visibility) where.push(visibility);
  const range = resolveDateRange({ range: spec.range, from: spec.from, to: spec.to }, now);
  if (range) where.push(Prisma.sql`${ts} >= ${range.from} AND ${ts} <= ${range.to}`);
  else if (spec.range === "custom") {
    warnings.push({ field: "range", message: "The custom dates are incomplete; showing all time." });
  }
  // A time axis cannot show a bucket for an event with no date in that column.
  if (grain !== "none") where.push(Prisma.sql`${ts} IS NOT NULL`);
  for (const f of spec.filters) {
    const p = predicate(f, warnings);
    if (p) where.push(p);
  }

  // ── ORDER BY, always by an ordinal the compiler worked out itself ─────────
  const firstShown = metrics.find((m) => !m.ratio) ?? metrics[0];
  const firstMetricOrdinal = metricOrdinals.get(
    firstShown.ratio ? [...selected.keys()][0] : firstShown.key,
  );
  let orderOrdinal: number;
  let dir = spec.sort.dir;
  if (grainOrdinal != null && (spec.view === "line" || spec.view === "area" || spec.sort.by === "grain")) {
    // A trend reads chronologically whatever the saved sort says.
    orderOrdinal = grainOrdinal;
    dir = "asc";
  } else if (spec.sort.by === "dimension" && dimOrdinal != null) {
    orderOrdinal = dimOrdinal;
  } else {
    orderOrdinal = firstMetricOrdinal ?? dimOrdinal ?? 1;
  }
  // NULLS LAST in both directions: Postgres puts NULLs first when sorting descending, which
  // would otherwise head a chart with the one group that has nothing in it.
  const dirSql = dir === "asc" ? ASC : DESC;
  const order = Prisma.sql`${ORDINAL[orderOrdinal - 1]} ${dirSql} NULLS LAST`;
  const tie =
    dimOrdinal != null && orderOrdinal !== dimOrdinal
      ? Prisma.sql`, ${ORDINAL[dimOrdinal - 1]} ASC`
      : Prisma.empty;

  const limit = Math.min(spec.limit, MAX_WIDGET_ROWS);
  const groupBy = groupOrdinals.length
    ? Prisma.sql`GROUP BY ${Prisma.join(
        groupOrdinals.map((n) => ORDINAL[n - 1]),
        ", ",
      )} ORDER BY ${order}${tie}`
    : Prisma.empty;

  const sql = Prisma.sql`SELECT ${Prisma.join(select, ", ")}
FROM "events" e
${joins.length ? Prisma.join(joins, " ") : Prisma.empty}
${where.length ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty}
${groupBy}
LIMIT ${limit}`;

  return {
    ok: true,
    sql,
    plan: {
      dimension: dimension ? grouping(dimension) : null,
      series: series ? grouping(series) : null,
      grain,
      metrics,
      hidden,
      limit,
    },
    warnings,
  };
}

const grouping = ({ key, def }: { key: string; def: DimensionDef }): GroupingPlan => ({
  key,
  label: def.label,
  nullLabel: def.nullLabel,
  valueLabels: def.valueLabels,
});

function resolveGrouping(
  key: string | null,
  field: string,
  warnings: Warning[],
): { key: string; def: DimensionDef } | null {
  if (!key) return null;
  const def = lookupDimension(key);
  if (!def) {
    warnings.push({ field, key, message: "This grouping is no longer available; the widget is ungrouped." });
    return null;
  }
  return { key, def };
}
