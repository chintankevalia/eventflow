import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { DEFAULT_ACCESS_POLICY, type Viewer } from "@/server/access/policy";
import { grainLabel, runWidget, runWidgets, type WidgetResult } from "./run";
import { parseWidgetSpec, type WidgetSpec } from "./spec";

const spec = (patch: Partial<WidgetSpec> = {}): WidgetSpec => parseWidgetSpec({ ...patch });
const admin: Viewer = { id: "user-1", roles: ["ADMIN"], department: null };

/** Enough of the client to run a read. Records the statements it was asked for. */
function stubDb(rows: Record<string, unknown>[], options: { fail?: string } = {}) {
  const statements: string[] = [];
  const db = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: async (sql: Prisma.Sql) => {
          statements.push(sql.text);
          return 0;
        },
        $queryRaw: async (sql: Prisma.Sql) => {
          statements.push(sql.text);
          if (options.fail) throw new Error(options.fail);
          return rows;
        },
      }),
  } as unknown as PrismaClient;
  return { db, statements };
}

function succeeded(result: Awaited<ReturnType<typeof runWidget>>): WidgetResult {
  if (!result.ok) throw new Error(`expected rows, got: ${result.refusal}`);
  return result;
}

describe("runWidget — what comes back from the database", () => {
  it("turns a BigInt count into a plain number", async () => {
    // COUNT() is int8, which arrives as BigInt and throws on JSON.stringify — it can never
    // reach a client component.
    const { db } = stubDb([{ dim: "Channel", dim_is_null: false, m0: BigInt(42) }]);
    const result = succeeded(await runWidget(db, spec({ metrics: ["events.count"], dimension: "event.department" }), admin, DEFAULT_ACCESS_POLICY));
    expect(result.rows[0].values["events.count"]).toBe(42);
    expect(typeof result.rows[0].values["events.count"]).toBe("number");
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("turns a Decimal into a number without losing the paise", async () => {
    const { db } = stubDb([{ m0: new Prisma.Decimal("18804888.60") }]);
    const result = succeeded(await runWidget(db, spec({ metrics: ["money.estimated"] }), admin, DEFAULT_ACCESS_POLICY));
    expect(result.rows[0].values["money.estimated"]).toBe(18804888.6);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("reads zero rupees as zero but an unknown average as unknown", async () => {
    // A SUM over no rows is SQL NULL. Spending nothing is a fact; the mean of no decisions is
    // not zero hours, it is unknown, and a chart must be able to tell the difference.
    const { db } = stubDb([{ m0: null, m1: null, m2: null }]);
    const result = succeeded(
      await runWidget(db, spec({ metrics: ["money.actual", "events.count", "events.avgDuration"] }), admin, DEFAULT_ACCESS_POLICY),
    );
    expect(result.rows[0].values["money.actual"]).toBe(0);
    expect(result.rows[0].values["events.count"]).toBe(0);
    expect(result.rows[0].values["events.avgDuration"]).toBeNull();
  });

  it("passes the readable null-group label and its flag through", async () => {
    const { db } = stubDb([{ dim: "Run without a partner", dim_is_null: true, m0: BigInt(23) }]);
    const result = succeeded(await runWidget(db, spec({ metrics: ["events.count"], dimension: "event.partner" }), admin, DEFAULT_ACCESS_POLICY));
    expect(result.rows[0].dim).toBe("Run without a partner");
    expect(result.rows[0].dimIsNull).toBe(true);
  });

  it("reports truncation when the row cap is reached", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ dim: `c${i}`, dim_is_null: false, m0: BigInt(1) }));
    const { db } = stubDb(rows);
    const result = succeeded(
      await runWidget(db, spec({ metrics: ["events.count"], dimension: "event.city", limit: 10 }), admin, DEFAULT_ACCESS_POLICY),
    );
    expect(result.truncated).toBe(true);
  });
});

