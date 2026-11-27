import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { compileWidget, type CompileResult } from "./compile";
import { DIMENSIONS, FILTERS, JOINS, METRICS, TIME_FIELDS } from "./registry";
import { parseWidgetSpec, type WidgetSpec } from "./spec";

const spec = (patch: Partial<WidgetSpec> = {}): WidgetSpec => parseWidgetSpec({ ...patch });

/** Narrows to the success case, failing with the refusal rather than a type error. */
function ok(result: CompileResult) {
  if (!result.ok) throw new Error(`expected a query, got a refusal: ${result.refusal}`);
  return result;
}
function refused(result: CompileResult) {
  if (result.ok) throw new Error("expected a refusal, got a query");
  return result;
}

describe("the registry is the only source of SQL", () => {
  // This is the test that *proves* the file's invariant rather than documenting it: if no
  // fragment in the registry carries a parameter of its own, then every parameter in a
  // compiled query provably came from a spec value, which is the bound, safe path.
  it("has no parameters in any fragment", () => {
    const offenders: string[] = [];
    const check = (label: string, sql: Prisma.Sql) => {
      if (sql.values.length) offenders.push(`${label} (${sql.values.length})`);
    };
    for (const [key, d] of Object.entries(DIMENSIONS)) {
      check(`dimension ${key}`, d.sql);
      if (d.orderSql) check(`dimension ${key} order`, d.orderSql);
    }
    for (const [key, m] of Object.entries(METRICS)) check(`metric ${key}`, m.agg);
    for (const [key, f] of Object.entries(FILTERS)) check(`filter ${key}`, f.column);
    for (const [key, t] of Object.entries(TIME_FIELDS)) check(`time ${key}`, t.sql);
    for (const [key, j] of Object.entries(JOINS)) check(`join ${key}`, j);
    expect(offenders).toEqual([]);
  });

  it("gives every metric a format, and every ratio two real parts", () => {
    for (const [key, m] of Object.entries(METRICS)) {
      expect(m.format, key).toBeTruthy();
      if (m.ratioOf) {
        expect(METRICS[m.ratioOf.numerator], `${key} numerator`).toBeTruthy();
        expect(METRICS[m.ratioOf.denominator], `${key} denominator`).toBeTruthy();
        // A ratio of a ratio has no aggregate to select.
        expect(METRICS[m.ratioOf.numerator].ratioOf, `${key} numerator`).toBeUndefined();
        expect(METRICS[m.ratioOf.denominator].ratioOf, `${key} denominator`).toBeUndefined();
      }
    }
  });

  it("names a real join for every dimension that needs one", () => {
    for (const [key, d] of Object.entries(DIMENSIONS)) {
      for (const join of d.joins) expect(JOINS[join], `${key} → ${join}`).toBeTruthy();
    }
  });
});

