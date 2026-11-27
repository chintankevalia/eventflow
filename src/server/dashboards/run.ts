/**
 * Executes a compiled widget query and turns the result into something a chart can read.
 *
 * Three jobs, each of which is a trap if skipped:
 *
 *  - **Nothing `Decimal` or `BigInt` may leave this file.** `$queryRaw` returns `numeric` as a
 *    `Prisma.Decimal` instance and `COUNT(*)` as a `BigInt`. `BigInt` throws on
 *    `JSON.stringify`, and a `Decimal` instance reaches a client component stripped of its
 *    methods. Both become plain numbers here, which is what the rest of the app already does.
 *  - **Ratios divide here, not in SQL.** Dividing in Postgres means either a division-by-zero
 *    that kills the whole query or float precision loss on money.
 *  - **Missing time buckets are filled here.** SQL emits no row for a month with no events, and
 *    a line chart that silently closes the gap tells a different story from the truth.
 */
import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { monthLabel } from "@/components/charts/chart-tokens";
import { eventVisibilitySql, type AccessPolicy, type Viewer } from "@/server/access/policy";
import { applyLabel } from "./labels";
import { compileWidget, type CompileResult, type QueryPlan, type Warning } from "./compile";
import type { WidgetSpec } from "./spec";

/** One row of a widget's result, already formatted-agnostic but fully serialisable. */
export type WidgetRow = {
  /** The group label, never blank — the compiler coalesces nulls to a readable sentinel. */
  dim: string | null;
  /** True when this row is the "no value" group, so a chart can style it as such. */
  dimIsNull: boolean;
  series: string | null;
  seriesIsNull: boolean;
  /** The time bucket key, e.g. `2026-10`, with `grainLabel` for display. */
  grain: string | null;
  grainLabel: string | null;
  /** Metric key → value. `null` means genuinely unknown, not zero. */
  values: Record<string, number | null>;
};

export type WidgetResult = {
  ok: true;
  plan: QueryPlan;
  rows: WidgetRow[];
  warnings: Warning[];
  /** When the figures were read, for the "as of" line. */
  asOf: string;
  /** True when the row cap was reached, so the widget can say the view is partial. */
  truncated: boolean;
};

export type WidgetFailure = {
  ok: false;
  /** A refusal from the compiler, or an execution error, in words a reader can act on. */
  refusal: string;
  warnings: Warning[];
};

export type WidgetOutcome = WidgetResult | WidgetFailure;

/** How long one widget may hold a connection before it is cut off. */
const STATEMENT_TIMEOUT_MS = 10_000;

/**
 * Widgets run concurrently, but not unboundedly. Prisma's default pool is roughly
 * `cpus * 2 + 1`; a dozen widgets times a few readers would exhaust it and surface as an
 * inscrutable "Timed out fetching a new connection from the connection pool".
 */