describe("runWidget — readable labels", () => {
  it("writes an enum the way the rest of the portal writes it", async () => {
    const { db } = stubDb([
      { dim: "CHANNEL", dim_is_null: false, m0: BigInt(10) },
      { dim: "MARKETING", dim_is_null: false, m0: BigInt(4) },
    ]);
    const result = succeeded(
      await runWidget(db, spec({ metrics: ["events.count"], dimension: "event.department" }), admin, DEFAULT_ACCESS_POLICY),
    );
    expect(result.rows.map((r) => r.dim)).toEqual(["Channel", "Marketing"]);
  });

  it("uses the lifecycle badge's own wording", async () => {
    const { db } = stubDb([
      { dim: "IN_EXECUTION", dim_is_null: false, m0: BigInt(1) },
      { dim: "PENDING_APPROVAL", dim_is_null: false, m0: BigInt(1) },
    ]);
    const result = succeeded(
      await runWidget(db, spec({ metrics: ["events.count"], dimension: "event.lifecycle" }), admin, DEFAULT_ACCESS_POLICY),
    );
    // Whatever these read as, they must read the same here as on an event's badge.
    expect(result.rows.map((r) => r.dim)).not.toContain("IN_EXECUTION");
    expect(result.rows.every((r) => r.dim && !r.dim.includes("_"))).toBe(true);
  });

  it("sentence-cases an enum that has no map of its own", async () => {
    const { db } = stubDb([{ dim: "NOT_RAISED", dim_is_null: false, m0: BigInt(2) }]);
    const result = succeeded(
      await runWidget(db, spec({ metrics: ["lines.count"], dimension: "cost.invoiceStatus" }), admin, DEFAULT_ACCESS_POLICY),
    );
    expect(result.rows[0].dim).toBe("Not raised");
  });

  it("leaves the null sentinel alone, which is already readable", async () => {
    const { db } = stubDb([{ dim: "No department", dim_is_null: true, m0: BigInt(3) }]);
    const result = succeeded(
      await runWidget(db, spec({ metrics: ["events.count"], dimension: "event.department" }), admin, DEFAULT_ACCESS_POLICY),
    );
    expect(result.rows[0].dim).toBe("No department");
  });

  it("leaves a name alone — only enums are relabelled", async () => {
    const { db } = stubDb([{ dim: "Rah Infotech", dim_is_null: false, m0: BigInt(5) }]);
    const result = succeeded(
      await runWidget(db, spec({ metrics: ["events.count"], dimension: "event.partner" }), admin, DEFAULT_ACCESS_POLICY),
    );
    expect(result.rows[0].dim).toBe("Rah Infotech");
  });
});

describe("runWidget — ratios", () => {
  it("divides in TypeScript and scales a percentage", async () => {
    const { db } = stubDb([{ m0: new Prisma.Decimal("50"), m1: new Prisma.Decimal("200") }]);
    const result = succeeded(await runWidget(db, spec({ metrics: ["ratio.budgetUtilisation"] }), admin, DEFAULT_ACCESS_POLICY));
    expect(result.rows[0].values["ratio.budgetUtilisation"]).toBe(25);
  });

  it("calls a ratio unknown rather than zero when there is nothing to divide by", async () => {
    // Zero utilisation would read as "spent nothing of a real budget"; the truth is that there
    // is no budget to compare against.
    const { db } = stubDb([{ m0: new Prisma.Decimal("50"), m1: new Prisma.Decimal("0") }]);
    const result = succeeded(await runWidget(db, spec({ metrics: ["ratio.budgetUtilisation"] }), admin, DEFAULT_ACCESS_POLICY));
    expect(result.rows[0].values["ratio.budgetUtilisation"]).toBeNull();

    const nulled = stubDb([{ m0: new Prisma.Decimal("50"), m1: null }]);
    const second = succeeded(await runWidget(nulled.db, spec({ metrics: ["ratio.budgetUtilisation"] }), admin, DEFAULT_ACCESS_POLICY));
    expect(second.rows[0].values["ratio.budgetUtilisation"]).toBeNull();
  });

  it("does not expose the hidden parts of a ratio as values of their own", async () => {
    const { db } = stubDb([{ m0: BigInt(3), m1: BigInt(4) }]);
    const result = succeeded(await runWidget(db, spec({ metrics: ["ratio.taskCompletion"] }), admin, DEFAULT_ACCESS_POLICY));
    expect(Object.keys(result.rows[0].values)).toEqual(["ratio.taskCompletion"]);
    expect(result.rows[0].values["ratio.taskCompletion"]).toBe(75);
  });
});

