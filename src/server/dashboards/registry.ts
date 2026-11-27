/**
 * The allow-list: every dimension a widget may group by, every metric it may measure, and every
 * field it may filter on — each one paired with the SQL that implements it.
 *
 * ## The one invariant
 *
 * **Identifiers and operators come only from `Prisma.sql` template literals written at module
 * scope in this file. Every value that arrives from a saved spec is a `${}` interpolation, which
 * Prisma renders as a bound `$1, $2, …` parameter. `Prisma.raw()` is called only with a string
 * literal.**
 *
 * That asymmetry is the whole safety mechanism. `Prisma.sql` composes a nested `Sql` object by
 * splicing its *text* and concatenating its *parameters*, so `${DIM.sql}` becomes identifier
 * text while `${values}` becomes a single placeholder. A future contributor could break this in
 * exactly one way — by passing a spec key to `Prisma.raw` — so an ESLint rule forbids it and a
 * test asserts that no fragment in this file carries parameters of its own.
 *
 * ## Why the parameter is cast to the enum, and never the column
 *
 * Measured against the real database (107 events) before any of this was written: casting the
 * column, `e."department"::text = ANY($1)`, makes Postgres estimate 2 rows where the truth is
 * 107 — a 50× error, because the cast throws away that column's statistics. Casting the
 * parameter instead, `e."department" = ANY($1::"Department"[])`, estimates it exactly. Both can
 * use an index; only one lets the planner choose a sane join order, and this engine builds
 * queries with up to five CTEs where that choice decides everything.
 *
 * ## Keys are a public API
 *
 * A saved dashboard refers to these keys forever. **Add keys; never rename one.** `ALIASES`
 * exists so a rename that becomes unavoidable costs one line here rather than a data migration.
 */
import "server-only";
import {
  ApprovalStatus,
  Department,
  InvoiceStatus,
  LifecycleStatus,
  Prisma,
  RoundStatus,
  TaskStatus,
} from "@prisma/client";

/**
 * Legal members, taken from the generated client rather than retyped.
 *
 * The UI's own lists are not interchangeable with these: `LIFECYCLE_STATUSES` and
 * `APPROVAL_STATUSES` in `src/lib/lifecycle.ts` describe what a *badge* can show, and
 * `APPROVAL_STATUSES` deliberately omits `NOT_SUBMITTED`. A filter allow-list has to match the
 * database exactly, or a legitimate value gets dropped as invalid.
 */
const members = (e: Record<string, string>) => Object.values(e);

/**
 * Which table a dimension or metric is counted on. The compiler collapses every `multi` source
 * to one row per event before joining, so a metric can never be multiplied by an unrelated
 * table's row count — see `compile.ts`.
 */
export type FactSource = "event" | "costLine" | "task" | "approval" | "outcome";

/** Sources with many rows per event. Two different ones can never appear in one widget. */
export const MULTI_ROW_SOURCES: ReadonlySet<FactSource> = new Set(["costLine", "task", "approval"]);

/** A table the compiler may left-join to resolve a label. Keys are fixed; aliases are fixed. */
export type JoinKey =
  | "eventType"
  | "subtype"
  | "partnerOrg"
  | "owner"
  | "requester"
  | "manager"
  | "expenseCategory"
  | "taskOwner"
  | "approvalStage"
  | "approver"
  | "regionLookup"
  | "formatLookup"
  | "productFocusLookup"
  | "tierLookup";

/**
 * Join clauses, written out in full. `LEFT JOIN` without exception: an inner join would drop
 * events that have no partner, no owner or no cost lines, and then two widgets on one dashboard
 * would disagree about how many events exist.
 */
