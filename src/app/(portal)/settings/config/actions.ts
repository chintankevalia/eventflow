"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import type { LookupKind } from "@prisma/client";
import { flattenErrors } from "@/lib/form-errors";
import { ForbiddenError, requirePermission } from "@/server/auth/session";
import { ConfigError } from "@/server/config/lookups";
import { createLookupItem, updateLookupItem } from "@/server/config/lookups";
import {
  addSubtype,
  createEventType,
  createExpenseCategory,
  setExpenseCategoryActive,
  setSubtypeActive,
  updateEventType,
} from "@/server/config/event-types";
import { db } from "@/server/db";
import { getRequestContext } from "@/server/request-context";
import { ROLES, type Role } from "@/lib/permissions";
import { writeAudit } from "@/server/audit";
import { DASHBOARD_POLICY_KEY, saveDashboardPolicy } from "@/server/dashboards/policy";
import { ACCESS_POLICY_KEY, saveAccessPolicy, type DepartmentVisibility } from "@/server/access/policy";
import { DEPARTMENTS, type Department } from "@/lib/permissions";

export type ActionResult = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

function toResult(err: unknown): ActionResult {
  if (err instanceof ZodError) return { ok: false, fieldErrors: flattenErrors(err) };
  if (err instanceof ConfigError)
    return { ok: false, message: err.message, fieldErrors: err.field ? { [err.field]: err.message } : undefined };
  if (err instanceof ForbiddenError) return { ok: false, message: err.message };
  console.error(err);
  return { ok: false, message: "Something went wrong. Please try again." };
}

const refresh = () => {
  revalidatePath("/settings/config");
  revalidatePath("/settings/form-fields");
};

// ─── Lookups ─────────────────────────────────────────────────────────────────

export async function addLookupAction(kind: LookupKind, label: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    await createLookupItem(db, actor, kind, { label }, await getRequestContext());
    refresh();
    return { ok: true, message: "Added." };
  } catch (err) {
    return toResult(err);
  }
}

export async function toggleLookupAction(id: string, active: boolean): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    await updateLookupItem(db, actor, id, { active }, await getRequestContext());
    refresh();
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function renameLookupAction(id: string, label: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    await updateLookupItem(db, actor, id, { label }, await getRequestContext());
    refresh();
    return { ok: true, message: "Renamed." };
  } catch (err) {
    return toResult(err);
  }
}

// ─── Event types & subtypes ──────────────────────────────────────────────────

export async function addEventTypeAction(name: string, needsPartner: boolean): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    await createEventType(db, actor, { name, needsPartner }, await getRequestContext());
    refresh();
    return { ok: true, message: "Event type added." };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateEventTypeAction(
  id: string,
  patch: { name?: string; needsPartner?: boolean; active?: boolean },
): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    await updateEventType(db, actor, id, patch, await getRequestContext());
    refresh();
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function addSubtypeAction(eventTypeId: string, name: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    await addSubtype(db, actor, eventTypeId, name, await getRequestContext());
    refresh();
    return { ok: true, message: "Subtype added." };
  } catch (err) {
    return toResult(err);
  }
}

export async function toggleSubtypeAction(id: string, active: boolean): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    await setSubtypeActive(db, actor, id, active, await getRequestContext());
    refresh();
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

// ─── Expense categories ──────────────────────────────────────────────────────

export async function addExpenseCategoryAction(name: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    await createExpenseCategory(db, actor, name, await getRequestContext());
    refresh();
    return { ok: true, message: "Category added." };
  } catch (err) {
    return toResult(err);
  }
}

export async function toggleExpenseCategoryAction(id: string, active: boolean): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    await setExpenseCategoryActive(db, actor, id, active, await getRequestContext());
    refresh();
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Which roles may put budget figures on a dashboard.
 *
 * A setting rather than a permission, because who sees money is a governance decision the
 * business owns. `ADMIN` is always allowed by `canSeeMoney`, so it is not stored here.
 */
export async function saveDashboardMoneyRolesAction(roles: string[]): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    const allowed = roles.filter((r): r is Role => (ROLES as readonly string[]).includes(r));
    await saveDashboardPolicy(db, { moneyRoles: allowed });
    const meta = await getRequestContext();
    await writeAudit(db, {
      actorId: actor.id,
      action: "dashboard.money_roles_changed",
      entityType: "AppSetting",
      entityId: DASHBOARD_POLICY_KEY,
      summary: `${actor.name} set which roles see budget figures on dashboards`,
      after: { moneyRoles: allowed },
      ipAddress: meta.ipAddress,
    });
  } catch (err) {
    return toResult(err);
  }
  revalidatePath("/settings/config");
  revalidatePath("/dashboard");
  return { ok: true };
}

// ─── Department visibility ────────────────────────────────────────────────────

/**
 * Which event departments each viewer department may see. Takes the whole map rather than one
 * row at a time, because the panel's "Save" button commits every row together — a partial save
 * would leave the grid showing changes that were not actually applied.
 */
export async function saveAccessPolicyAction(
  visibleTo: Record<string, DepartmentVisibility>,
): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    const patch: Partial<Record<Department, DepartmentVisibility>> = {};
    for (const dept of DEPARTMENTS) if (dept in visibleTo) patch[dept] = visibleTo[dept];
    const next = await saveAccessPolicy(db, patch);
    const meta = await getRequestContext();
    await writeAudit(db, {
      actorId: actor.id,
      action: "access.policy_changed",
      entityType: "AppSetting",
      entityId: ACCESS_POLICY_KEY,
      summary: `${actor.name} changed which events each department can see`,
      after: next.visibleTo,
      ipAddress: meta.ipAddress,
    });
  } catch (err) {
    return toResult(err);
  }
  revalidatePath("/settings/config");
  revalidatePath("/events");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
  return { ok: true };
}
