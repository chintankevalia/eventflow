/**
 * Dashboards: creating them, sharing them, cloning them, and moving widgets about.
 *
 * Access is decided here and nowhere else. A page or action asks `listDashboardsFor` or
 * `getDashboardFor`, which refuse rather than filter in the UI — the house rule that
 * authorization is enforced on the server in every query.
 */
import "server-only";
import { Prisma, type Dashboard, type DashboardWidget, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { resolveCollisions } from "@/lib/dashboard-layout";
import { can, ROLES, type Role } from "@/lib/permissions";
import { writeAudit } from "@/server/audit";
import {
  DEFAULT_SPEC,
  dashboardFiltersSchema,
  parseDashboardFilters,
  parseWidgetSpec,
  widgetSpecSchema,
} from "./spec";

type Meta = { ipAddress?: string | null };

/** Whoever is asking. Satisfied by `SessionUser`. */
export type Viewer = { id: string; name: string; roles: readonly Role[] };

export class DashboardError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

/** A dashboard may hold this many widgets. Ten aggregate queries a page load is already a lot. */
export const MAX_WIDGETS = 12;
/** And a person may keep this many dashboards, so the picker stays a picker. */
export const MAX_DASHBOARDS_PER_USER = 30;

// ─── Input ───────────────────────────────────────────────────────────────────

export const dashboardSchema = z.object({
  name: z.string().trim().min(3, "Name the dashboard.").max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
  visibility: z.enum(["PRIVATE", "ROLES", "EVERYONE"]).default("PRIVATE"),
  visibleRoles: z.array(z.enum(ROLES)).max(ROLES.length).default([]),
  filters: dashboardFiltersSchema.optional(),
});
export type DashboardInput = z.input<typeof dashboardSchema>;

/**
 * Widget geometry. `x` and `w` are in a 0–1000 space that scales with the canvas width, so a
 * layout keeps its proportions at any window size; `y` and `h` are pixels.
 */
export const geometrySchema = z.object({
  x: z.coerce.number().int().min(0).max(1000).default(0),
  y: z.coerce.number().int().min(0).max(20_000).default(0),
  w: z.coerce.number().int().min(80).max(1000).default(500),
  h: z.coerce.number().int().min(80).max(2000).default(260),
  z: z.coerce.number().int().min(0).max(999).default(0),
});

export const widgetSchema = geometrySchema.extend({
  title: z.string().trim().min(1, "Give the widget a title.").max(120),
  spec: widgetSpecSchema,
});
export type WidgetInput = z.input<typeof widgetSchema>;

/** Bulk geometry save, for a drag or resize on the canvas. */
export const layoutSchema = z
  .array(geometrySchema.extend({ id: z.string().min(1) }))
  .max(MAX_WIDGETS);

// ─── Access ──────────────────────────────────────────────────────────────────

type WithShares = Dashboard & { shares: { userId: string; canEdit: boolean }[] };

/** Can this viewer open the dashboard at all? */
export function canView(viewer: Viewer, dashboard: WithShares): boolean {
  if (dashboard.ownerId === viewer.id) return true;
  if (dashboard.isBuiltIn) return true;
  if (dashboard.visibility === "EVERYONE") return true;
  if (dashboard.visibility === "ROLES" && dashboard.visibleRoles.some((r) => viewer.roles.includes(r))) return true;
  return dashboard.shares.some((s) => s.userId === viewer.id);
}

/**
 * Can this viewer change it?
 *
 * The built-in Overview is editable by nobody, including an administrator — it is the one
 * dashboard that cannot be misconfigured, and the way to change it is to clone it.
 */
export function canEdit(viewer: Viewer, dashboard: WithShares): boolean {
  if (dashboard.isBuiltIn) return false;
  if (dashboard.ownerId === viewer.id) return true;
  return dashboard.shares.some((s) => s.userId === viewer.id && s.canEdit);
}

/** Only an administrator may push a dashboard at other people. */
function assertMayPublish(viewer: Viewer, visibility: string) {
  if (visibility === "PRIVATE") return;
  if (!can(viewer.roles, "dashboards.publish")) {
    throw new DashboardError(
      "Only an administrator can share a dashboard with everyone or with a role. You can still share it with individual people.",
      "visibility",
    );
  }
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export type DashboardSummary = {
  id: string;
  name: string;
  description: string | null;
  isBuiltIn: boolean;
  visibility: Dashboard["visibility"];
  ownerId: string;
  ownerName: string;
  widgetCount: number;
  mine: boolean;
  editable: boolean;
  updatedAt: Date;
};

/** Every dashboard this viewer may open, own first, then shared, then published. */
export async function listDashboardsFor(db: PrismaClient, viewer: Viewer): Promise<DashboardSummary[]> {
  const rows = await db.dashboard.findMany({
    where: {
      OR: [
        { ownerId: viewer.id },
        { isBuiltIn: true },
        { visibility: "EVERYONE" },
        { visibility: "ROLES", visibleRoles: { hasSome: [...viewer.roles] } },
        { shares: { some: { userId: viewer.id } } },
      ],
    },
    include: {
      owner: { select: { name: true } },
      shares: { select: { userId: true, canEdit: true } },
      _count: { select: { widgets: true } },
    },
    orderBy: [{ isBuiltIn: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
  });

  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    isBuiltIn: d.isBuiltIn,
    visibility: d.visibility,
    ownerId: d.ownerId,
    ownerName: d.owner.name,
    widgetCount: d._count.widgets,
    mine: d.ownerId === viewer.id,
    editable: canEdit(viewer, d),
    updatedAt: d.updatedAt,
  }));
}

export type LoadedDashboard = {
  dashboard: Dashboard;
  widgets: DashboardWidget[];
  editable: boolean;
  ownerName: string;
};

/** One dashboard with its widgets, or null when this viewer may not see it. */
export async function getDashboardFor(
  db: PrismaClient,
  viewer: Viewer,
  id: string,
): Promise<LoadedDashboard | null> {
  const dashboard = await db.dashboard.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true } },
      shares: { select: { userId: true, canEdit: true } },
      widgets: { orderBy: [{ z: "asc" }, { y: "asc" }, { x: "asc" }] },
    },
  });
  if (!dashboard || !canView(viewer, dashboard)) return null;
  const editable = canEdit(viewer, dashboard);
  // The share list and the owner's name are not part of the dashboard row itself, so they are
  // peeled off rather than passed on to the page as if they were columns.
  const { owner, widgets, ...rest } = dashboard;
  const { shares, ...row } = rest;
  void shares;
  return { dashboard: row as Dashboard, widgets, editable, ownerName: owner.name };
}