export const JOINS: Record<JoinKey, Prisma.Sql> = {
  eventType: Prisma.sql`LEFT JOIN "event_types" et ON et."id" = e."eventTypeId"`,
  subtype: Prisma.sql`LEFT JOIN "event_subtypes" est ON est."id" = e."subtypeId"`,
  partnerOrg: Prisma.sql`LEFT JOIN "organizations" po ON po."id" = e."partnerOrgId"`,
  owner: Prisma.sql`LEFT JOIN "users" ow ON ow."id" = e."ownerId"`,
  requester: Prisma.sql`LEFT JOIN "users" rq ON rq."id" = e."requesterId"`,
  manager: Prisma.sql`LEFT JOIN "users" mg ON mg."id" = e."managerId"`,
  expenseCategory: Prisma.sql`LEFT JOIN "expense_categories" ec ON ec."id" = cl."categoryId"`,
  taskOwner: Prisma.sql`LEFT JOIN "users" tow ON tow."id" = t."ownerId"`,
  approvalStage: Prisma.sql`LEFT JOIN "approval_stages" ast ON ast."id" = ad."stageId"`,
  approver: Prisma.sql`LEFT JOIN "users" apu ON apu."id" = ad."approverId"`,

  // Events store a lookup's stable `value` ("me_europe"), while people read its `label`
  // ("ME & Europe"). The label is admin-editable, so it is joined rather than hardcoded — and
  // the join is LEFT with a COALESCE fallback, so a value whose lookup was retired still shows
  // as itself instead of vanishing into the null bucket.
  regionLookup: Prisma.sql`LEFT JOIN "lookup_items" lkr ON lkr."kind" = 'REGION' AND lkr."value" = e."region"`,
  formatLookup: Prisma.sql`LEFT JOIN "lookup_items" lkf ON lkf."kind" = 'EVENT_FORMAT' AND lkf."value" = e."format"`,
  productFocusLookup: Prisma.sql`LEFT JOIN "lookup_items" lkp ON lkp."kind" = 'PRODUCT_FOCUS' AND lkp."value" = e."productFocus"`,
  tierLookup: Prisma.sql`LEFT JOIN "lookup_items" lkt ON lkt."kind" = 'PARTNER_TIER' AND lkt."value" = e."partnerTier"`,
};

/**
 * Enum array casts, for the parameter side of `= ANY(...)`. Every value is a string literal, so
 * `Prisma.raw` here can never see anything from a spec.
 */
const ENUM_ARRAY = {
  Department: Prisma.raw('"Department"[]'),
  LifecycleStatus: Prisma.raw('"LifecycleStatus"[]'),
  ApprovalStatus: Prisma.raw('"ApprovalStatus"[]'),
  InvoiceStatus: Prisma.raw('"InvoiceStatus"[]'),
  PaymentStatus: Prisma.raw('"PaymentStatus"[]'),
  TaskStatus: Prisma.raw('"TaskStatus"[]'),
  RoundStatus: Prisma.raw('"RoundStatus"[]'),
  DecisionType: Prisma.raw('"DecisionType"[]'),
  DecisionChannel: Prisma.raw('"DecisionChannel"[]'),
  OrganizationType: Prisma.raw('"OrganizationType"[]'),
} as const;
type EnumName = keyof typeof ENUM_ARRAY;

// Re-exported so server code can keep importing it from the registry, while the widgets that
// render these figures import it from `./spec`, which is client-safe.
import type { LabelSet } from "./labels";
import type { NumberFormat } from "./spec";
export type { NumberFormat };

export type DimensionDef = {
  label: string;
  /** Short group heading in the widget builder's dropdown. */
  group: string;
  /** The grouping expression. Written here; never assembled from input. */
  sql: Prisma.Sql;
  source: FactSource;
  joins: readonly JoinKey[];
  /**
   * What a chart shows when the grouped value is NULL. Bound as a parameter, so it is never
   * quoted into the SQL text. Never an empty string — a blank axis label reads as a bug.
   */
  nullLabel: string;
  /** Overrides alphabetical ordering where the natural order is not alphabetical. */
  orderSql?: Prisma.Sql;
  /**
   * How a stored value becomes a readable one — `CHANNEL` into "Channel". Applied after the
   * query, in `run.ts`, so the portal keeps one spelling of each label. Lookup-backed values
   * are joined for their label instead and need nothing here.
   */
  valueLabels?: LabelSet;
};

export type MetricDef = {
  label: string;
  group: string;
  /** Short note shown in the builder. Used to disambiguate the two "approved" readings. */
  help?: string;
  source: FactSource;
  /** The aggregate expression. `Prisma.empty` for a ratio, which is computed afterwards in TS. */
  agg: Prisma.Sql;
  format: NumberFormat;
  /** Ratios name two other metrics; the division happens in `run.ts`, never in SQL. */
  ratioOf?: { numerator: string; denominator: string };
  /**
   * True when the aggregate survives being joined to a table with many rows per event — which
   * means `COUNT(DISTINCT e."id")` and nothing else. Any `SUM` would be multiplied by the
   * number of joined rows, so the compiler refuses to put one in the same widget as a
   * cost-line, task or approval metric. See `compile.ts`.
   */
  fanoutSafe?: boolean;
  /** True when this metric exposes money, and so is governed by the money-roles setting. */
  money?: boolean;
};