describe("compileWidget — injection", () => {
  const attacks = [
    'e."id"; DROP TABLE events--',
    "__proto__",
    "constructor",
    "prototype",
    "x) OR 1=1--",
    "'; DELETE FROM users; --",
    "event.department\u0000",
  ];

  it("never lets a dimension key reach the SQL text", () => {
    for (const attack of attacks) {
      const result = compileWidget(spec({ dimension: attack, metrics: ["events.count"] }));
      const text = result.ok ? result.sql.text : "";
      expect(text).not.toContain("DROP");
      expect(text).not.toContain("DELETE");
      expect(text).not.toContain("1=1");
      expect(text).not.toContain(attack);
      expect(result.warnings.some((w) => w.field === "dimension")).toBe(true);
    }
  });

  it("never lets a metric key reach the SQL text, and refuses when none survive", () => {
    for (const attack of attacks) {
      const result = compileWidget(spec({ metrics: [attack] }));
      expect(result.ok).toBe(false);
      expect(refused(result).warnings.some((w) => w.field === "metric" && w.key === attack)).toBe(true);
    }
  });

  it("never lets a filter key or value reach the SQL text", () => {
    for (const attack of attacks) {
      const byKey = compileWidget(
        spec({ metrics: ["events.count"], filters: [{ key: attack, op: "in", values: ["x"] }] }),
      );
      expect(ok(byKey).sql.text).not.toContain(attack);

      // A legitimate key with a malicious value: the value is allowed, but only as a bound
      // parameter, so it appears in `values` and never in `text`.
      const byValue = compileWidget(
        spec({ metrics: ["events.count"], filters: [{ key: "event.city", op: "eq", values: [attack] }] }),
      );
      const compiled = ok(byValue);
      expect(compiled.sql.text).not.toContain(attack);
      expect(compiled.sql.values).toContain(attack);
    }
  });

  it("never lets a sort key reach the SQL text", () => {
    const result = ok(
      compileWidget(
        spec({ metrics: ["events.count"], dimension: "event.department", sort: { by: attacks[0], dir: "desc" } }),
      ),
    );
    expect(result.sql.text).not.toContain("DROP");
    // Ordering is always by a select-list ordinal the compiler chose itself.
    expect(result.sql.text).toMatch(/ORDER BY \d+ (ASC|DESC) NULLS LAST/);
  });

  it("drops an enum value that is not a real member", () => {
    const result = ok(
      compileWidget(
        spec({
          metrics: ["events.count"],
          filters: [{ key: "event.department", op: "in", values: ["CHANNEL", "NOT_A_DEPARTMENT"] }],
        }),
      ),
    );
    expect(result.sql.values.flat()).toContain("CHANNEL");
    expect(result.sql.values.flat()).not.toContain("NOT_A_DEPARTMENT");
    expect(result.warnings.some((w) => w.key === "event.department")).toBe(true);
  });

  it("drops the whole clause when no value survives, rather than emitting an empty list", () => {
    const result = ok(
      compileWidget(
        spec({ metrics: ["events.count"], filters: [{ key: "event.department", op: "in", values: ["NOPE"] }] }),
      ),
    );
    expect(result.sql.text).not.toContain("WHERE");
    expect(result.warnings.some((w) => w.message.includes("no usable value"))).toBe(true);
  });
});

describe("compileWidget — enum comparison", () => {
  it("casts the parameter to the enum array and leaves the column alone", () => {
    const result = ok(
      compileWidget(
        spec({ metrics: ["events.count"], filters: [{ key: "event.department", op: "in", values: ["CHANNEL"] }] }),
      ),
    );
    // Casting the column would throw away its statistics: measured at 2 estimated rows against
    // 107 actual, a 50x error that wrecks join order on a multi-table query.
    expect(result.sql.text).toContain('"Department"[]');
    expect(result.sql.text).not.toContain('e."department"::text =');
  });

  it("keeps NULL rows when excluding values, which SQL would otherwise drop", () => {
    const result = ok(
      compileWidget(
        spec({
          metrics: ["events.count"],
          filters: [{ key: "event.partnerOrgId", op: "not_in", values: ["org-1"] }],
        }),
      ),
    );
    expect(result.sql.text).toContain("IS NULL OR NOT");
  });
});

describe("compileWidget — fan-out", () => {
  it("refuses two different many-row sources in one widget", () => {
    // A budget line does not belong to a task, so there is no such number. Joining both would
    // give 3 lines x 4 tasks = 12 rows and report four times the spend.
    const result = refused(
      compileWidget(spec({ metrics: ["lines.approved"], dimension: "task.status" })),
    );
    expect(result.refusal).toContain("can't be combined");
    expect(result.refusal.toLowerCase()).toContain("budget lines");
    expect(result.refusal.toLowerCase()).toContain("tasks");
  });

  it("refuses an event-level sum beside a budget-line measure", () => {
    const result = refused(compileWidget(spec({ metrics: ["money.estimated", "lines.approved"] })));
    expect(result.refusal).toContain("Estimated cost");
    expect(result.refusal).toContain("once per budget line");
  });

  it("allows a plain event count beside a budget-line measure", () => {
    // COUNT(DISTINCT e."id") is immune to the join multiplying rows, so this pairing is safe
    // and is the one people actually want: spend and how many events it came from.
    const result = ok(
      compileWidget(spec({ metrics: ["lines.approved", "events.count"], dimension: "event.partner" })),
    );
    expect(result.sql.text).toContain('COUNT(DISTINCT e."id")');
    expect(result.sql.text).toContain('SUM(cl."approved")');
  });

  it("joins a many-row table at most once", () => {
    const result = ok(
      compileWidget(spec({ metrics: ["lines.approved", "lines.actual"], dimension: "cost.category" })),
    );
    const joins = result.sql.text.match(/LEFT JOIN "cost_line_items"/g) ?? [];
    expect(joins).toHaveLength(1);
  });

  it("allows two sums from the same many-row table", () => {
    const result = ok(compileWidget(spec({ metrics: ["tasks.done", "tasks.count"], dimension: "task.owner" })));
    expect(result.sql.text).toContain('LEFT JOIN "tasks" t');
    expect(result.sql.text).toContain('LEFT JOIN "users" tow');
  });

  it("allows a results sum beside an event sum, because results are one row per event", () => {
    const result = ok(compileWidget(spec({ metrics: ["money.actual", "outcome.leads"] })));
    expect(result.sql.text).toContain('LEFT JOIN "post_event_results" per');
  });

  it("refuses a results sum beside a budget-line measure", () => {
    // post_event_results is 1:1 with events, but once cost lines are joined its single row
    // repeats per line, so summing it would multiply just the same.
    const result = refused(compileWidget(spec({ metrics: ["lines.approved", "outcome.leads"] })));
    expect(result.refusal).toContain("New leads");
  });
});