describe("runWidget — time buckets", () => {
  it("fills the months the database had no row for", async () => {
    const { db } = stubDb([
      { grain: "2026-01", m0: BigInt(2) },
      { grain: "2026-04", m0: BigInt(5) },
    ]);
    const result = succeeded(
      await runWidget(db, spec({ metrics: ["events.count"], grain: "month", view: "line" }), admin, DEFAULT_ACCESS_POLICY),
    );
    expect(result.rows.map((r) => r.grain)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    // A gap is zero events, not a straight line drawn between January and April.
    expect(result.rows.map((r) => r.values["events.count"])).toEqual([2, 0, 0, 5]);
  });

  it("rolls the year over when filling", async () => {
    const { db } = stubDb([
      { grain: "2025-11", m0: BigInt(1) },
      { grain: "2026-02", m0: BigInt(1) },
    ]);
    const result = succeeded(
      await runWidget(db, spec({ metrics: ["events.count"], grain: "month", view: "line" }), admin, DEFAULT_ACCESS_POLICY),
    );
    expect(result.rows.map((r) => r.grain)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("fills quarters and financial years too", async () => {
    const quarters = stubDb([
      { grain: "2025-Q3", m0: BigInt(1) },
      { grain: "2026-Q2", m0: BigInt(1) },
    ]);
    const q = succeeded(
      await runWidget(quarters.db, spec({ metrics: ["events.count"], grain: "quarter", view: "line" }), admin, DEFAULT_ACCESS_POLICY),
    );
    expect(q.rows.map((r) => r.grain)).toEqual(["2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2"]);

    const years = stubDb([
      { grain: "2024", m0: BigInt(1) },
      { grain: "2026", m0: BigInt(1) },
    ]);
    const fy = succeeded(await runWidget(years.db, spec({ metrics: ["events.count"], grain: "fy", view: "line" }), admin, DEFAULT_ACCESS_POLICY));
    expect(fy.rows.map((r) => r.grain)).toEqual(["2024", "2025", "2026"]);
  });

  it("leaves a grouped series alone, because a gap there is per group", async () => {
    const { db } = stubDb([
      { dim: "Channel", dim_is_null: false, grain: "2026-01", m0: BigInt(1) },
      { dim: "Channel", dim_is_null: false, grain: "2026-04", m0: BigInt(1) },
    ]);
    const result = succeeded(
      await runWidget(
        db,
        spec({ metrics: ["events.count"], dimension: "event.department", grain: "month", view: "line" }),
        admin,
        DEFAULT_ACCESS_POLICY,
      ),
    );
    expect(result.rows).toHaveLength(2);
  });
});

describe("grainLabel", () => {
  it("reads each grain the way an Indian reader expects", () => {
    expect(grainLabel("month", "2026-10")).toBe("Oct 26");
    expect(grainLabel("quarter", "2026-Q3")).toBe("Q3 26");
    expect(grainLabel("week", "2026-W42")).toBe("W42 26");
    expect(grainLabel("day", "2026-10-15")).toBe("15 Oct 26");
    // The key is the April the year starts in, so 2026 is the 2026-27 financial year.
    expect(grainLabel("fy", "2026")).toBe("FY 2026-27");
    expect(grainLabel("fy", "2099")).toBe("FY 2099-00");
  });

  it("hands back anything it cannot read rather than showing Invalid Date", () => {
    expect(grainLabel("month", "rubbish")).toBe("rubbish");
    expect(grainLabel("day", "not-a-day")).toBe("not-a-day");
  });
});

describe("runWidget — failure", () => {
  it("sets a statement timeout before running", async () => {
    const { db, statements } = stubDb([]);
    await runWidget(db, spec({ metrics: ["events.count"] }), admin, DEFAULT_ACCESS_POLICY);
    expect(statements[0]).toContain("statement_timeout");
  });

  it("says a timeout is a timeout, so the reader knows to narrow it", async () => {
    const { db } = stubDb([], { fail: "canceling statement due to statement timeout" });
    const result = await runWidget(db, spec({ metrics: ["events.count"] }), admin, DEFAULT_ACCESS_POLICY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toContain("took too long");
  });

  it("never throws, whatever the database does", async () => {
    const { db } = stubDb([], { fail: 'relation "nope" does not exist' });
    const result = await runWidget(db, spec({ metrics: ["events.count"] }), admin, DEFAULT_ACCESS_POLICY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toBe("This widget could not be loaded.");
  });

  it("returns the compiler's refusal without touching the database", async () => {
    const { db, statements } = stubDb([]);
    const result = await runWidget(db, spec({ metrics: ["lines.approved"], dimension: "task.status" }), admin, DEFAULT_ACCESS_POLICY);
    expect(result.ok).toBe(false);
    expect(statements).toEqual([]);
  });
});

describe("runWidgets", () => {
  it("keeps results in the order the widgets were given", async () => {
    const { db } = stubDb([{ m0: BigInt(1) }]);
    const specs = [
      spec({ metrics: ["events.count"] }),
      spec({ metrics: ["lines.approved"], dimension: "task.status" }), // refused
      spec({ metrics: ["events.closed"] }),
    ];
    const results = await runWidgets(db, specs, admin, DEFAULT_ACCESS_POLICY);
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
  });

  it("runs every widget even when more are queued than may run at once", async () => {
    const { db } = stubDb([{ m0: BigInt(7) }]);
    const specs = Array.from({ length: 9 }, () => spec({ metrics: ["events.count"] }));
    const results = await runWidgets(db, specs, admin, DEFAULT_ACCESS_POLICY, { concurrency: 2 });
    expect(results).toHaveLength(9);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