/** Loads for editing, throwing the same refusal whether it is missing or forbidden. */
async function forEditing(db: PrismaClient, viewer: Viewer, id: string) {
  const dashboard = await db.dashboard.findUnique({
    where: { id },
    include: { shares: { select: { userId: true, canEdit: true } } },
  });
  if (!dashboard || !canView(viewer, dashboard)) {
    throw new DashboardError("That dashboard could not be found.");
  }
  if (!canEdit(viewer, dashboard)) {
    throw new DashboardError(
      dashboard.isBuiltIn
        ? "The built-in Overview cannot be changed. Clone it and edit your copy."
        : "You can view this dashboard but not change it.",
    );
  }
  return dashboard;
}

// ─── Writing ─────────────────────────────────────────────────────────────────

export async function createDashboard(
  db: PrismaClient,
  actor: Viewer,
  input: DashboardInput,
  meta: Meta = {},
) {
  const data = dashboardSchema.parse(input);
  assertMayPublish(actor, data.visibility);

  const mine = await db.dashboard.count({ where: { ownerId: actor.id } });
  if (mine >= MAX_DASHBOARDS_PER_USER) {
    throw new DashboardError(`You already have ${MAX_DASHBOARDS_PER_USER} dashboards. Delete one first.`);
  }

  const dashboard = await db.dashboard.create({
    data: {
      name: data.name,
      description: data.description,
      ownerId: actor.id,
      visibility: data.visibility,
      visibleRoles: data.visibility === "ROLES" ? data.visibleRoles : [],
      filters: (data.filters ?? parseDashboardFilters({})) as Prisma.InputJsonValue,
    },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "dashboard.created",
    entityType: "Dashboard",
    entityId: dashboard.id,
    summary: `${actor.name} created dashboard "${dashboard.name}"`,
    ipAddress: meta.ipAddress,
  });
  return dashboard;
}

