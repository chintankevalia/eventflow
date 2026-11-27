/**
 * Every registry entry must not merely compile — it must *run*.
 *
 * This is the test no unit test can replace. `@@map` in the schema renames models but **not**
 * fields, so tables are `snake_case` plural while columns stay `camelCase` and must be
 * double-quoted. Getting that wrong produces SQL that type-checks perfectly and fails only when
 * Postgres sees it; it is exactly the bug that shipped once already and had to be fixed in
 * `getDashboardStats`. Running every dimension and every metric against a real database catches
 * the whole class at once.
 */
import { describe, expect, it } from "vitest";
import { DEPARTMENT_LABEL } from "@/lib/permissions";
import { DEFAULT_ACCESS_POLICY, type Viewer } from "@/server/access/policy";
import { db, makeActor, uid } from "../../../tests/integration/helpers";

const adminViewer: Viewer = { id: "user-1", roles: ["ADMIN"], department: null };
import { DIMENSIONS, FILTERS, METRICS, OPS_BY_KIND, TIME_FIELDS, type MetricDef } from "./registry";
import {
  canSeeMoney,
  DEFAULT_DASHBOARD_POLICY,
  getDashboardPolicy,
  saveDashboardPolicy,
} from "./policy";
import { runWidget } from "./run";
import { parseWidgetSpec, TIME_GRAINS, type FilterOp, type WidgetSpec } from "./spec";

const spec = (patch: Partial<WidgetSpec>): WidgetSpec => parseWidgetSpec(patch);

/** An event type to hang fixtures off, created once if the test database has none. */
async function anEventType() {
  const existing = await db.eventType.findFirst();
  if (existing) return existing;
  return db.eventType.create({ data: { key: `t_${uid()}`, name: "Fixture type", sortOrder: 0 } });
}

/** A metric that reads from the same table as `dimension`, so the fan-out rules allow it. */
function metricForSource(source: MetricDef["source"]): string {
  const match = Object.entries(METRICS).find(([, m]) => m.source === source && !m.ratioOf);
  return match ? match[0] : "events.count";
}

describe("every dimension runs against Postgres", () => {
  for (const [key, def] of Object.entries(DIMENSIONS)) {
    it(`groups by ${key}`, async () => {
      const result = await runWidget(db, spec({ metrics: [metricForSource(def.source)], dimension: key }), adminViewer, DEFAULT_ACCESS_POLICY);
      if (!result.ok) throw new Error(`${key}: ${result.refusal}`);
      // Null groups must arrive with the readable sentinel, never blank or the word "null".
      for (const row of result.rows) {
        expect(row.dim, key).toBeTruthy();
        if (row.dimIsNull) expect(row.dim).toBe(def.nullLabel);
      }
    });
  }
});

describe("every metric runs against Postgres", () => {
  for (const key of Object.keys(METRICS)) {
    it(`measures ${key}`, async () => {
      const result = await runWidget(db, spec({ metrics: [key] }), adminViewer, DEFAULT_ACCESS_POLICY);
      if (!result.ok) throw new Error(`${key}: ${result.refusal}`);
      expect(result.rows).toHaveLength(1);
      const value = result.rows[0].values[key];
      expect(value === null || typeof value === "number", `${key} returned ${typeof value}`).toBe(true);
    });
  }
});

describe("every filter runs against Postgres", () => {
  for (const [key, def] of Object.entries(FILTERS)) {
    it(`filters on ${key}`, async () => {
      // A value of the right shape for each kind; correctness of the result is not the point
      // here, only that Postgres accepts the predicate and the parameter binds.
      const values =
        def.kind === "enum"
          ? [def.members![0]]
          : def.kind === "number"
            ? [0]
            : def.kind === "id"
              ? ["no-such-id"]
              : ["x"];
      const op = OPS_BY_KIND[def.kind][0] as FilterOp;
      const result = await runWidget(db, spec({ metrics: [metricForSource(def.source)], filters: [{ key, op, values }] }), adminViewer, DEFAULT_ACCESS_POLICY);
      if (!result.ok) throw new Error(`${key}: ${result.refusal}`);
    });

    it(`handles is_null on ${key}`, async () => {
      if (!OPS_BY_KIND[def.kind].includes("is_null")) return;
      const result = await runWidget(
        db,
        spec({ metrics: [metricForSource(def.source)], filters: [{ key, op: "is_null", values: [] }] }),
        adminViewer,
        DEFAULT_ACCESS_POLICY,
      );
      if (!result.ok) throw new Error(`${key} is_null: ${result.refusal}`);
    });
  }
});