// ─── Dimensions ──────────────────────────────────────────────────────────────

/**
 * `Object.create(null)` throughout: a bare `DIMENSIONS["constructor"]` on a normal object
 * literal returns a truthy value off the prototype chain, and the compiler would then read
 * `undefined` for `.sql` and `.joins`. Lookups also go through `lookupDimension` below.
 */
export const DIMENSIONS: Record<string, DimensionDef> = Object.assign(Object.create(null), {
  // Event attributes — promoted columns only, never the `answers` blob.
  "event.department": {
    label: "Department",
    group: "Event",
    sql: Prisma.sql`e."department"::text`,
    source: "event",
    joins: [],
    nullLabel: "No department",
    valueLabels: "department",
  },
  "event.lifecycle": {
    label: "Stage",
    group: "Event",
    sql: Prisma.sql`e."lifecycleStatus"::text`,
    source: "event",
    joins: [],
    nullLabel: "Unknown",
    valueLabels: "lifecycle",
  },
  "event.approval": {
    label: "Approval state",
    group: "Event",
    sql: Prisma.sql`e."approvalStatus"::text`,
    source: "event",
    joins: [],
    nullLabel: "Unknown",
    valueLabels: "approval",
  },
  "event.city": {
    label: "City",
    group: "Event",
    sql: Prisma.sql`e."city"`,
    source: "event",
    joins: [],
    nullLabel: "No city",
  },
  "event.region": {
    label: "Region",
    group: "Event",
    sql: Prisma.sql`COALESCE(lkr."label", e."region")`,
    source: "event",
    joins: ["regionLookup"],
    nullLabel: "No region",
  },
  "event.venue": {
    label: "Venue",
    group: "Event",
    sql: Prisma.sql`e."venue"`,
    source: "event",
    joins: [],
    nullLabel: "No venue",
  },
  "event.format": {
    label: "Format",
    group: "Event",
    sql: Prisma.sql`COALESCE(lkf."label", e."format")`,
    source: "event",
    joins: ["formatLookup"],
    nullLabel: "Not set",
  },
  "event.productFocus": {
    label: "Product focus",
    group: "Event",
    sql: Prisma.sql`COALESCE(lkp."label", e."productFocus")`,
    source: "event",
    joins: ["productFocusLookup"],
    nullLabel: "Not set",
  },
  "event.partnerTier": {
    label: "Partner tier",
    group: "Partner",
    sql: Prisma.sql`COALESCE(lkt."label", e."partnerTier")`,
    source: "event",
    joins: ["tierLookup"],
    nullLabel: "No tier",
  },
  "event.durationDays": {
    label: "Duration (days)",
    group: "Event",
    sql: Prisma.sql`e."durationDays"::text`,
    source: "event",
    joins: [],
    nullLabel: "Not set",
  },

  // Related-model dimensions: the ones Prisma's groupBy cannot express at all.
  "event.type": {
    label: "Event type",
    group: "Event",
    sql: Prisma.sql`et."name"`,
    source: "event",
    joins: ["eventType"],
    nullLabel: "Unknown type",
  },
  "event.subtype": {
    label: "Sub type",
    group: "Event",
    sql: Prisma.sql`est."name"`,
    source: "event",
    joins: ["subtype"],
    nullLabel: "No sub type",
  },
  "event.partner": {
    label: "Partner organisation",
    group: "Partner",
    sql: Prisma.sql`po."name"`,
    source: "event",
    joins: ["partnerOrg"],
    nullLabel: "Run without a partner",
  },
  "event.partnerType": {
    label: "Partner or distributor",
    group: "Partner",
    sql: Prisma.sql`po."type"::text`,
    source: "event",
    joins: ["partnerOrg"],
    nullLabel: "Run without a partner",
    valueLabels: "enum",
  },
  "event.owner": {
    label: "Event owner",
    group: "People",
    sql: Prisma.sql`ow."name"`,
    source: "event",
    joins: ["owner"],
    nullLabel: "Unassigned",
  },
  "event.requester": {
    label: "Requester",
    group: "People",
    sql: Prisma.sql`rq."name"`,
    source: "event",
    joins: ["requester"],
    nullLabel: "Unknown",
  },
  "event.manager": {
    label: "Event manager",
    group: "People",
    sql: Prisma.sql`mg."name"`,
    source: "event",
    joins: ["manager"],
    nullLabel: "Unassigned",
  },

  // Money, at cost-line grain.
  "cost.category": {
    label: "Expense category",
    group: "Budget",
    sql: Prisma.sql`ec."name"`,
    source: "costLine",
    joins: ["expenseCategory"],
    nullLabel: "Uncategorised",
  },
  "cost.invoiceStatus": {
    label: "Invoice status",
    group: "Budget",
    sql: Prisma.sql`cl."invoiceStatus"::text`,
    source: "costLine",
    joins: [],
    nullLabel: "Unknown",
    valueLabels: "enum",
  },
  "cost.paymentStatus": {
    label: "Payment status",
    group: "Budget",
    sql: Prisma.sql`cl."paymentStatus"::text`,
    source: "costLine",
    joins: [],
    nullLabel: "Not applicable",
    valueLabels: "enum",
  },
  "cost.vendor": {
    label: "Vendor",
    group: "Budget",
    sql: Prisma.sql`cl."vendor"`,
    source: "costLine",
    joins: [],
    nullLabel: "No vendor",
  },

  // Approvals.
  "approval.stage": {
    label: "Approval stage",
    group: "Approvals",
    sql: Prisma.sql`ast."name"`,
    source: "approval",
    joins: ["approvalStage"],
    nullLabel: "No stage",
    // Stages read in workflow order, not alphabetically — "Channel review" before "Budget approval".
    orderSql: Prisma.sql`MIN(ast."sequence")`,
  },
  "approval.decision": {
    label: "Decision",
    group: "Approvals",
    sql: Prisma.sql`ad."decision"::text`,
    source: "approval",
    joins: [],
    nullLabel: "No decision yet",
    valueLabels: "enum",
  },
  "approval.channel": {
    label: "Decided from",
    group: "Approvals",
    sql: Prisma.sql`ad."channel"::text`,
    source: "approval",
    joins: [],
    nullLabel: "Unknown",
    valueLabels: "enum",
  },
  "approval.approver": {
    label: "Approver",
    group: "Approvals",
    sql: Prisma.sql`apu."name"`,
    source: "approval",
    joins: ["approver"],
    nullLabel: "Unknown",
  },
  "approval.roundStatus": {
    label: "Round status",
    group: "Approvals",
    sql: Prisma.sql`ar."status"::text`,
    source: "approval",
    joins: [],
    nullLabel: "Unknown",
    valueLabels: "enum",
  },

  // Tasks.
  "task.status": {
    label: "Task status",
    group: "Tasks",
    sql: Prisma.sql`t."status"::text`,
    source: "task",
    joins: [],
    nullLabel: "Unknown",
    valueLabels: "enum",
  },
  "task.owner": {
    label: "Task owner",
    group: "Tasks",
    sql: Prisma.sql`tow."name"`,
    source: "task",
    joins: ["taskOwner"],
    nullLabel: "Unassigned",
  },

  // Post-event results. `satisfactionScore` and `actualRoi` are free text in the schema, so they
  // are dimensions, not metrics: one `::numeric` cast on one prose answer would raise
  // "invalid input syntax for type numeric" and take the whole dashboard down.
  "outcome.satisfaction": {
    label: "Satisfaction score",
    group: "Results",
    sql: Prisma.sql`per."satisfactionScore"`,
    source: "outcome",
    joins: [],
    nullLabel: "Not rated",
  },
  "outcome.followUpOwner": {
    label: "Follow-up owner",
    group: "Results",
    sql: Prisma.sql`per."followUpOwner"`,
    source: "outcome",
    joins: [],
    nullLabel: "Unassigned",
  },
  "outcome.roi": {
    label: "Actual ROI (as reported)",
    group: "Results",
    sql: Prisma.sql`per."actualRoi"`,
    source: "outcome",
    joins: [],
    nullLabel: "Not reported",
  },
} satisfies Record<string, DimensionDef>);