describe("compileWidget — ratios", () => {
  it("selects both parts and divides later, never in SQL", () => {
    const result = ok(compileWidget(spec({ metrics: ["ratio.budgetUtilisation"] })));
    expect(result.sql.text).toContain('SUM(e."actualCost")');
    expect(result.sql.text).toContain('SUM(e."estimatedCost")');
    // Dividing in Postgres risks a division-by-zero that kills the query.
    expect(result.sql.text).not.toContain("/");
    const metric = result.plan.metrics[0];
    expect(metric.ratio).toEqual({ numerator: "m0", denominator: "m1" });
    expect(result.plan.hidden).toEqual(["m0", "m1"]);
  });

  it("shows a part in its own right when it is also requested", () => {
    const result = ok(compileWidget(spec({ metrics: ["money.actual", "ratio.budgetUtilisation"] })));
    expect(result.plan.hidden).toEqual(["m1"]);
    expect(result.plan.metrics.map((m) => m.key)).toEqual(["money.actual", "ratio.budgetUtilisation"]);
    expect(result.plan.metrics[0].alias).toBe("m0");
  });

  it("refuses a task-completion ratio beside a budget-line measure", () => {
    const result = refused(compileWidget(spec({ metrics: ["lines.approved", "ratio.taskCompletion"] })));
    expect(result.refusal).toBeTruthy();
  });
});

describe("compileWidget — time", () => {
  it("shifts to IST before truncating, so an Indian date lands in its own month", () => {
    // proposedDate is stored as IST midnight = 18:30 UTC the day before, so truncating the raw
    // column would file 1 October under September.
    const result = ok(compileWidget(spec({ metrics: ["events.count"], grain: "month", view: "line" })));
    expect(result.sql.text).toContain("INTERVAL '5 hours 30 minutes'");
    expect(result.sql.text).toContain("date_trunc('month'");
    expect(result.sql.text).toContain("'YYYY-MM'");
  });

  it("anchors the financial year to April", () => {
    const result = ok(compileWidget(spec({ metrics: ["events.count"], grain: "fy", view: "bar" })));
    expect(result.sql.text).toContain("INTERVAL '3 months'");
  });

  it("excludes undated events from a time series rather than bucketing them as null", () => {
    const result = ok(compileWidget(spec({ metrics: ["events.count"], grain: "month", view: "line" })));
    expect(result.sql.text).toContain('e."proposedDate" IS NOT NULL');
  });

  it("ignores a grain on a widget that has nowhere to put one", () => {
    for (const view of ["kpi", "donut", "gauge"] as const) {
      const result = ok(compileWidget(spec({ metrics: ["events.count"], grain: "month", view })));
      expect(result.plan.grain).toBe("none");
      expect(result.warnings.some((w) => w.field === "grain")).toBe(true);
    }
  });

  it("orders a trend chronologically whatever the saved sort says", () => {
    const result = ok(
      compileWidget(
        spec({ metrics: ["events.count"], grain: "month", view: "line", sort: { by: "metric", dir: "desc" } }),
      ),
    );
    expect(result.sql.text).toMatch(/ORDER BY \d+ ASC NULLS LAST/);
  });

  it("binds a resolved period as real dates", () => {
    const now = new Date("2026-10-15T06:00:00Z");
    const result = ok(compileWidget(spec({ metrics: ["events.count"], range: "fy" }), now));
    expect(result.sql.values.filter((v) => v instanceof Date)).toHaveLength(2);
  });

  it("falls back to all time when custom dates are incomplete, and says so", () => {
    const result = ok(compileWidget(spec({ metrics: ["events.count"], range: "custom", from: "2026-04-01" })));
    expect(result.sql.text).not.toContain("WHERE");
    expect(result.warnings.some((w) => w.field === "range")).toBe(true);
  });

  it("falls back to the proposed date when the saved date field is gone", () => {
    const result = ok(compileWidget(spec({ metrics: ["events.count"], timeField: "event.retiredField" })));
    expect(result.warnings.some((w) => w.field === "timeField")).toBe(true);
    expect(result.ok).toBe(true);
  });
});

