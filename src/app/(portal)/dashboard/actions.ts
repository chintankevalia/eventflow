"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { flattenErrors } from "@/lib/form-errors";
import { ROLES, type Role } from "@/lib/permissions";
import { getAccessPolicy } from "@/server/access/policy";
import { ForbiddenError, requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getRequestContext } from "@/server/request-context";
import { canSeeMoney, getDashboardPolicy } from "@/server/dashboards/policy";
import { lookupMetric } from "@/server/dashboards/registry";
import { parseDashboardFilters, parseWidgetSpec, withDashboardFilters } from "@/server/dashboards/spec";
import { runWidget } from "@/server/dashboards/run";
import type { WidgetData } from "@/components/dashboards/types";
import {
  addWidget,
  cloneDashboard,
  createDashboard,
  DashboardError,
  deleteDashboard,
  deleteWidget,
  getDashboardFor,
  saveLayout,
  setDashboardFilters,
  shareDashboard,
  unshareDashboard,
  updateDashboard,
  updateWidget,
} from "@/server/dashboards/service";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; success?: string };
export type ActionResult = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

function toResult(err: unknown): ActionResult {
  if (err instanceof ZodError) return { ok: false, fieldErrors: flattenErrors(err) };
  if (err instanceof DashboardError) {
    return { ok: false, message: err.message, ...(err.field ? { fieldErrors: { [err.field]: err.message } } : {}) };
  }
  if (err instanceof ForbiddenError) return { ok: false, message: err.message };
  console.error(err);
  return { ok: false, message: "Something went wrong. Please try again." };
}

function toState(err: unknown): FormState {
  const result = toResult(err);
  return { error: result.message, fieldErrors: result.fieldErrors };
}