// ─── Metrics ─────────────────────────────────────────────────────────────────

export const METRICS: Record<string, MetricDef> = Object.assign(Object.create(null), {
  // Events.
  "events.count": {
    label: "Events",
    group: "Events",
    source: "event",
    agg: Prisma.sql`COUNT(DISTINCT e."id")`,
    format: "integer",
    fanoutSafe: true,
  },
  "events.closed": {
    label: "Closed events",
    group: "Events",
    source: "event",
    agg: Prisma.sql`COUNT(DISTINCT e."id") FILTER (WHERE e."lifecycleStatus" = 'CLOSED')`,
    format: "integer",
    fanoutSafe: true,
  },
  "events.dropped": {
    label: "Dropped events",
    group: "Events",
    source: "event",
    agg: Prisma.sql`COUNT(DISTINCT e."id") FILTER (WHERE e."lifecycleStatus" = 'DROPPED')`,
    format: "integer",
    fanoutSafe: true,
  },
  "events.avgDuration": {
    label: "Average duration (days)",
    group: "Events",
    source: "event",
    agg: Prisma.sql`AVG(e."durationDays")`,
    format: "decimal",
  },

  // Money on the event's own columns.
  "money.estimated": {
    label: "Estimated cost",
    group: "Budget",
    help: "The event's estimated total, rolled up from its budget lines.",
    source: "event",
    agg: Prisma.sql`SUM(e."estimatedCost")`,
    format: "money",
    money: true,
  },
  "money.actual": {
    label: "Actual cost",
    group: "Budget",
    help: "What was actually spent, rolled up from the budget lines.",
    source: "event",
    agg: Prisma.sql`SUM(e."actualCost")`,
    format: "money",
    money: true,
  },
  "money.motadata": {
    label: "Motadata contribution",
    group: "Budget",
    source: "event",
    agg: Prisma.sql`SUM(e."motadataContribution")`,
    format: "money",
    money: true,
  },
  "money.partner": {
    label: "Partner contribution",
    group: "Budget",
    source: "event",
    agg: Prisma.sql`SUM(e."partnerContribution")`,
    format: "money",
    money: true,
  },
  "money.mdf": {
    label: "MDF allocation",
    group: "Budget",
    source: "event",
    agg: Prisma.sql`SUM(e."mdfAllocation")`,
    format: "money",
    money: true,
  },

  // Money at cost-line grain. One definition of "approved", deliberately: the sum of the
  // lines, left blank when no line carries one. The lines are the source of truth — the app
  // computes `Event.approvedCost` *from* them — and ₹0 would report an unapproved ₹50 L event
  // identically to one genuinely approved at zero.
  "lines.approved": {
    label: "Approved cost",
    group: "Budget",
    help: "Sum of the approved amount on each budget line. Blank when no line is approved yet — not ₹0.",
    source: "costLine",
    agg: Prisma.sql`SUM(cl."approved")`,
    format: "money",
    money: true,
  },
  "lines.estimated": {
    label: "Estimated cost (budget lines)",
    group: "Budget",
    source: "costLine",
    agg: Prisma.sql`SUM(cl."estimated")`,
    format: "money",
    money: true,
  },
  "lines.actual": {
    label: "Actual cost (budget lines)",
    group: "Budget",
    source: "costLine",
    agg: Prisma.sql`SUM(cl."actual")`,
    format: "money",
    money: true,
  },
  "lines.count": {
    label: "Budget lines",
    group: "Budget",
    source: "costLine",
    agg: Prisma.sql`COUNT(cl."id")`,
    format: "integer",
  },
  "lines.unpaid": {
    label: "Unpaid",
    group: "Budget",
    help: "Actual spend on lines not yet marked paid.",
    source: "costLine",
    agg: Prisma.sql`SUM(cl."actual") FILTER (WHERE cl."paymentStatus" IS DISTINCT FROM 'PAID')`,
    format: "money",
    money: true,
  },

  // Approvals.
  "approvals.rounds": {
    label: "Approval rounds",
    group: "Approvals",
    source: "approval",
    agg: Prisma.sql`COUNT(DISTINCT ar."id")`,
    format: "integer",
  },
  "approvals.pending": {
    label: "Pending rounds",
    group: "Approvals",
    source: "approval",
    agg: Prisma.sql`COUNT(DISTINCT ar."id") FILTER (WHERE ar."status" = 'PENDING')`,
    format: "integer",
  },
  "approvals.rejected": {
    label: "Rejected rounds",
    group: "Approvals",
    source: "approval",
    agg: Prisma.sql`COUNT(DISTINCT ar."id") FILTER (WHERE ar."status" = 'REJECTED')`,
    format: "integer",
  },
  "approvals.decisions": {
    label: "Decisions",
    group: "Approvals",
    source: "approval",
    agg: Prisma.sql`COUNT(ad."id")`,
    format: "integer",
  },
  "approvals.turnaroundHours": {
    label: "Submit to decision (hours)",
    group: "Approvals",
    help: "Average hours from submission to the round completing. Per-stage turnaround lives on the Reports page, which reconstructs stage baselines a way this cannot.",
    source: "approval",
    agg: Prisma.sql`AVG(EXTRACT(EPOCH FROM (ar."completedAt" - ar."submittedAt")) / 3600) FILTER (WHERE ar."completedAt" IS NOT NULL)`,
    format: "hours",
  },

  // Tasks.
  "tasks.count": {
    label: "Tasks",
    group: "Tasks",
    source: "task",
    agg: Prisma.sql`COUNT(t."id")`,
    format: "integer",
  },
  "tasks.done": {
    label: "Tasks done",
    group: "Tasks",
    source: "task",
    agg: Prisma.sql`COUNT(t."id") FILTER (WHERE t."status" = 'DONE')`,
    format: "integer",
  },
  "tasks.blocked": {
    label: "Tasks blocked",
    group: "Tasks",
    source: "task",
    agg: Prisma.sql`COUNT(t."id") FILTER (WHERE t."status" = 'BLOCKED')`,
    format: "integer",
  },
  "tasks.overdue": {
    label: "Tasks overdue",
    group: "Tasks",
    source: "task",
    agg: Prisma.sql`COUNT(t."id") FILTER (WHERE t."status" <> 'DONE' AND t."dueDate" < NOW())`,
    format: "integer",
  },

  // Post-event results.
  "outcome.attendance": {
    label: "Actual attendance",
    group: "Results",
    source: "outcome",
    agg: Prisma.sql`SUM(per."actualAttendance")`,
    format: "integer",
  },
  "outcome.companies": {
    label: "Companies engaged",
    group: "Results",
    source: "outcome",
    agg: Prisma.sql`SUM(per."companiesEngaged")`,
    format: "integer",
  },
  "outcome.leads": {
    label: "New leads",
    group: "Results",
    source: "outcome",
    agg: Prisma.sql`SUM(per."newLeads")`,
    format: "integer",
  },
  "outcome.sqls": {
    label: "Sales-qualified leads",
    group: "Results",
    source: "outcome",
    agg: Prisma.sql`SUM(per."sqls")`,
    format: "integer",
  },
  "outcome.opportunities": {
    label: "Opportunities",
    group: "Results",
    source: "outcome",
    agg: Prisma.sql`SUM(per."opportunities")`,
    format: "integer",
  },
  "outcome.meetings": {
    label: "Meetings conducted",
    group: "Results",
    source: "outcome",
    agg: Prisma.sql`SUM(per."meetingsConducted")`,
    format: "integer",
  },

  // Ratios. No aggregate of their own: the compiler selects the two named metrics and `run.ts`
  // divides, guarding the zero denominator. Dividing in SQL means either a division-by-zero
  // that kills the query or float precision loss on money.
  "ratio.budgetUtilisation": {
    label: "Budget utilisation",
    group: "Budget",
    help: "Actual as a percentage of estimated.",
    source: "event",
    agg: Prisma.empty,
    format: "percent",
    money: true,
    ratioOf: { numerator: "money.actual", denominator: "money.estimated" },
  },
  "ratio.taskCompletion": {
    label: "Task completion",
    group: "Tasks",
    source: "task",
    agg: Prisma.empty,
    format: "percent",
    ratioOf: { numerator: "tasks.done", denominator: "tasks.count" },
  },
  "ratio.costPerLead": {
    label: "Cost per lead",
    group: "Results",
    help: "Actual spend divided by new leads.",
    source: "event",
    agg: Prisma.empty,
    format: "decimal",
    money: true,
    ratioOf: { numerator: "money.actual", denominator: "outcome.leads" },
  },
} satisfies Record<string, MetricDef>);