export async function updateDashboard(
  db: PrismaClient,
  actor: Viewer,
  id: string,
  input: DashboardInput,
  meta: Meta = {},
) {
  const existing = await forEditing(db, actor, id);
  const data = dashboardSchema.parse(input);
  if (data.visibility !== existing.visibility) assertMayPublish(actor, data.visibility);

  const dashboard = await db.dashboard.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      visibility: data.visibility,
      visibleRoles: data.visibility === "ROLES" ? data.visibleRoles : [],
      ...(data.filters ? { filters: data.filters as Prisma.InputJsonValue } : {}),
    },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: existing.visibility === data.visibility ? "dashboard.updated" : "dashboard.visibility_changed",
    entityType: "Dashboard",
    entityId: id,
    summary: `${actor.name} updated dashboard "${dashboard.name}"`,
    before: { visibility: existing.visibility, visibleRoles: existing.visibleRoles },
    after: { visibility: dashboard.visibility, visibleRoles: dashboard.visibleRoles },
    ipAddress: meta.ipAddress,
  });
  return dashboard;
}

/** Saves just the dashboard-level filter bar. */
export async function setDashboardFilters(
  db: PrismaClient,
  actor: Viewer,
  id: string,
  filters: unknown,
  meta: Meta = {},
) {
  await forEditing(db, actor, id);
  const parsed = dashboardFiltersSchema.parse(parseDashboardFilters(filters));
  await db.dashboard.update({ where: { id }, data: { filters: parsed as Prisma.InputJsonValue } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "dashboard.filters_changed",
    entityType: "Dashboard",
    entityId: id,
    summary: `${actor.name} changed the filters on a dashboard`,
    ipAddress: meta.ipAddress,
  });
  return parsed;
}

export async function deleteDashboard(db: PrismaClient, actor: Viewer, id: string, meta: Meta = {}) {
  const existing = await forEditing(db, actor, id);
  // Only the owner may delete; an editor with a share may change widgets but not destroy it.
  if (existing.ownerId !== actor.id) {
    throw new DashboardError("Only the owner can delete a dashboard.");
  }
  await db.dashboard.delete({ where: { id } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "dashboard.deleted",
    entityType: "Dashboard",
    entityId: id,
    summary: `${actor.name} deleted dashboard "${existing.name}"`,
    before: { name: existing.name },
    ipAddress: meta.ipAddress,
  });
}

/**
 * Copies a dashboard, widgets and all, into the viewer's own name.
 *
 * This is how the built-in Overview becomes a starting point rather than a dead end, and how
 * somebody takes a published dashboard and adapts it without touching the original.
 */
export async function cloneDashboard(db: PrismaClient, actor: Viewer, id: string, meta: Meta = {}) {
  const source = await db.dashboard.findUnique({
    where: { id },
    include: { shares: { select: { userId: true, canEdit: true } }, widgets: true },
  });
  if (!source || !canView(actor, source)) throw new DashboardError("That dashboard could not be found.");

  const mine = await db.dashboard.count({ where: { ownerId: actor.id } });
  if (mine >= MAX_DASHBOARDS_PER_USER) {
    throw new DashboardError(`You already have ${MAX_DASHBOARDS_PER_USER} dashboards. Delete one first.`);
  }

  const copy = await db.dashboard.create({
    data: {
      // A clone is always private and always owned by whoever cloned it, whatever the original
      // was — copying "visible to everyone" would publish by accident.
      name: `${source.name} (copy)`.slice(0, 120),
      description: source.description,
      ownerId: actor.id,
      visibility: "PRIVATE",
      visibleRoles: [],
      isBuiltIn: false,
      filters: source.filters as Prisma.InputJsonValue,
      widgets: {
        create: source.widgets.map((w) => ({
          title: w.title,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
          z: w.z,
          spec: w.spec as Prisma.InputJsonValue,
        })),
      },
    },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "dashboard.cloned",
    entityType: "Dashboard",
    entityId: copy.id,
    summary: `${actor.name} cloned dashboard "${source.name}"`,
    before: { sourceId: source.id },
    ipAddress: meta.ipAddress,
  });
  return copy;
}

// ─── Sharing ─────────────────────────────────────────────────────────────────

