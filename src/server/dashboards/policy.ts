/**
 * Who may put money on a dashboard widget.
 *
 * This is a governance decision, not a technical one, so it is a setting an administrator edits
 * rather than a line in the permission matrix. It lives in `AppSetting`, the same escape hatch
 * the approval policy uses, so changing it needs no migration.
 *
 * The default is the set of roles that already hold `reports.view` — Finance, Reporting,
 * Approvers and Admin — which keeps the existing boundary: aggregate spend is already visible to
 * everyone on the main dashboard, while per-event money is restricted to those roles.
 */
import "server-only";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ROLES, rolesWith, type Role } from "@/lib/permissions";

export const DASHBOARD_POLICY_KEY = "dashboard.policy";

export const dashboardPolicySchema = z.object({
  /** Roles allowed to build or view a widget that measures money. */
  moneyRoles: z
    .array(z.enum(ROLES))
    .max(ROLES.length)
    .default(() => [...rolesWith("reports.view")]),
});

export type DashboardPolicy = z.infer<typeof dashboardPolicySchema>;

export const DEFAULT_DASHBOARD_POLICY: DashboardPolicy = dashboardPolicySchema.parse({});

/**
 * Reads the policy. `safeParse` with a fallback, so a hand-edited or half-migrated row can never
 * throw on a page load — the same shape `getApprovalPolicy` uses.
 */
export async function getDashboardPolicy(db: PrismaClient): Promise<DashboardPolicy> {
  const row = await db.appSetting.findUnique({ where: { key: DASHBOARD_POLICY_KEY } });
  const parsed = dashboardPolicySchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : DEFAULT_DASHBOARD_POLICY;
}

export async function saveDashboardPolicy(
  db: PrismaClient,
  patch: Partial<DashboardPolicy>,
): Promise<DashboardPolicy> {
  const current = await getDashboardPolicy(db);
  const next = dashboardPolicySchema.parse({ ...current, ...patch });
  await db.appSetting.upsert({
    where: { key: DASHBOARD_POLICY_KEY },
    update: { value: next },
    create: { key: DASHBOARD_POLICY_KEY, value: next },
  });
  return next;
}

/**
 * Whether this viewer may see money figures.
 *
 * An administrator always may, whatever the setting says, so the policy can never be edited into
 * a state where nobody can fix it.
 */
export function canSeeMoney(roles: readonly Role[] | undefined, policy: DashboardPolicy): boolean {
  if (!roles?.length) return false;
  if (roles.includes("ADMIN")) return true;
  return policy.moneyRoles.some((role) => roles.includes(role));
}