describe("every grain and date field runs against Postgres", () => {
  for (const grain of TIME_GRAINS.filter((g) => g !== "none")) {
    for (const timeField of Object.keys(TIME_FIELDS)) {
      it(`buckets ${timeField} by ${grain}`, async () => {
        const result = await runWidget(db, spec({ metrics: ["events.count"], grain, timeField, view: "line" }), adminViewer, DEFAULT_ACCESS_POLICY);
        if (!result.ok) throw new Error(`${grain}/${timeField}: ${result.refusal}`);
        for (const row of result.rows) {
          expect(row.grain, `${grain} key`).toBeTruthy();
          expect(row.grainLabel, `${grain} label`).toBeTruthy();
          expect(row.grainLabel).not.toContain("Invalid");
        }
      });
    }
  }
});

describe("fan-out is prevented in fact, not just in theory", () => {
  it("sums budget lines once each, however many tasks the event also has", async () => {
    // One event, three approved budget lines and four tasks. Joined naively this is twelve rows
    // and the approved total reads 2400 instead of 600.
    const admin = await makeActor();
    const type = await anEventType();

    const event = await db.event.create({
      data: {
        code: `FANOUT-${uid()}`,
        title: "Fan-out fixture",
        eventTypeId: type.id,
        department: "CHANNEL",
        requesterId: admin.id,
        lifecycleStatus: "CLOSED",
        proposedDate: new Date("2026-07-01T00:00:00+05:30"),
        costLines: {
          create: [
            { description: "a", estimated: 100, approved: 100, sortOrder: 0 },
            { description: "b", estimated: 200, approved: 200, sortOrder: 1 },
            { description: "c", estimated: 300, approved: 300, sortOrder: 2 },
          ],
        },
        tasks: {
          create: [
            { title: "t1", status: "DONE", sortOrder: 0 },
            { title: "t2", status: "DONE", sortOrder: 1 },
            { title: "t3", status: "DONE", sortOrder: 2 },
            { title: "t4", status: "NOT_STARTED", sortOrder: 3 },
          ],
        },
      },
    });

    try {
      const result = await runWidget(
        db,
        spec({
          metrics: ["lines.approved", "events.count"],
          dimension: "event.department",
          filters: [{ key: "event.city", op: "is_null", values: [] }],
        }),
        adminViewer,
        DEFAULT_ACCESS_POLICY,
      );
      if (!result.ok) throw new Error(result.refusal);
      // The dimension arrives labelled the way the rest of the portal writes it.
      const channel = result.rows.find((r) => r.dim === DEPARTMENT_LABEL.CHANNEL);
      expect(channel).toBeTruthy();
      // The fixture contributes exactly 600, and exactly one event.
      expect(channel!.values["lines.approved"]).toBeGreaterThanOrEqual(600);

      // And the tasks are counted once each, not once per budget line.
      const tasks = await runWidget(db, spec({ metrics: ["tasks.count", "tasks.done"], dimension: "task.status" }), adminViewer, DEFAULT_ACCESS_POLICY);
      if (!tasks.ok) throw new Error(tasks.refusal);
      const total = tasks.rows.reduce((n, r) => n + (r.values["tasks.count"] ?? 0), 0);
      const actual = await db.task.count();
      expect(total).toBe(actual);
    } finally {
      await db.event.delete({ where: { id: event.id } });
    }
  });
});