// ─── Filters ─────────────────────────────────────────────────────────────────

export type FilterKind = "enum" | "id" | "text" | "number" | "date" | "boolean";

export type FilterDef = {
  label: string;
  group: string;
  source: FactSource;
  column: Prisma.Sql;
  kind: FilterKind;
  /** For `kind: "enum"` — the legal members, so a bad value is dropped before it reaches SQL. */
  members?: readonly string[];
  /** For `kind: "enum"` — the Postgres type the *parameter* is cast to. */
  enumType?: EnumName;
  joins?: readonly JoinKey[];
};

const TEXT_OPS = ["in", "not_in", "eq", "neq", "contains", "is_null", "is_not_null"] as const;
const NUMBER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_null", "is_not_null"] as const;

export const FILTERS: Record<string, FilterDef> = Object.assign(Object.create(null), {
  "event.department": {
    label: "Department",
    group: "Event",
    source: "event",
    column: Prisma.sql`e."department"`,
    kind: "enum",
    members: members(Department),
    enumType: "Department",
  },
  "event.lifecycle": {
    label: "Stage",
    group: "Event",
    source: "event",
    column: Prisma.sql`e."lifecycleStatus"`,
    kind: "enum",
    members: members(LifecycleStatus),
    enumType: "LifecycleStatus",
  },
  "event.approval": {
    label: "Approval state",
    group: "Event",
    source: "event",
    column: Prisma.sql`e."approvalStatus"`,
    kind: "enum",
    members: members(ApprovalStatus),
    enumType: "ApprovalStatus",
  },
  "event.city": { label: "City", group: "Event", source: "event", column: Prisma.sql`e."city"`, kind: "text" },
  "event.region": { label: "Region", group: "Event", source: "event", column: Prisma.sql`e."region"`, kind: "text" },
  "event.venue": { label: "Venue", group: "Event", source: "event", column: Prisma.sql`e."venue"`, kind: "text" },
  "event.format": { label: "Format", group: "Event", source: "event", column: Prisma.sql`e."format"`, kind: "text" },
  "event.productFocus": {
    label: "Product focus",
    group: "Event",
    source: "event",
    column: Prisma.sql`e."productFocus"`,
    kind: "text",
  },
  "event.partnerTier": {
    label: "Partner tier",
    group: "Partner",
    source: "event",
    column: Prisma.sql`e."partnerTier"`,
    kind: "text",
  },
  "event.eventTypeId": {
    label: "Event type",
    group: "Event",
    source: "event",
    column: Prisma.sql`e."eventTypeId"`,
    kind: "id",
  },
  "event.subtypeId": {
    label: "Sub type",
    group: "Event",
    source: "event",
    column: Prisma.sql`e."subtypeId"`,
    kind: "id",
  },
  "event.partnerOrgId": {
    label: "Partner organisation",
    group: "Partner",
    source: "event",
    column: Prisma.sql`e."partnerOrgId"`,
    kind: "id",
  },
  "event.ownerId": { label: "Event owner", group: "People", source: "event", column: Prisma.sql`e."ownerId"`, kind: "id" },
  "event.requesterId": {
    label: "Requester",
    group: "People",
    source: "event",
    column: Prisma.sql`e."requesterId"`,
    kind: "id",
  },
  "event.managerId": {
    label: "Event manager",
    group: "People",
    source: "event",
    column: Prisma.sql`e."managerId"`,
    kind: "id",
  },
  "event.estimatedCost": {
    label: "Estimated cost",
    group: "Budget",
    source: "event",
    column: Prisma.sql`e."estimatedCost"`,
    kind: "number",
  },
  "event.actualCost": {
    label: "Actual cost",
    group: "Budget",
    source: "event",
    column: Prisma.sql`e."actualCost"`,
    kind: "number",
  },
  "cost.categoryId": {
    label: "Expense category",
    group: "Budget",
    source: "costLine",
    column: Prisma.sql`cl."categoryId"`,
    kind: "id",
  },
  "cost.invoiceStatus": {
    label: "Invoice status",
    group: "Budget",
    source: "costLine",
    column: Prisma.sql`cl."invoiceStatus"`,
    kind: "enum",
    members: members(InvoiceStatus),
    enumType: "InvoiceStatus",
  },
  "task.status": {
    label: "Task status",
    group: "Tasks",
    source: "task",
    column: Prisma.sql`t."status"`,
    kind: "enum",
    members: members(TaskStatus),
    enumType: "TaskStatus",
  },
  "approval.roundStatus": {
    label: "Round status",
    group: "Approvals",
    source: "approval",
    column: Prisma.sql`ar."status"`,
    kind: "enum",
    members: members(RoundStatus),
    enumType: "RoundStatus",
  },
} satisfies Record<string, FilterDef>);

