/**
 * Seeds a handful of ready-made dashboards — the ServiceOps/ObserveOps idea of "stock"
 * dashboards: published, built-in, covering the standard angles of analysis so the portal has
 * something useful to look at on day one, before anyone has built their own. Idempotent by
 * dashboard name: already seeded once, running this again changes nothing.
 *
 *   npm run config:seed-dashboards
 *
 * Deliberately built the same way `ensureBuiltInDashboard` builds the Overview dashboard — plain
 * Prisma writes, no server-only import — so this can run from a script exactly like the rest of
 * `npm run config:seed` does. `isBuiltIn: true` means anyone can clone one of these to make it
 * their own, but nobody can edit or delete the original.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { parseWidgetSpec, type WidgetSpec } from "../src/server/dashboards/spec";

const db = new PrismaClient();

type WidgetDef = { title: string; spec: Partial<WidgetSpec>; x: number; y: number; w: number; h: number };

const widget = (title: string, spec: Partial<WidgetSpec>, x: number, y: number, w: number, h: number): WidgetDef => ({
  title,
  spec,
  x,
  y,
  w,
  h,
});

const KPI_W = 250;
const KPI_H = 120;
const kpiRow = (defs: { title: string; metric: string }[], y: number): WidgetDef[] =>
  defs.map((d, i) => widget(d.title, { view: "kpi", metrics: [d.metric] }, i * KPI_W, y, KPI_W, KPI_H));

type DashboardDef = { name: string; description: string; sortOrder: number; widgets: WidgetDef[] };

const DASHBOARDS: DashboardDef[] = [
  {
    name: "Approvals & Turnaround",
    description: "How fast requests move through Channel review, Event approval and Budget approval.",
    sortOrder: 1,
    widgets: [
      ...kpiRow(
        [
          { title: "Pending approvals", metric: "approvals.pending" },
          { title: "Rejected rounds", metric: "approvals.rejected" },
          { title: "Avg turnaround (hrs)", metric: "approvals.turnaroundHours" },
          { title: "Total decisions", metric: "approvals.decisions" },
        ],
        0,
      ),
      widget(
        "Rounds by stage",
        { view: "bar", metrics: ["approvals.rounds"], dimension: "approval.stage" },
        0,
        130,
        500,
        300,
      ),
      widget(
        "Decisions by outcome",
        { view: "donut", metrics: ["approvals.decisions"], dimension: "approval.decision" },
        500,
        130,
        500,
        300,
      ),
      widget(
        "Turnaround by stage (hrs)",
        { view: "bar", metrics: ["approvals.turnaroundHours"], dimension: "approval.stage" },
        0,
        440,
        500,
        300,
      ),
      widget(
        "Decisions by approver",
        { view: "table", metrics: ["approvals.decisions"], dimension: "approval.approver" },
        500,
        440,
        500,
        300,
      ),
    ],
  },
  {
    name: "Budget & Finance",
    description: "Spend by category and invoice status, and how estimates compare to what was actually spent.",
    sortOrder: 2,
    widgets: [
      ...kpiRow(
        [
          { title: "Estimated", metric: "money.estimated" },
          { title: "Actual", metric: "money.actual" },
          { title: "Budget utilisation", metric: "ratio.budgetUtilisation" },
          { title: "Unpaid lines", metric: "lines.unpaid" },
        ],
        0,
      ),
      widget(
        "Spend by category",
        { view: "bar", metrics: ["lines.estimated", "lines.actual"], dimension: "cost.category" },
        0,
        130,
        500,
        300,
      ),
      widget(
        "Lines by invoice status",
        { view: "donut", metrics: ["lines.count"], dimension: "cost.invoiceStatus" },
        500,
        130,
        500,
        300,
      ),
      widget(
        "Contribution split",
        { view: "bar", metrics: ["money.motadata", "money.partner", "money.mdf"], dimension: "event.department" },
        0,
        440,
        500,
        300,
      ),
      widget(
        "Spend by payment status",
        { view: "table", metrics: ["lines.estimated", "lines.actual"], dimension: "cost.paymentStatus" },
        500,
        440,
        500,
        300,
      ),
    ],
  },
  {
    name: "Partner & Channel Performance",
    description: "Which partners and distributors run the most events, and what they cost.",
    sortOrder: 3,
    widgets: [
      ...kpiRow(
        [
          { title: "Events", metric: "events.count" },
          { title: "Closed", metric: "events.closed" },
          { title: "Dropped", metric: "events.dropped" },
          { title: "Estimated spend", metric: "money.estimated" },
        ],
        0,
      ),
      widget(
        "Events by partner",
        { view: "table", metrics: ["events.count"], dimension: "event.partner", sort: { by: "metric", dir: "desc" } },
        0,
        130,
        500,
        300,
      ),
      widget(
        "Spend by partner",
        { view: "bar", metrics: ["money.estimated"], dimension: "event.partner", limit: 10 },
        500,
        130,
        500,
        300,
      ),
      widget(
        "Events by partner type",
        { view: "donut", metrics: ["events.count"], dimension: "event.partnerType" },
        0,
        440,
        500,
        300,
      ),
      widget(
        "Events by partner tier",
        { view: "bar", metrics: ["events.count"], dimension: "event.partnerTier" },
        500,
        440,
        500,
        300,
      ),
    ],
  },
  {
    name: "Regional Analysis",
    description: "Where events run — region, city and format — and what each costs.",
    sortOrder: 4,
    widgets: [
      ...kpiRow(
        [
          { title: "Events", metric: "events.count" },
          { title: "Avg duration (days)", metric: "events.avgDuration" },
          { title: "Estimated spend", metric: "money.estimated" },
          { title: "Actual spend", metric: "money.actual" },
        ],
        0,
      ),
      widget(
        "Events by region",
        { view: "donut", metrics: ["events.count"], dimension: "event.region" },
        0,
        130,
        500,
        300,
      ),
      widget(
        "Spend by region",
        { view: "bar", metrics: ["money.estimated", "money.actual"], dimension: "event.region" },
        500,
        130,
        500,
        300,
      ),
      widget(
        "Top cities",
        { view: "table", metrics: ["events.count"], dimension: "event.city", sort: { by: "metric", dir: "desc" } },
        0,
        440,
        500,
        300,
      ),
      widget(
        "Events by format",
        { view: "donut", metrics: ["events.count"], dimension: "event.format" },
        500,
        440,
        500,
        300,
      ),
    ],
  },
  {
    name: "Event Outcomes & ROI",
    description: "Attendance, leads and opportunities once an event has actually run.",
    sortOrder: 5,
    widgets: [
      ...kpiRow(
        [
          { title: "Attendance", metric: "outcome.attendance" },
          { title: "Companies engaged", metric: "outcome.companies" },
          { title: "New leads", metric: "outcome.leads" },
          { title: "Opportunities", metric: "outcome.opportunities" },
        ],
        0,
      ),
      widget(
        "SQLs vs opportunities by department",
        { view: "bar", metrics: ["outcome.sqls", "outcome.opportunities"], dimension: "event.department" },
        0,
        130,
        500,
        300,
      ),
      widget(
        "Attendance by region",
        { view: "bar", metrics: ["outcome.attendance"], dimension: "event.region" },
        500,
        130,
        500,
        300,
      ),
      widget(
        "Cost per lead",
        { view: "bar", metrics: ["ratio.costPerLead"], dimension: "event.department" },
        0,
        440,
        500,
        300,
      ),
      widget(
        "Meetings conducted by department",
        { view: "table", metrics: ["outcome.meetings", "outcome.leads"], dimension: "event.department" },
        500,
        440,
        500,
        300,
      ),
    ],
  },
];

async function resolveActor() {
  const admin =
    (await db.user.findFirst({ where: { roles: { has: "ADMIN" }, status: "ACTIVE" }, orderBy: { createdAt: "asc" } })) ??
    (await db.user.findFirst({ where: { roles: { has: "ADMIN" } }, orderBy: { createdAt: "asc" } }));
  if (!admin) throw new Error("No administrator exists yet. Run `npm run user:create-admin` first.");
  return admin;
}

async function main() {
  const actor = await resolveActor();
  let created = 0;

  for (const def of DASHBOARDS) {
    const existing = await db.dashboard.findFirst({ where: { name: def.name } });
    if (existing) {
      console.log(`Already exists — skipped: ${def.name}`);
      continue;
    }

    await db.dashboard.create({
      data: {
        name: def.name,
        description: def.description,
        ownerId: actor.id,
        visibility: "EVERYONE",
        isBuiltIn: true,
        sortOrder: def.sortOrder,
        filters: {} as Prisma.InputJsonValue,
        widgets: {
          create: def.widgets.map((w) => ({
            title: w.title,
            x: w.x,
            y: w.y,
            w: w.w,
            h: w.h,
            z: 0,
            spec: parseWidgetSpec(w.spec) as unknown as Prisma.InputJsonValue,
          })),
        },
      },
    });
    created++;
    console.log(`Created: ${def.name} (${def.widgets.length} widgets)`);
  }

  console.log(`\nDone. ${created} dashboard(s) created, ${DASHBOARDS.length - created} already existed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