export async function shareDashboard(
  db: PrismaClient,
  actor: Viewer,
  id: string,
  userId: string,
  canEditToo: boolean,
  meta: Meta = {},
) {
  const dashboard = await forEditing(db, actor, id);
  if (userId === dashboard.ownerId) throw new DashboardError("The owner already has access.");
  const user = await db.user.findFirst({ where: { id: userId, status: { not: "DEACTIVATED" } } });
  if (!user) throw new DashboardError("That person could not be found.", "userId");

  await db.dashboardShare.upsert({
    where: { dashboardId_userId: { dashboardId: id, userId } },
    update: { canEdit: canEditToo },
    create: { dashboardId: id, userId, canEdit: canEditToo },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "dashboard.shared",
    entityType: "Dashboard",
    entityId: id,
    summary: `${actor.name} shared "${dashboard.name}" with ${user.name}${canEditToo ? " (can edit)" : ""}`,
    ipAddress: meta.ipAddress,
  });
}

export async function unshareDashboard(
  db: PrismaClient,
  actor: Viewer,
  id: string,
  userId: string,
  meta: Meta = {},
) {
  const dashboard = await forEditing(db, actor, id);
  await db.dashboardShare.deleteMany({ where: { dashboardId: id, userId } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "dashboard.unshared",
    entityType: "Dashboard",
    entityId: id,
    summary: `${actor.name} removed someone's access to "${dashboard.name}"`,
    ipAddress: meta.ipAddress,
  });
}