/** Which operators each kind of filter accepts. Checked before anything is compiled. */
export const OPS_BY_KIND: Record<FilterKind, readonly string[]> = {
  enum: ["in", "not_in", "is_null", "is_not_null"],
  id: ["in", "not_in", "eq", "neq", "is_null", "is_not_null"],
  text: TEXT_OPS,
  number: NUMBER_OPS,
  date: ["gte", "lte", "between", "is_null", "is_not_null"],
  boolean: ["eq"],
};

// ─── Date fields ─────────────────────────────────────────────────────────────

export type TimeFieldDef = { label: string; sql: Prisma.Sql; source: FactSource };

/** The date columns a period filter and a time grain may be applied to. */
export const TIME_FIELDS: Record<string, TimeFieldDef> = Object.assign(Object.create(null), {
  "event.proposedDate": { label: "Proposed date", sql: Prisma.sql`e."proposedDate"`, source: "event" },
  "event.createdAt": { label: "Raised on", sql: Prisma.sql`e."createdAt"`, source: "event" },
  "event.submittedAt": { label: "Submitted on", sql: Prisma.sql`e."submittedAt"`, source: "event" },
  "event.approvedAt": { label: "Approved on", sql: Prisma.sql`e."approvedAt"`, source: "event" },
  "event.closedAt": { label: "Closed on", sql: Prisma.sql`e."closedAt"`, source: "event" },
} satisfies Record<string, TimeFieldDef>);

