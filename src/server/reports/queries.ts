import "server-only";
import type { Department, Prisma, PrismaClient } from "@prisma/client";
import { istDay, startOfIstDay } from "@/lib/date-range";
import { eventVisibilityWhere, type AccessPolicy, type Viewer } from "@/server/access/policy";
import { db as defaultDb } from "@/server/db";

/**
 * Folded into every report's own `where`, never as a second top-level clause — these queries
 * build their own `AND`/`OR` combinations already, and a sibling `visibility` key would either
 * collide with an existing `OR` or need its own `AND` wrapper at every call site. Omitted
 * entirely (spread as `{}`) when it imposes no restriction, same as the register.
 */
function visibility(viewer: Viewer, policy: AccessPolicy): Prisma.EventWhereInput {
  return eventVisibilityWhere(viewer, policy);
}

export type DateRange = { from: Date; to: Date };

// ─── Dashboard KPIs ──────────────────────────────────────────────────────────

export async function getDashboardStats(db: PrismaClient = defaultDb) {
  const [lifecycleCounts, pendingApprovals, overdueApprovals, upcomingEvents, budgetRows, rejectedCount] =
    await Promise.all([
      db.event.groupBy({ by: ["lifecycleStatus"], _count: { id: true } }),

      db.approvalRound.count({ where: { status: "PENDING" } }),

      db.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count
        FROM approval_rounds r
        JOIN approval_stages s ON s.id = r."currentStageId"
        WHERE r.status = 'PENDING'
          AND r."stageEnteredAt" < NOW() - (s."escalationHours" || ' hours')::INTERVAL
      `,

      db.event.count({
        where: {
          lifecycleStatus: { in: ["APPROVED", "IN_EXECUTION"] },
          proposedDate: { gte: new Date(), lte: new Date(Date.now() + 30 * 86400_000) },
        },
      }),

      db.event.aggregate({
        where: { lifecycleStatus: { in: ["APPROVED", "IN_EXECUTION", "CLOSED"] } },
        _sum: { estimatedCost: true, actualCost: true },
      }),

      db.approvalRound.count({ where: { status: "REJECTED" } }),
    ]);

  const byStatus = Object.fromEntries(lifecycleCounts.map((r) => [r.lifecycleStatus, r._count.id]));
  const totalApproved = Number(budgetRows._sum.estimatedCost ?? 0);
  const totalActual = Number(budgetRows._sum.actualCost ?? 0);

  return {
    totalEvents: lifecycleCounts.reduce((s, r) => s + r._count.id, 0),
    pendingApprovals,
    overdueApprovals: Number((overdueApprovals[0]?.count ?? 0).toString()),
    upcomingEvents,
    rejectedRequests: rejectedCount,
    budgetUtilization: totalApproved > 0 ? Math.round((totalActual / totalApproved) * 100) : null,
    lifecycle: byStatus as Partial<Record<string, number>>,
  };
}

// ─── Department spend ─────────────────────────────────────────────────────────

export type DeptSpend = {
  department: string;
  estimated: number;
  approved: number;
  actual: number;
  variance: number;
  eventCount: number;
};

export async function getDepartmentSpend(
  db: PrismaClient = defaultDb,
  viewer: Viewer,
  policy: AccessPolicy,
  range?: DateRange,
): Promise<DeptSpend[]> {
  const visible = visibility(viewer, policy);
  const rows = await db.event.groupBy({
    by: ["department"],
    where: {
      lifecycleStatus: { in: ["APPROVED", "IN_EXECUTION", "CLOSED"] },
      ...(range ? { proposedDate: { gte: range.from, lte: range.to } } : {}),
      ...visible,
    },
    _sum: { estimatedCost: true, actualCost: true },
    _count: { id: true },
  });

  // Approved cost (locked on approval) — from CostLineItem.approved
  const approvedRows = await db.costLineItem.groupBy({
    by: ["eventId"],
    where: {
      approved: { not: null },
      event: {
        lifecycleStatus: { in: ["APPROVED", "IN_EXECUTION", "CLOSED"] },
        ...(range ? { proposedDate: { gte: range.from, lte: range.to } } : {}),
        ...visible,
      },
    },
    _sum: { approved: true },
  });

  // Map eventId → department for the approved sum
  const eventDeptMap = await db.event.findMany({
    where: { id: { in: approvedRows.map((r) => r.eventId) } },
    select: { id: true, department: true },
  });
  const eventDept = Object.fromEntries(eventDeptMap.map((e) => [e.id, e.department]));
  const approvedByDept: Record<string, number> = {};
  for (const row of approvedRows) {
    const dept = eventDept[row.eventId];
    if (dept) approvedByDept[dept] = (approvedByDept[dept] ?? 0) + Number(row._sum.approved ?? 0);
  }

  return rows.map((r) => {
    const estimated = Number(r._sum.estimatedCost ?? 0);
    const actual = Number(r._sum.actualCost ?? 0);
    const approved = approvedByDept[r.department] ?? 0;
    return {
      department: r.department,
      estimated,
      approved,
      actual,
      variance: actual - approved,
      eventCount: r._count.id,
    };
  });
}

// ─── Budget report ────────────────────────────────────────────────────────────

export type BudgetRow = {
  eventId: string;
  code: string;
  title: string;
  department: string;
  lifecycleStatus: string;
  proposedDate: Date | null;
  estimated: number;
  approved: number | null;
  actual: number;
  variance: number | null;
  motadata: number | null;
  partner: number | null;
  mdf: number | null;
};

export async function getBudgetReport(
  db: PrismaClient = defaultDb,
  viewer: Viewer,
  policy: AccessPolicy,
  range?: DateRange,
  departments?: string[],
): Promise<BudgetRow[]> {
  const events = await db.event.findMany({
    where: {
      lifecycleStatus: { in: ["APPROVED", "IN_EXECUTION", "CLOSED"] },
      ...(range ? { proposedDate: { gte: range.from, lte: range.to } } : {}),
      ...(departments?.length ? { department: { in: departments as Department[] } } : {}),
      ...visibility(viewer, policy),
    },
    select: {
      id: true,
      code: true,
      title: true,
      department: true,
      lifecycleStatus: true,
      proposedDate: true,
      estimatedCost: true,
      actualCost: true,
      motadataContribution: true,
      partnerContribution: true,
      mdfAllocation: true,
      costLines: { select: { approved: true } },
    },
    orderBy: { proposedDate: "asc" },
  });

  return events.map((e) => {
    const approved =
      e.costLines.some((l) => l.approved !== null)
        ? e.costLines.reduce((s, l) => s + Number(l.approved ?? 0), 0)
        : null;
    const actual = Number(e.actualCost);
    return {
      eventId: e.id,
      code: e.code,
      title: e.title,
      department: e.department,
      lifecycleStatus: e.lifecycleStatus,
      proposedDate: e.proposedDate,
      estimated: Number(e.estimatedCost),
      approved,
      actual,
      variance: approved !== null ? actual - approved : null,
      motadata: e.motadataContribution !== null ? Number(e.motadataContribution) : null,
      partner: e.partnerContribution !== null ? Number(e.partnerContribution) : null,
      mdf: e.mdfAllocation !== null ? Number(e.mdfAllocation) : null,
    };
  });
}

// ─── Outcomes (post-event) ────────────────────────────────────────────────────

export type OutcomeRow = {
  eventId: string;
  code: string;
  title: string;
  department: string;
  proposedDate: Date | null;
  actualAttendance: number | null;
  companiesEngaged: number | null;
  newLeads: number | null;
  sqls: number | null;
  opportunities: number | null;
  meetingsConducted: number | null;
  actualRoi: string | null;
};

export async function getOutcomeReport(
  db: PrismaClient = defaultDb,
  viewer: Viewer,
  policy: AccessPolicy,
  range?: DateRange,
  departments?: string[],
): Promise<OutcomeRow[]> {
  const events = await db.event.findMany({
    where: {
      lifecycleStatus: { in: ["IN_EXECUTION", "CLOSED"] },
      postEventResult: { isNot: null },
      ...(range ? { proposedDate: { gte: range.from, lte: range.to } } : {}),
      ...(departments?.length ? { department: { in: departments as Department[] } } : {}),
      ...visibility(viewer, policy),
    },
    select: {
      id: true,
      code: true,
      title: true,
      department: true,
      proposedDate: true,
      postEventResult: true,
    },
    orderBy: { proposedDate: "asc" },
  });

  return events
    .filter((e) => e.postEventResult)
    .map((e) => ({
      eventId: e.id,
      code: e.code,
      title: e.title,
      department: e.department,
      proposedDate: e.proposedDate,
      actualAttendance: e.postEventResult!.actualAttendance,
      companiesEngaged: e.postEventResult!.companiesEngaged,
      newLeads: e.postEventResult!.newLeads,
      sqls: e.postEventResult!.sqls,
      opportunities: e.postEventResult!.opportunities,
      meetingsConducted: e.postEventResult!.meetingsConducted,
      actualRoi: e.postEventResult!.actualRoi,
    }));
}

// ─── Approval turnaround ──────────────────────────────────────────────────────

export type ApprovalTurnaround = {
  stageName: string;
  avgHours: number | null;
  minHours: number | null;
  maxHours: number | null;
  totalDecisions: number;
};

/**
 * How long each stage takes to decide, per stage, in hours.
 *
 * The clock for a decision starts when that approver could first have acted —
 * not when the round last changed stage. `ApprovalRound.stageEnteredAt` is a
 * single column that is overwritten every time the round advances, so by the
 * time a two-stage round is approved it holds the moment stage 2 opened. Measuring
 * a stage-1 decision against it therefore subtracts a *later* timestamp from an
 * earlier one and reports a negative turnaround — on EF-2026-0001 it read −0.0h
 * for both stage-1 approvals, and only looked harmless because that event was
 * approved three minutes after it was submitted. With ordinary day-long gaps the
 * chart reads "Event approval: avg −38h".
 *
 * The real baseline is reconstructed per decision from the round's own history,
 * which needs no extra column: a stage opens when the last approver of an earlier
 * stage signed off, and the first stage opens at submission. That is correct for
 * ALL, ANY and SEQUENTIAL stages alike, because in every mode the next stage
 * cannot open before the previous one finishes.
 *
 * A `range` filters the decisions that are *counted*, not the baselines they are
 * measured from: a decision made inside the window whose stage opened before it
 * still took as long as it took.
 */
export async function getApprovalTurnaround(
  db: PrismaClient = defaultDb,
  viewer: Viewer,
  policy: AccessPolicy,
  range?: DateRange,
): Promise<ApprovalTurnaround[]> {
  // Whole rounds, not bare decisions: a decision's baseline is a sibling decision.
  const rounds = await db.approvalRound.findMany({
    where: {
      decisions: { some: range ? { decidedAt: { gte: range.from, lte: range.to } } : {} },
      event: visibility(viewer, policy),
    },
    select: {
      submittedAt: true,
      decisions: { select: { decidedAt: true, stage: { select: { name: true, sequence: true } } } },
    },
  });

  // Group by stage name and compute average turnaround
  const grouped: Record<string, { name: string; seq: number; hours: number[] }> = {};
  for (const round of rounds) {
    for (const d of round.decisions) {
      if (range && (d.decidedAt < range.from || d.decidedAt > range.to)) continue;
      const key = d.stage.name;
      if (!grouped[key]) grouped[key] = { name: d.stage.name, seq: d.stage.sequence, hours: [] };
      const earlier = round.decisions.filter((o) => o.stage.sequence < d.stage.sequence);
      const openedAt = earlier.length
        ? new Date(Math.max(...earlier.map((o) => o.decidedAt.getTime())))
        : round.submittedAt;
      grouped[key].hours.push((d.decidedAt.getTime() - openedAt.getTime()) / 3_600_000);
    }
  }

  return Object.values(grouped)
    .sort((a, b) => a.seq - b.seq)
    .map((g) => ({
      stageName: g.name,
      avgHours: g.hours.length ? Math.round(g.hours.reduce((s, h) => s + h, 0) / g.hours.length) : null,
      minHours: g.hours.length ? Math.round(Math.min(...g.hours)) : null,
      maxHours: g.hours.length ? Math.round(Math.max(...g.hours)) : null,
      totalDecisions: g.hours.length,
    }));
}

// ─── Monthly series (for chart) ───────────────────────────────────────────────

export type MonthlySeries = { month: string; estimated: number; actual: number; eventCount: number };

/**
 * Spend per month over a window centred on the current month: `back` months up
 * to and including it, then `ahead` months after it.
 *
 * The window looks forward on purpose. A budget is approved *before* its event
 * happens, so an event is approved spend for months before it appears in any
 * trailing window — and `proposedDate` is the date of the event, not of the
 * approval. A trailing twelve months therefore reports ₹0 for a department the
 * card beside it shows ₹2.5 L of approved spend for, which is not a quiet
 * inaccuracy but a direct contradiction on the same screen. Centring it puts
 * money already spent on the left of the chart and money committed on the
 * right, which is the question people actually bring to this page.
 *
 * `back` counts the current month, so `back: 6, ahead: 6` is twelve bars with
 * the current month sixth. `back: 1, ahead: 0` is the current month alone.
 *
 * The months are **Indian** months. A `proposedDate` is stored as midnight IST
 * (see `src/lib/date-range.ts`), so an event proposed for the 1st sits at 18:30
 * UTC on the last day of the month before: bucketing on `toISOString()` would
 * file every first-of-the-month event one month early, and about one event in
 * thirty would be charted under the wrong bar. `istDay` reads the stored
 * instant back the same way the writers wrote it.
 *
 * The window is deliberately fixed rather than taken from a report's period
 * filter — a trend needs the same number of months either side of whatever it
 * is being compared with. `departments` is honoured, because a page scoped to
 * one department should not show another's spend.
 *
 * `now` is a parameter so the month keys can be asserted in a test instead of
 * drifting with the calendar.
 */
export async function getMonthlySpend(
  db: PrismaClient = defaultDb,
  viewer: Viewer,
  policy: AccessPolicy,
  {
    back = 6,
    ahead = 6,
    now = new Date(),
    departments,
  }: { back?: number; ahead?: number; now?: Date; departments?: string[] } = {},
): Promise<MonthlySeries[]> {
  const [year, month] = istDay(now).split("-").map(Number); // month is 1-based

  // Every key the series must have, oldest first, whether or not it has events.
  // `Date.UTC` takes a month index outside 0–11 and rolls the year either way
  // for us, so a window that crosses January — in either direction — needs no
  // special case.
  const keys = Array.from({ length: back + ahead }, (_, i) =>
    new Date(Date.UTC(year, month - back + i, 1)).toISOString().slice(0, 7),
  );
  const from = startOfIstDay(`${keys[0]}-01`);
  // Upper bound too, or every event planned beyond the window is fetched and
  // then thrown away — and in an events portal most of them are in the future.
  const until = startOfIstDay(new Date(Date.UTC(year, month + ahead, 1)).toISOString().slice(0, 10));

  const events = await db.event.findMany({
    where: {
      lifecycleStatus: { in: ["APPROVED", "IN_EXECUTION", "CLOSED"] },
      proposedDate: { gte: from, lt: until },
      ...(departments?.length ? { department: { in: departments as Department[] } } : {}),
      ...visibility(viewer, policy),
    },
    select: { proposedDate: true, estimatedCost: true, actualCost: true },
  });

  const buckets: Record<string, MonthlySeries> = {};
  for (const e of events) {
    if (!e.proposedDate) continue;
    const key = istDay(e.proposedDate).slice(0, 7); // YYYY-MM, in India
    if (!buckets[key]) buckets[key] = { month: key, estimated: 0, actual: 0, eventCount: 0 };
    buckets[key].estimated += Number(e.estimatedCost);
    buckets[key].actual += Number(e.actualCost);
    buckets[key].eventCount++;
  }

  return keys.map((key) => buckets[key] ?? { month: key, estimated: 0, actual: 0, eventCount: 0 });
}
