import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { startOfIstDay } from "@/lib/date-range";
import { DEFAULT_ACCESS_POLICY, type Viewer } from "@/server/access/policy";
import { getApprovalTurnaround, getMonthlySpend } from "./queries";

const admin: Viewer = { id: "user-1", roles: ["ADMIN"], department: null };

/** Serves a fixed set of events and records the `where` it was asked for. */
function stubDb(events: { proposedDate: Date | null; estimatedCost: number; actualCost: number }[]) {
  const calls: Record<string, unknown>[] = [];
  const db = {
    event: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push(args);
        return events;
      },
    },
  } as unknown as PrismaClient;
  return { db, calls };
}

const event = (isoDay: string, estimated = 100, actual = 0) => ({
  proposedDate: startOfIstDay(isoDay),
  estimatedCost: estimated,
  actualCost: actual,
});

describe("getMonthlySpend", () => {
  it("returns one bucket per month, oldest first, with the current month at the end of `back`", async () => {
    const { db } = stubDb([]);
    const series = await getMonthlySpend(db, admin, DEFAULT_ACCESS_POLICY, {
      back: 6,
      ahead: 6,
      now: new Date("2026-10-15T12:00:00+05:30"),
    });

    expect(series).toHaveLength(12);
    expect(series[0].month).toBe("2026-05");
    // `back` counts the current month, so October is the sixth bar, not the
    // seventh — this is the assertion that pins that convention down.
    expect(series[5].month).toBe("2026-10");
    expect(series[11].month).toBe("2027-04");
    // Every month is present even with no events behind it, so the chart keeps
    // an even x axis instead of closing the gaps.
    expect(series.every((m) => m.estimated === 0 && m.eventCount === 0)).toBe(true);
  });

  it("charts an event planned for a future month, which is the point of looking ahead", async () => {
    // A budget is approved before its event happens. A trailing window would
    // report ₹0 here while the department card showed ₹2.5 L.
    const { db } = stubDb([event("2026-12-05", 250_000, 0)]);
    const series = await getMonthlySpend(db, admin, DEFAULT_ACCESS_POLICY, {
      back: 6,
      ahead: 6,
      now: new Date("2026-10-15T12:00:00+05:30"),
    });

    expect(series.find((m) => m.month === "2026-12")).toEqual({
      month: "2026-12",
      estimated: 250_000,
      actual: 0,
      eventCount: 1,
    });
  });

  it("asks the database for events from the first day of the oldest month, India time", async () => {
    const { db, calls } = stubDb([]);
    await getMonthlySpend(db, admin, DEFAULT_ACCESS_POLICY, { back: 6, ahead: 0, now: new Date("2026-10-15T12:00:00+05:30") });

    const where = calls[0].where as { proposedDate: { gte: Date } };
    expect(where.proposedDate.gte.toISOString()).toBe(startOfIstDay("2026-05-01").toISOString());
  });

  it("bounds the window above at the month after the last bar", async () => {
    const { db, calls } = stubDb([]);
    await getMonthlySpend(db, admin, DEFAULT_ACCESS_POLICY, { back: 6, ahead: 6, now: new Date("2026-10-15T12:00:00+05:30") });
    // April 2027 is the last bar, so the cut is the first instant of May.
    await getMonthlySpend(db, admin, DEFAULT_ACCESS_POLICY, { back: 1, ahead: 1, now: new Date("2026-12-20T12:00:00+05:30") });

    const first = calls[0].where as { proposedDate: { lt: Date } };
    expect(first.proposedDate.lt.toISOString()).toBe(startOfIstDay("2027-05-01").toISOString());
    // January 2027 is the last bar here, so the cut rolls the year over.
    const second = calls[1].where as { proposedDate: { lt: Date } };
    expect(second.proposedDate.lt.toISOString()).toBe(startOfIstDay("2027-02-01").toISOString());
  });

  it("scopes to the given departments and leaves the filter off when there are none", async () => {
    const { db, calls } = stubDb([]);
    await getMonthlySpend(db, admin, DEFAULT_ACCESS_POLICY, { departments: ["MARKETING", "CHANNEL"] });
    await getMonthlySpend(db, admin, DEFAULT_ACCESS_POLICY, { departments: [] });

    expect((calls[0].where as { department?: unknown }).department).toEqual({
      in: ["MARKETING", "CHANNEL"],
    });
    expect((calls[1].where as { department?: unknown }).department).toBeUndefined();
  });

  it("files an event proposed for the 1st under that month, not the one before", async () => {
    // 1-Oct-2026 IST is 30-Sep-2026 18:30 UTC. Bucketing on the UTC month would
    // charge this event to September.
    const { db } = stubDb([event("2026-10-01", 50_000, 10_000)]);
    const series = await getMonthlySpend(db, admin, DEFAULT_ACCESS_POLICY, {
      back: 3,
      ahead: 0,
      now: new Date("2026-10-15T12:00:00+05:30"),
    });

    const october = series.find((m) => m.month === "2026-10");
    const september = series.find((m) => m.month === "2026-09");
    expect(october).toEqual({ month: "2026-10", estimated: 50_000, actual: 10_000, eventCount: 1 });
    expect(september?.estimated).toBe(0);
  });

  it("sums several events in the same month", async () => {
    const { db } = stubDb([event("2026-10-02", 1_000, 100), event("2026-10-28", 2_500, 400)]);
    const series = await getMonthlySpend(db, admin, DEFAULT_ACCESS_POLICY, {
      back: 2,
      ahead: 0,
      now: new Date("2026-10-15T12:00:00+05:30"),
    });

    expect(series[1]).toEqual({ month: "2026-10", estimated: 3_500, actual: 500, eventCount: 2 });
  });

  it("rolls the year back when the window reaches behind January", async () => {
    const { db } = stubDb([]);
    const series = await getMonthlySpend(db, admin, DEFAULT_ACCESS_POLICY, {
      back: 4,
      ahead: 0,
      now: new Date("2027-02-03T09:00:00+05:30"),
    });

    expect(series.map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("rolls the year forward when the window reaches past December", async () => {
    const { db } = stubDb([]);
    const series = await getMonthlySpend(db, admin, DEFAULT_ACCESS_POLICY, {
      back: 2,
      ahead: 3,
      now: new Date("2026-11-15T09:00:00+05:30"),
    });

    expect(series.map((m) => m.month)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("skips events with no proposed date rather than counting them twice", async () => {
    const { db } = stubDb([{ proposedDate: null, estimatedCost: 9_999, actualCost: 9_999 }]);
    const series = await getMonthlySpend(db, admin, DEFAULT_ACCESS_POLICY, { now: new Date("2026-10-15T12:00:00+05:30") });

    expect(series.reduce((sum, m) => sum + m.estimated, 0)).toBe(0);
  });
});

/** Serves a fixed set of approval rounds, ignoring the `where` it is given. */
function stubRounds(
  rounds: { submittedAt: string; decisions: { at: string; stage: string; seq: number }[] }[],
) {
  return {
    approvalRound: {
      findMany: async () =>
        rounds.map((r) => ({
          submittedAt: new Date(r.submittedAt),
          decisions: r.decisions.map((d) => ({
            decidedAt: new Date(d.at),
            stage: { name: d.stage, sequence: d.seq },
          })),
        })),
    },
  } as unknown as PrismaClient;
}

const STAGE_1 = "Department approval";
const STAGE_2 = "Final approval";

describe("getApprovalTurnaround", () => {
  it("measures the first stage from submission, not from the stage the round ended on", async () => {
    // The regression this guards: `stageEnteredAt` holds the moment stage 2
    // opened by the time the round is approved, so measuring stage 1 against it
    // subtracts a later timestamp from an earlier one.
    const db = stubRounds([
      {
        submittedAt: "2026-09-01T06:00:00Z",
        decisions: [
          { at: "2026-09-01T16:00:00Z", stage: STAGE_1, seq: 1 }, // 10h after submission
          { at: "2026-09-02T06:00:00Z", stage: STAGE_1, seq: 1 }, // 24h after submission
          { at: "2026-09-03T06:00:00Z", stage: STAGE_2, seq: 2 },
        ],
      },
    ]);

    const [stageOne] = await getApprovalTurnaround(db, admin, DEFAULT_ACCESS_POLICY);
    expect(stageOne).toEqual({
      stageName: STAGE_1,
      avgHours: 17,
      minHours: 10,
      maxHours: 24,
      totalDecisions: 2,
    });
  });

  it("starts a later stage's clock when the stage before it finished", async () => {
    // Stage 2 could not act until both stage-1 approvers were done, so its
    // turnaround runs from the *last* stage-1 decision — 24h in, not 0h.
    const db = stubRounds([
      {
        submittedAt: "2026-09-01T06:00:00Z",
        decisions: [
          { at: "2026-09-01T16:00:00Z", stage: STAGE_1, seq: 1 },
          { at: "2026-09-02T06:00:00Z", stage: STAGE_1, seq: 1 },
          { at: "2026-09-03T06:00:00Z", stage: STAGE_2, seq: 2 }, // 24h after stage 1 closed
        ],
      },
    ]);

    const stageTwo = (await getApprovalTurnaround(db, admin, DEFAULT_ACCESS_POLICY)).find((s) => s.stageName === STAGE_2);
    expect(stageTwo).toEqual({
      stageName: STAGE_2,
      avgHours: 24,
      minHours: 24,
      maxHours: 24,
      totalDecisions: 1,
    });
  });

  it("never reports a negative turnaround", async () => {
    const db = stubRounds([
      {
        submittedAt: "2026-09-01T06:00:00Z",
        decisions: [
          { at: "2026-09-04T06:00:00Z", stage: STAGE_1, seq: 1 },
          { at: "2026-09-04T07:00:00Z", stage: STAGE_1, seq: 1 },
          { at: "2026-09-04T08:00:00Z", stage: STAGE_2, seq: 2 },
        ],
      },
    ]);

    for (const stage of await getApprovalTurnaround(db, admin, DEFAULT_ACCESS_POLICY)) {
      expect(stage.minHours).toBeGreaterThanOrEqual(0);
      expect(stage.avgHours).toBeGreaterThanOrEqual(0);
    }
  });

  it("orders stages by sequence and pools decisions across rounds", async () => {
    const db = stubRounds([
      {
        submittedAt: "2026-09-01T06:00:00Z",
        decisions: [{ at: "2026-09-01T12:00:00Z", stage: STAGE_1, seq: 1 }], // 6h
      },
      {
        submittedAt: "2026-09-10T06:00:00Z",
        decisions: [
          { at: "2026-09-10T08:00:00Z", stage: STAGE_1, seq: 1 }, // 2h
          { at: "2026-09-10T18:00:00Z", stage: STAGE_2, seq: 2 }, // 10h
        ],
      },
    ]);

    const series = await getApprovalTurnaround(db, admin, DEFAULT_ACCESS_POLICY);
    expect(series.map((s) => s.stageName)).toEqual([STAGE_1, STAGE_2]);
    expect(series[0]).toMatchObject({ avgHours: 4, minHours: 2, maxHours: 6, totalDecisions: 2 });
  });

  it("counts only decisions inside the range, but still measures them in full", async () => {
    // The stage opened before the window. Clipping the baseline to the window
    // would report a two-hour turnaround for a decision that took three days.
    const range = {
      from: new Date("2026-09-04T00:00:00Z"),
      to: new Date("2026-09-30T00:00:00Z"),
    };
    const db = stubRounds([
      {
        submittedAt: "2026-09-01T06:00:00Z",
        decisions: [
          { at: "2026-09-02T06:00:00Z", stage: STAGE_1, seq: 1 }, // before the window
          { at: "2026-09-04T06:00:00Z", stage: STAGE_1, seq: 1 }, // inside it, 72h in
        ],
      },
    ]);

    const [stageOne] = await getApprovalTurnaround(db, admin, DEFAULT_ACCESS_POLICY, range);
    expect(stageOne).toEqual({
      stageName: STAGE_1,
      avgHours: 72,
      minHours: 72,
      maxHours: 72,
      totalDecisions: 1,
    });
  });
});