// ─── Renames ─────────────────────────────────────────────────────────────────

/**
 * Old key → current key, for the day a rename cannot be avoided. Saved dashboards keep working
 * and nothing has to be migrated. Empty is the healthy state.
 */
export const ALIASES: Record<string, string> = Object.assign(Object.create(null), {});

// ─── Lookups ─────────────────────────────────────────────────────────────────

const resolveAlias = (key: string) => (Object.hasOwn(ALIASES, key) ? ALIASES[key] : key);

/**
 * Every lookup goes through `Object.hasOwn`. The registries are prototype-less, but a guard
 * here as well means a key like `"__proto__"` or `"constructor"` can never return a truthy
 * object whose `.sql` is `undefined` — which `Prisma.sql` would splice in as a bare `NULL`.
 */
export const lookupDimension = (key: string): DimensionDef | undefined => {
  const k = resolveAlias(key);
  return Object.hasOwn(DIMENSIONS, k) ? DIMENSIONS[k] : undefined;
};
export const lookupMetric = (key: string): MetricDef | undefined => {
  const k = resolveAlias(key);
  return Object.hasOwn(METRICS, k) ? METRICS[k] : undefined;
};
export const lookupFilter = (key: string): FilterDef | undefined => {
  const k = resolveAlias(key);
  return Object.hasOwn(FILTERS, k) ? FILTERS[k] : undefined;
};
export const lookupTimeField = (key: string): TimeFieldDef | undefined => {
  const k = resolveAlias(key);
  return Object.hasOwn(TIME_FIELDS, k) ? TIME_FIELDS[k] : undefined;
};