export async function listShares(db: PrismaClient, actor: Viewer, id: string) {
  const dashboard = await db.dashboard.findUnique({
    where: { id },
    include: { shares: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });
  if (!dashboard || !canEdit(actor, { ...dashboard, shares: dashboard.shares })) return [];
  return dashboard.shares.map((s) => ({
    userId: s.user.id,
    name: s.user.name,
    email: s.user.email,
    canEdit: s.canEdit,
  }));
}

// ─── Widgets ─────────────────────────────────────────────────────────────────

export async function addWidget(
  db: PrismaClient,
  actor: Viewer,
  dashboardId: string,
  input: WidgetInput,
  meta: Meta = {},
) {
  await forEditing(db, actor, dashboardId);
  const count = await db.dashboardWidget.count({ where: { dashboardId } });
  if (count >= MAX_WIDGETS) {
    throw new DashboardError(
      `A dashboard holds at most ${MAX_WIDGETS} widgets — each one is a query, and more than that makes the page slow.`,
    );
  }
  const data = widgetSchema.parse(input);
  const widget = await db.dashboardWidget.create({
    data: {
      dashboardId,
      title: data.title,
      x: data.x,
      y: data.y,
      w: data.w,
      h: data.h,
      z: data.z,
      spec: data.spec as Prisma.InputJsonValue,
    },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "dashboard.widget_added",
    entityType: "DashboardWidget",
    entityId: widget.id,
    summary: `${actor.name} added widget "${widget.title}"`,
    ipAddress: meta.ipAddress,
  });
  return widget;
}

export async function updateWidget(
  db: PrismaClient,
  actor: Viewer,
  widgetId: string,
  input: WidgetInput,
  meta: Meta = {},
) {
  const existing = await db.dashboardWidget.findUnique({ where: { id: widgetId } });
  if (!existing) throw new DashboardError("That widget could not be found.");
  await forEditing(db, actor, existing.dashboardId);

  const data = widgetSchema.parse(input);
  const widget = await db.dashboardWidget.update({
    where: { id: widgetId },
    data: {
      title: data.title,
      x: data.x,
      y: data.y,
      w: data.w,
      h: data.h,
      z: data.z,
      spec: data.spec as Prisma.InputJsonValue,
    },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "dashboard.widget_updated",
    entityType: "DashboardWidget",
    entityId: widgetId,
    summary: `${actor.name} changed widget "${widget.title}"`,
    before: { spec: existing.spec as Prisma.InputJsonValue },
    after: { spec: widget.spec as Prisma.InputJsonValue },
    ipAddress: meta.ipAddress,
  });
  return widget;
}

export async function deleteWidget(db: PrismaClient, actor: Viewer, widgetId: string, meta: Meta = {}) {
  const existing = await db.dashboardWidget.findUnique({ where: { id: widgetId } });
  if (!existing) return;
  await forEditing(db, actor, existing.dashboardId);
  await db.dashboardWidget.delete({ where: { id: widgetId } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "dashboard.widget_removed",
    entityType: "DashboardWidget",
    entityId: widgetId,
    summary: `${actor.name} removed widget "${existing.title}"`,
    ipAddress: meta.ipAddress,
  });
}

/**
 * Saves the whole canvas layout after a drag or resize.
 *
 * One statement per widget inside a transaction, because a half-saved layout is worse than an
 * unsaved one. No audit entry: moving a box is not a governance event, and one per drag would
 * bury the log.
 */
export async function saveLayout(db: PrismaClient, actor: Viewer, dashboardId: string, layout: unknown) {
  await forEditing(db, actor, dashboardId);
  const items = layoutSchema.parse(layout);
  const owned = await db.dashboardWidget.findMany({
    where: { dashboardId },
    select: { id: true, x: true, y: true, w: true, h: true, z: true },
  });
  const allowed = new Set(owned.map((w) => w.id));
  // Never trust the ids from the client: a widget from another dashboard must not be moved.
  const incoming = new Map(items.filter((i) => allowed.has(i.id)).map((i) => [i.id, i]));

  // The canvas already resolves overlaps as you drop, but a layout from an old tab or a crafted
  // request is not to be trusted to: settle the whole dashboard again, so no save can leave one
  // widget covering another.
  const settled = resolveCollisions(owned.map((w) => incoming.get(w.id) ?? w));
  const safe = settled.filter((w) => {
    const before = owned.find((o) => o.id === w.id)!;
    return incoming.has(w.id) || before.y !== w.y;
  });

  await db.$transaction(
    safe.map((i) =>
      db.dashboardWidget.update({
        where: { id: i.id },
        data: { x: i.x, y: i.y, w: i.w, h: i.h, z: i.z },
      }),
    ),
  );
  return safe.length;
}

// ─── The built-in Overview ───────────────────────────────────────────────────

/**
 * The seeded dashboard everybody starts from: the fixed page's own figures, expressed as
 * widgets so they can be read, cloned and pulled apart. Idempotent.
 */
export async function ensureBuiltInDashboard(db: PrismaClient, ownerId: string) {
  const existing = await db.dashboard.findFirst({ where: { isBuiltIn: true } });
  if (existing) return existing;

  const widget = (
    title: string,
    spec: Partial<typeof DEFAULT_SPEC>,
    x: number,
    y: number,
    w: number,
    h: number,
  ) => ({ title, x, y, w, h, z: 0, spec: parseWidgetSpec(spec) as Prisma.InputJsonValue });

  return db.dashboard.create({
    data: {
      name: "Overview",
      description: "Event pipeline, approvals and live department-wise spend.",
      ownerId,
      visibility: "EVERYONE",
      isBuiltIn: true,
      filters: parseDashboardFilters({}) as Prisma.InputJsonValue,
      widgets: {
        create: [
          widget("Total events", { view: "kpi", metrics: ["events.count"] }, 0, 0, 250, 120),
          widget("Pending approvals", { view: "kpi", metrics: ["approvals.pending"] }, 250, 0, 250, 120),
          widget("Budget utilisation", { view: "kpi", metrics: ["ratio.budgetUtilisation"] }, 500, 0, 250, 120),
          widget("Closed events", { view: "kpi", metrics: ["events.closed"] }, 750, 0, 250, 120),
          widget(
            "Events by stage",
            { view: "bar", metrics: ["events.count"], dimension: "event.lifecycle", sort: { by: "dimension", dir: "asc" } },
            0,
            130,
            500,
            300,
          ),
          widget(
            "Spend over time",
            { view: "area", metrics: ["money.estimated", "money.actual"], grain: "month", limit: 24 },
            500,
            130,
            500,
            300,
          ),
          widget(
            "Department spend",
            { view: "bar", metrics: ["money.estimated", "money.actual"], dimension: "event.department" },
            0,
            440,
            500,
            300,
          ),
          widget(
            "Events by region",
            { view: "donut", metrics: ["events.count"], dimension: "event.region" },
            500,
            440,
            500,
            300,
          ),
        ],
      },
    },
  });
}