const MAX_CONCURRENT_WIDGETS = 4;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // int8 — COUNT() comes back as BigInt and cannot be JSON-serialised.
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  // Prisma.Decimal. Via its string form, so the paise survive the trip.
  if (typeof value === "object" && value !== null && "toFixed" in value) {
    const n = Number(String(value));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A `SUM` over zero rows is SQL `NULL`. For money and counts that means zero — "spent nothing"
 * is a fact. For an average it does not: the mean of no decisions is unknown, not zero hours,
 * and the reports page is careful about exactly this distinction too.
 */
function zeroIfCountable(value: number | null, format: QueryPlan["metrics"][number]["format"]) {
  if (value !== null) return value;
  return format === "money" || format === "integer" ? 0 : null;
}

/** `2026-10` → `Oct 26`, `2026-Q3` → `Q3 26`, `2026` → `FY 2026-27`. */
export function grainLabel(grain: QueryPlan["grain"], key: string): string {
  switch (grain) {
    case "month":
      return monthLabel(key);
    case "day": {
      const d = new Date(`${key}T00:00:00+05:30`);
      return Number.isNaN(d.getTime())
        ? key
        : new Intl.DateTimeFormat("en-IN", {
            day: "2-digit",
            month: "short",
            year: "2-digit",
            timeZone: "Asia/Kolkata",
          })
            .format(d)
            .replace(/,/g, "");
    }
    case "week": {
      const [year, week] = key.split("-W");
      return week ? `W${week} ${year.slice(2)}` : key;
    }
    case "quarter": {
      const [year, quarter] = key.split("-Q");
      return quarter ? `Q${quarter} ${year.slice(2)}` : key;
    }
    case "fy": {
      const start = Number(key);
      // The key is the April in which the year starts, so FY 2026 reads "FY 2026-27".
      return Number.isFinite(start) ? `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}` : key;
    }
    default:
      return key;
  }
}

/** The next bucket key after `key`, for filling gaps. `null` where stepping is not supported. */
function nextKey(grain: QueryPlan["grain"], key: string): string | null {
  switch (grain) {
    case "day": {
      const d = new Date(`${key}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) return null;
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    case "month": {
      const [y, m] = key.split("-").map(Number);
      if (!y || !m) return null;
      // Date.UTC rolls the year over on its own in both directions.
      const d = new Date(Date.UTC(y, m, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    }
    case "quarter": {
      const [y, q] = key.split("-Q").map(Number);
      if (!y || !q) return null;
      return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`;
    }
    case "fy": {
      const y = Number(key);
      return Number.isFinite(y) ? String(y + 1) : null;
    }
    // ISO weeks do not step arithmetically across year boundaries, so a week series is left
    // exactly as the database returned it rather than filled wrongly.
    default:
      return null;
  }
}

/**
 * Inserts an empty row for every bucket between the first and last the query returned.
 *
 * Bounded by the data rather than by the period: an "all time" widget has no bounds to fill
 * between, and filling to today would invent months nobody asked about.
 */
function fillBuckets(rows: WidgetRow[], plan: QueryPlan): WidgetRow[] {
  if (plan.grain === "none" || rows.length < 2) return rows;
  // Only safe to fill a plain time series; with a second grouping, a gap is per group and
  // inventing the cross-product would be worse than the gap.
  if (plan.dimension || plan.series) return rows;

  const byKey = new Map(rows.map((r) => [r.grain!, r]));
  const keys = [...byKey.keys()].sort();
  const empty = (key: string): WidgetRow => ({
    dim: null,
    dimIsNull: false,
    series: null,
    seriesIsNull: false,
    grain: key,
    grainLabel: grainLabel(plan.grain, key),
    values: Object.fromEntries(
      plan.metrics.map((m) => [m.key, m.format === "money" || m.format === "integer" ? 0 : null]),
    ),
  });

  const out: WidgetRow[] = [];
  let cursor: string | null = keys[0];
  const last = keys[keys.length - 1];
  // A hard ceiling, so a day-grain widget spanning years cannot build a million rows.
  for (let guard = 0; cursor && guard <= plan.limit; guard++) {
    out.push(byKey.get(cursor) ?? empty(cursor));
    if (cursor === last) return out;
    cursor = nextKey(plan.grain, cursor);
  }
  return rows;
}

/** Reads one raw row into the shape a widget renders. */
function readRow(raw: Record<string, unknown>, plan: QueryPlan): WidgetRow {
  const values: Record<string, number | null> = {};
  for (const metric of plan.metrics) {
    if (metric.ratio) {
      const numerator = toNumber(raw[metric.ratio.numerator]);
      const denominator = toNumber(raw[metric.ratio.denominator]);
      if (numerator === null || !denominator) {
        // No denominator is "unknown", not zero — a nil utilisation would read as underspend.
        values[metric.key] = null;
      } else {
        const ratio = numerator / denominator;
        values[metric.key] = round2(metric.format === "percent" ? ratio * 100 : ratio);
      }
      continue;
    }
    const n = zeroIfCountable(toNumber(raw[metric.alias]), metric.format);
    values[metric.key] = n === null ? null : round2(n);
  }

  const grain = plan.grain === "none" ? null : ((raw.grain as string | null) ?? null);

  // `CHANNEL` becomes "Channel" here rather than in SQL, so the portal keeps one spelling of
  // each label. The null sentinel is already readable, so it is left exactly as the compiler
  // set it.
  const label = (value: string | null, grouping: typeof plan.dimension, isNull: boolean) =>
    value === null || isNull ? value : applyLabel(grouping?.valueLabels, value);

  const dimIsNull = Boolean(raw.dim_is_null);
  const seriesIsNull = Boolean(raw.series_is_null);
  return {
    dim: plan.dimension ? label((raw.dim as string | null) ?? null, plan.dimension, dimIsNull) : null,
    dimIsNull,
    series: plan.series ? label((raw.series as string | null) ?? null, plan.series, seriesIsNull) : null,
    seriesIsNull,
    grain,
    grainLabel: grain ? grainLabel(plan.grain, grain) : null,
    values,
  };
}

/**
 * Compiles and runs one widget. Never throws: a refusal, a bad spec and a database error all
 * come back as a `WidgetFailure`, so one broken widget cannot take a dashboard down.
 */
export async function runWidget(
  db: PrismaClient,
  spec: WidgetSpec,
  viewer: Viewer,
  policy: AccessPolicy,
  { now = new Date(), allowMoney = true }: { now?: Date; allowMoney?: boolean } = {},
): Promise<WidgetOutcome> {
  const visibility = eventVisibilitySql(viewer, policy);
  let compiled: CompileResult;
  try {
    compiled = compileWidget(spec, { now, allowMoney, visibility });
  } catch (err) {
    console.error("Widget failed to compile", err);
    return { ok: false, refusal: "This widget could not be built.", warnings: [] };
  }
  if (!compiled.ok) return { ok: false, refusal: compiled.refusal, warnings: compiled.warnings };

  const { sql, plan, warnings } = compiled;
  try {
    const raw = await db.$transaction(async (tx) => {
      // A pathological spec must fail fast rather than hold a pooled connection for half a
      // minute and starve the other widgets on the page.
      await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = 10000`);
      return tx.$queryRaw<Record<string, unknown>[]>(sql);
    });
    const rows = raw.map((r) => readRow(r, plan));
    return {
      ok: true,
      plan,
      rows: fillBuckets(rows, plan),
      warnings,
      asOf: new Date().toISOString(),
      truncated: raw.length >= plan.limit,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Surfaced in the widget, logged in full for us. A timeout is worth naming, because the
    // reader can act on it by adding a filter.
    console.error("Widget query failed", { sql: sql.text, message });
    const timedOut = /statement timeout|canceling statement/i.test(message);
    return {
      ok: false,
      refusal: timedOut
        ? "This widget took too long. Narrow it with a filter or a shorter period."
        : "This widget could not be loaded.",
      warnings,
    };
  }
}

/**
 * Runs a dashboard's widgets with a cap on how many are in flight at once.
 *
 * Returns results in the order the specs were given, whatever order they finish in.
 */
export async function runWidgets(
  db: PrismaClient,
  specs: WidgetSpec[],
  viewer: Viewer,
  policy: AccessPolicy,
  options: { now?: Date; concurrency?: number; allowMoney?: boolean } = {},
): Promise<WidgetOutcome[]> {
  const limit = Math.max(1, options.concurrency ?? MAX_CONCURRENT_WIDGETS);
  const out: WidgetOutcome[] = new Array(specs.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= specs.length) return;
      out[index] = await runWidget(db, specs[index], viewer, policy, {
        now: options.now,
        allowMoney: options.allowMoney,
      });
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, specs.length) }, worker));
  return out;
}

export { STATEMENT_TIMEOUT_MS };