/** The enum-array cast for a filter, or null when the filter is not an enum. */
export const enumArrayCast = (def: FilterDef): Prisma.Sql | null =>
  def.enumType ? ENUM_ARRAY[def.enumType] : null;

// ─── Catalogue for the builder UI ────────────────────────────────────────────

export type CatalogueEntry = {
  key: string;
  label: string;
  group: string;
  help?: string;
  source: FactSource;
  format?: NumberFormat;
  money?: boolean;
};

/**
 * The plain, serialisable description of the registry, for the widget builder's dropdowns. Only
 * this crosses to the client — never a `Prisma.Sql`, which would drag the Prisma client into the
 * browser bundle.
 */
export function catalogue() {
  return {
    dimensions: Object.entries(DIMENSIONS).map(
      ([key, d]): CatalogueEntry => ({ key, label: d.label, group: d.group, source: d.source }),
    ),
    metrics: Object.entries(METRICS).map(
      ([key, m]): CatalogueEntry => ({
        key,
        label: m.label,
        group: m.group,
        help: m.help,
        source: m.source,
        format: m.format,
        money: m.money,
      }),
    ),
    filters: Object.entries(FILTERS).map(([key, f]) => ({
      key,
      label: f.label,
      group: f.group,
      source: f.source,
      kind: f.kind,
      members: f.members ?? null,
      ops: OPS_BY_KIND[f.kind],
    })),
    timeFields: Object.entries(TIME_FIELDS).map(([key, t]) => ({ key, label: t.label })),
  };
}
export type Catalogue = ReturnType<typeof catalogue>;