describe("compileWidget — money access", () => {
  it("refuses a money measure when the viewer's role may not see money", () => {
    const result = refused(compileWidget(spec({ metrics: ["lines.approved"] }), { allowMoney: false }));
    expect(result.refusal).toContain("Approved cost");
    expect(result.refusal).toContain("cannot see");
  });

  it("refuses a ratio that is built out of money", () => {
    const result = refused(
      compileWidget(spec({ metrics: ["ratio.budgetUtilisation"] }), { allowMoney: false }),
    );
    expect(result.refusal).toContain("Budget utilisation");
  });

  it("still allows counts and non-money measures", () => {
    const result = ok(
      compileWidget(spec({ metrics: ["events.count", "outcome.leads"] }), { allowMoney: false }),
    );
    expect(result.plan.metrics.map((m) => m.key)).toEqual(["events.count", "outcome.leads"]);
  });

  it("allows money by default, so a server caller must opt out deliberately", () => {
    expect(compileWidget(spec({ metrics: ["lines.approved"] })).ok).toBe(true);
  });
});

describe("compileWidget — grouping and degradation", () => {
  it("labels a null group readably, as a bound parameter", () => {
    const result = ok(compileWidget(spec({ metrics: ["events.count"], dimension: "event.partner" })));
    expect(result.sql.text).toContain("COALESCE");
    expect(result.sql.values).toContain("Run without a partner");
    expect(result.sql.text).toContain('AS "dim_is_null"');
  });

  it("still compiles when a saved grouping has been retired", () => {
    const result = ok(compileWidget(spec({ metrics: ["events.count"], dimension: "event.goneAway" })));
    expect(result.plan.dimension).toBeNull();
    expect(result.sql.text).not.toContain("GROUP BY");
    expect(result.warnings).toHaveLength(1);
  });

  it("groups by every label column so Postgres accepts the aggregate", () => {
    const result = ok(
      compileWidget(spec({ metrics: ["events.count"], dimension: "event.department", series: "event.region" })),
    );
    // dim, dim_is_null, series, series_is_null — four grouped columns.
    expect(result.sql.text).toMatch(/GROUP BY 1, 2, 3, 4/);
  });

  it("bounds the row limit at both layers", () => {
    // A saved limit outside the allowed range is not clamped to the maximum — it degrades to
    // the default, like every other field, because 9999 is more likely corruption than intent.
    expect(ok(compileWidget(spec({ metrics: ["events.count"], limit: 9999 }))).plan.limit).toBe(50);
    expect(ok(compileWidget(spec({ metrics: ["events.count"], limit: 200 }))).plan.limit).toBe(200);
    // The compiler still caps a spec built by hand rather than parsed, so the cap holds even if
    // a caller skips the schema.
    const unparsed = { ...spec({ metrics: ["events.count"] }), limit: 100_000 };
    expect(ok(compileWidget(unparsed)).plan.limit).toBe(500);
  });

  it("keeps a corrupt spec alive instead of throwing", () => {
    for (const junk of [null, 42, "nonsense", [], { metrics: "not-an-array" }]) {
      expect(() => compileWidget(parseWidgetSpec(junk))).not.toThrow();
    }
    // The default spec counts events, which is always answerable.
    expect(compileWidget(parseWidgetSpec(null)).ok).toBe(true);
  });
});