const refresh = (id?: string) => {
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/dashboard/${id}`);
};

/** The viewer, in the shape the service expects. */
async function actor() {
  const user = await requirePermission("dashboards.create");
  return { id: user.id, name: user.name, roles: user.roles, department: user.department };
}

/** Form fields are untrusted strings, so an unknown role is dropped rather than throwing. */
const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);
const rolesFrom = (formData: FormData) => formData.getAll("visibleRoles").map(String).filter(isRole);

/** Visibility likewise: anything unexpected falls back to the private, safe choice. */
function visibilityFrom(formData: FormData): "PRIVATE" | "ROLES" | "EVERYONE" {
  const value = String(formData.get("visibility") ?? "PRIVATE");
  return value === "ROLES" || value === "EVERYONE" ? value : "PRIVATE";
}

/**
 * Refuses a spec that measures money when the viewer's role may not see it.
 *
 * The builder already hides those measures, but a spec can arrive from a stale page or a crafted
 * request, and the engine's own check only governs *reading*. Blocking the write as well means a
 * widget nobody may look at never gets saved in the first place.
 */
async function assertMoneyAllowed(roles: readonly string[], spec: unknown) {
  const policy = await getDashboardPolicy(db);
  if (canSeeMoney(roles as never, policy)) return;
  const parsed = parseWidgetSpec(spec);
  const money = parsed.metrics.map(lookupMetric).filter((m) => m?.money);
  if (money.length) {
    throw new DashboardError("Your role cannot put budget figures on a dashboard.", "spec");
  }
}

// ─── Dashboards ──────────────────────────────────────────────────────────────

export async function createDashboardAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    const me = await actor();
    const dashboard = await createDashboard(
      db,
      me,
      {
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        visibility: visibilityFrom(formData),
        visibleRoles: rolesFrom(formData),
      },
      await getRequestContext(),
    );
    id = dashboard.id;
  } catch (err) {
    return toState(err);
  }
  refresh();
  redirect(`/dashboard/${id}`);
}

export async function updateDashboardAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const me = await actor();
    await updateDashboard(
      db,
      me,
      id,
      {
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        visibility: visibilityFrom(formData),
        visibleRoles: rolesFrom(formData),
      },
      await getRequestContext(),
    );
  } catch (err) {
    return toState(err);
  }
  refresh(id);
  return { success: "Dashboard saved." };
}

export async function deleteDashboardAction(id: string): Promise<ActionResult> {
  try {
    await deleteDashboard(db, await actor(), id, await getRequestContext());
  } catch (err) {
    return toResult(err);
  }
  refresh();
  return { ok: true, message: "Dashboard deleted." };
}

export async function cloneDashboardAction(id: string): Promise<ActionResult & { id?: string }> {
  let copy;
  try {
    copy = await cloneDashboard(db, await actor(), id, await getRequestContext());
  } catch (err) {
    return toResult(err);
  }
  refresh();
  return { ok: true, id: copy.id, message: `Copied as "${copy.name}".` };
}

export async function setFiltersAction(id: string, filters: unknown): Promise<ActionResult> {
  try {
    await setDashboardFilters(db, await actor(), id, filters, await getRequestContext());
  } catch (err) {
    return toResult(err);
  }
  refresh(id);
  return { ok: true };
}

// ─── Sharing ─────────────────────────────────────────────────────────────────

export async function shareAction(id: string, userId: string, canEdit: boolean): Promise<ActionResult> {
  try {
    await shareDashboard(db, await actor(), id, userId, canEdit, await getRequestContext());
  } catch (err) {
    return toResult(err);
  }
  refresh(id);
  return { ok: true, message: "Shared." };
}

export async function unshareAction(id: string, userId: string): Promise<ActionResult> {
  try {
    await unshareDashboard(db, await actor(), id, userId, await getRequestContext());
  } catch (err) {
    return toResult(err);
  }
  refresh(id);
  return { ok: true, message: "Access removed." };
}

// ─── Widgets ─────────────────────────────────────────────────────────────────

export async function addWidgetAction(dashboardId: string, input: unknown): Promise<ActionResult> {
  try {
    const me = await actor();
    const payload = input as { title?: string; spec?: unknown; x?: number; y?: number; w?: number; h?: number };
    await assertMoneyAllowed(me.roles, payload.spec);
    await addWidget(
      db,
      me,
      dashboardId,
      {
        title: String(payload.title ?? "Untitled widget"),
        spec: parseWidgetSpec(payload.spec),
        x: payload.x ?? 0,
        y: payload.y ?? 0,
        w: payload.w ?? 500,
        h: payload.h ?? 300,
        z: 0,
      },
      await getRequestContext(),
    );
  } catch (err) {
    return toResult(err);
  }
  refresh(dashboardId);
  return { ok: true, message: "Widget added." };
}

export async function updateWidgetAction(
  dashboardId: string,
  widgetId: string,
  input: unknown,
): Promise<ActionResult> {
  try {
    const me = await actor();
    const payload = input as { title?: string; spec?: unknown; x: number; y: number; w: number; h: number; z: number };
    await assertMoneyAllowed(me.roles, payload.spec);
    await updateWidget(
      db,
      me,
      widgetId,
      {
        title: String(payload.title ?? "Untitled widget"),
        spec: parseWidgetSpec(payload.spec),
        x: payload.x,
        y: payload.y,
        w: payload.w,
        h: payload.h,
        z: payload.z,
      },
      await getRequestContext(),
    );
  } catch (err) {
    return toResult(err);
  }
  refresh(dashboardId);
  return { ok: true, message: "Widget saved." };
}

export async function deleteWidgetAction(dashboardId: string, widgetId: string): Promise<ActionResult> {
  try {
    await deleteWidget(db, await actor(), widgetId, await getRequestContext());
  } catch (err) {
    return toResult(err);
  }
  refresh(dashboardId);
  return { ok: true, message: "Widget removed." };
}

/**
 * Runs a spec without saving it, so the builder shows the real figures before you commit.
 *
 * Deliberately the same code path as a saved widget — including the money check and the fan-out
 * refusals — so what the preview says is what the widget will do. A preview that used a
 * shortcut would be worth less than no preview.
 */
export async function previewWidgetAction(
  dashboardId: string,
  spec: unknown,
): Promise<
  | { ok: true; data: WidgetData }
  | { ok: false; refusal: string }
> {
  try {
    const me = await actor();
    // Honour the dashboard's own filter bar, so the preview matches its surroundings.
    const dashboard = await getDashboardFor(db, me, dashboardId);
    if (!dashboard) return { ok: false, refusal: "That dashboard could not be found." };

    const policy = await getDashboardPolicy(db);
    const accessPolicy = await getAccessPolicy(db);
    const parsed = withDashboardFilters(parseWidgetSpec(spec), parseDashboardFilters(dashboard.dashboard.filters));
    const outcome = await runWidget(db, parsed, me, accessPolicy, { allowMoney: canSeeMoney(me.roles, policy) });
    if (!outcome.ok) return { ok: false, refusal: outcome.refusal };

    return {
      ok: true,
      data: {
        view: parsed.view,
        metrics: outcome.plan.metrics.map((m) => ({ key: m.key, label: m.label, format: m.format })),
        dimensionLabel: outcome.plan.dimension?.label ?? null,
        seriesLabel: outcome.plan.series?.label ?? null,
        hasGrain: outcome.plan.grain !== "none",
        rows: outcome.rows,
        truncated: outcome.truncated,
        limit: outcome.plan.limit,
        target: parsed.target,
      },
    };
  } catch (err) {
    const result = toResult(err);
    return { ok: false, refusal: result.message ?? "This widget could not be previewed." };
  }
}

/**
 * Saves the canvas after a drag.
 *
 * No `revalidatePath`: the client already shows the new positions, and re-rendering the server
 * component would re-run every widget's query on every drop.
 */
export async function saveLayoutAction(dashboardId: string, layout: unknown): Promise<ActionResult> {
  try {
    await saveLayout(db, await actor(), dashboardId, layout);
  } catch (err) {
    return toResult(err);
  }
  return { ok: true };
}