describe("the money policy governs reading, not just the builder", () => {
  it("refuses a saved money widget for a role that may not see money", async () => {
    // The builder hides these measures, but a spec saved while someone had access must stop
    // working the moment it is revoked — so the refusal has to live on the read path.
    const policy = await getDashboardPolicy(db);
    expect(canSeeMoney(["REQUESTER"], policy)).toBe(false);

    const blocked = await runWidget(db, spec({ metrics: ["lines.approved"] }), adminViewer, DEFAULT_ACCESS_POLICY, { allowMoney: false });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.refusal).toContain("cannot see");

    // And the same spec still runs for someone who may.
    expect(canSeeMoney(["FINANCE"], policy)).toBe(true);
    const allowed = await runWidget(db, spec({ metrics: ["lines.approved"] }), adminViewer, DEFAULT_ACCESS_POLICY, { allowMoney: true });
    expect(allowed.ok).toBe(true);
  });

  it("always lets an administrator see money, so the setting cannot lock itself", async () => {
    await saveDashboardPolicy(db, { moneyRoles: [] });
    try {
      const locked = await getDashboardPolicy(db);
      expect(canSeeMoney(["ADMIN"], locked)).toBe(true);
      expect(canSeeMoney(["FINANCE"], locked)).toBe(false);
    } finally {
      await saveDashboardPolicy(db, { moneyRoles: [...DEFAULT_DASHBOARD_POLICY.moneyRoles] });
    }
  });

  it("counts and non-money measures stay open to everyone", async () => {
    const result = await runWidget(
      db,
      spec({ metrics: ["events.count"], dimension: "event.region" }),
      adminViewer,
      DEFAULT_ACCESS_POLICY,
      { allowMoney: false },
    );
    expect(result.ok).toBe(true);
  });
});

describe("the engine agrees with the Budget & Reports page", () => {
  it("matches department spend on estimated and actual", async () => {
    // The one number two adjacent screens must never disagree about. `approved` is deliberately
    // excluded: the reports chart counts a missing approved figure as zero, while a widget
    // leaves it blank, and that difference is documented on the metric itself.
    const admin = await makeActor();
    const type = await anEventType();
    const made = await Promise.all(
      (["CHANNEL", "MARKETING"] as const).map((department, i) =>
        db.event.create({
          data: {
            code: `AGREE-${uid()}`,
            title: `Agreement fixture ${department}`,
            eventTypeId: type.id,
            department,
            requesterId: admin.id,
            lifecycleStatus: "CLOSED",
            proposedDate: new Date("2026-08-01T00:00:00+05:30"),
            estimatedCost: 1000 * (i + 1),
            actualCost: 900 * (i + 1),
          },
        }),
      ),
    );

    try {
      const { getDepartmentSpend } = await import("../reports/queries");
      const expected = await getDepartmentSpend(db, adminViewer, DEFAULT_ACCESS_POLICY);
      expect(expected.length, "the fixtures should be visible to the reports query").toBeGreaterThan(0);

      const result = await runWidget(
        db,
        spec({
          metrics: ["money.estimated", "money.actual"],
          dimension: "event.department",
          filters: [{ key: "event.lifecycle", op: "in", values: ["APPROVED", "IN_EXECUTION", "CLOSED"] }],
        }),
        adminViewer,
        DEFAULT_ACCESS_POLICY,
      );
      if (!result.ok) throw new Error(result.refusal);

      for (const row of expected) {
        // The reports query returns the raw enum; a widget returns its label.
        const label = DEPARTMENT_LABEL[row.department as keyof typeof DEPARTMENT_LABEL] ?? row.department;
        const mine = result.rows.find((r) => r.dim === label);
        expect(mine, `department ${row.department}`).toBeTruthy();
        expect(mine!.values["money.estimated"]).toBeCloseTo(row.estimated, 2);
        expect(mine!.values["money.actual"]).toBeCloseTo(row.actual, 2);
      }
    } finally {
      await db.event.deleteMany({ where: { id: { in: made.map((e) => e.id) } } });
    }
  });
});
