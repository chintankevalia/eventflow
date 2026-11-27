import "server-only";
import { notFound } from "next/navigation";
import type { WidgetData } from "@/components/dashboards/types";
import type { CanvasWidget } from "@/components/dashboards/canvas";
import { getAccessPolicy } from "@/server/access/policy";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/session";
import { canSeeMoney, getDashboardPolicy } from "@/server/dashboards/policy";
import { catalogue, type Catalogue } from "@/server/dashboards/registry";
import { runWidgets, type WidgetOutcome } from "@/server/dashboards/run";
import { parseDashboardFilters, parseWidgetSpec, withDashboardFilters } from "@/server/dashboards/spec";
import {
  ensureBuiltInDashboard,
  getDashboardFor,
  listDashboardsFor,
  listShares,
  type DashboardSummary,
} from "@/server/dashboards/service";

export type DashboardPageData = {
  viewer: { id: string; name: string; canPublish: boolean; canSeeMoney: boolean };
  dashboards: DashboardSummary[];
  current: {
    id: string;
    name: string;
    description: string | null;
    isBuiltIn: boolean;
    visibility: "PRIVATE" | "ROLES" | "EVERYONE";
    visibleRoles: string[];
    ownerName: string;
    editable: boolean;
    filters: ReturnType<typeof parseDashboardFilters>;
  };
  widgets: CanvasWidget[];
  catalogue: Catalogue;
  /** When the figures were read, so a reader is never guessing how fresh they are. */
  asOf: string;
  /** Who the current dashboard is shared with, and who it could be shared with. Editors only. */
  shares: { userId: string; name: string; email: string; canEdit: boolean }[];
  people: { id: string; name: string; email: string }[];
};

/** Turns one engine result into the shape a widget renders from. */
function toCanvasWidget(
  widget: { id: string; title: string; x: number; y: number; w: number; h: number; z: number; spec: unknown },
  outcome: WidgetOutcome,
): CanvasWidget {
  const spec = parseWidgetSpec(widget.spec);
  const base = {
    id: widget.id,
    title: widget.title,
    spec,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    z: widget.z,
  };

  if (!outcome.ok) {
    return { ...base, data: null, refusal: outcome.refusal, warnings: outcome.warnings, truncated: false, limit: spec.limit };
  }

  const data: WidgetData = {
    view: spec.view,
    metrics: outcome.plan.metrics.map((m) => ({ key: m.key, label: m.label, format: m.format })),
    dimensionLabel: outcome.plan.dimension?.label ?? null,
    seriesLabel: outcome.plan.series?.label ?? null,
    hasGrain: outcome.plan.grain !== "none",
    rows: outcome.rows,
    truncated: outcome.truncated,
    limit: outcome.plan.limit,
    target: spec.target,
  };
  return {
    ...base,
    data,
    warnings: outcome.warnings,
    truncated: outcome.truncated,
    limit: outcome.plan.limit,
    subtitle: subtitleFor(outcome.plan),
  };
}

/** "Approved cost by partner, by quarter" — so a widget says what it is without being opened. */
function subtitleFor(plan: { dimension: { label: string } | null; grain: string; metrics: { label: string }[] }) {
  const parts = [plan.metrics.map((m) => m.label).join(" and ")];
  if (plan.dimension) parts.push(`by ${plan.dimension.label.toLowerCase()}`);
  if (plan.grain !== "none") parts.push(`by ${plan.grain === "fy" ? "financial year" : plan.grain}`);
  return parts.join(", ");
}

/**
 * Everything the dashboard module needs for one page: the picker, the chosen dashboard, and the
 * figures for each of its widgets.
 *
 * Widgets run through `runWidgets`, which bounds how many queries are in flight — a bare
 * `Promise.all` over a dozen of them would exhaust Prisma's connection pool under modest load
 * and surface as an inscrutable pool timeout.
 */
export async function loadDashboardPage(id?: string): Promise<DashboardPageData> {
  const user = await requirePagePermission("dashboard.view");
  const viewer = { id: user.id, name: user.name, roles: user.roles, department: user.department };

  const policy = await getDashboardPolicy(db);
  const allowMoney = canSeeMoney(user.roles, policy);
  const accessPolicy = await getAccessPolicy(db);

  // The seeded Overview is created on first visit rather than by a migration, so it has a real
  // owner and a fresh install has something to look at.
  await ensureBuiltInDashboard(db, user.id).catch((err) => {
    // Never fatal: a failure here must not take the whole module down.
    console.error("Could not seed the built-in dashboard", err);
  });

  const dashboards = await listDashboardsFor(db, viewer);
  const targetId = id ?? dashboards[0]?.id;
  if (!targetId) notFound();

  const loaded = await getDashboardFor(db, viewer, targetId);
  if (!loaded) notFound();

  const filters = parseDashboardFilters(loaded.dashboard.filters);
  const specs = loaded.widgets.map((w) => withDashboardFilters(parseWidgetSpec(w.spec), filters));
  const outcomes = await runWidgets(db, specs, viewer, accessPolicy, { allowMoney });

  // Only an editor needs the sharing lists, so a reader's page does not carry a directory of
  // everyone in the company it has no use for.
  const [shares, people] = loaded.editable
    ? await Promise.all([
        listShares(db, viewer, loaded.dashboard.id),
        db.user.findMany({
          where: { status: { not: "DEACTIVATED" }, id: { not: loaded.dashboard.ownerId } },
          select: { id: true, name: true, email: true },
          orderBy: { name: "asc" },
          take: 200,
        }),
      ])
    : [[], []];

  return {
    viewer: {
      id: user.id,
      name: user.name,
      canPublish: user.roles.includes("ADMIN"),
      canSeeMoney: allowMoney,
    },
    dashboards,
    current: {
      id: loaded.dashboard.id,
      name: loaded.dashboard.name,
      description: loaded.dashboard.description,
      isBuiltIn: loaded.dashboard.isBuiltIn,
      visibility: loaded.dashboard.visibility,
      visibleRoles: loaded.dashboard.visibleRoles,
      ownerName: loaded.ownerName,
      editable: loaded.editable,
      filters,
    },
    widgets: loaded.widgets.map((w, i) => toCanvasWidget(w, outcomes[i])),
    catalogue: catalogue(),
    asOf: new Date().toISOString(),
    shares,
    people,
  };
}
