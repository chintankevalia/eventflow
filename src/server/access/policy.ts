/**
 * Which events a department may see.
 *
 * "Role decides what you can *do* — raise, approve, administer. Department decides which
 * *events* you can see." The business asked for Sales, Marketing, Channel and Finance to be
 * departments, not separate user types, with visibility configurable by an administrator rather
 * than hardcoded — this is that setting, stored in `AppSetting` like the approval and dashboard
 * policies, so it changes with no deploy and no migration.
 *
 * Defaults: Sales sees Sales events, Marketing sees Marketing events, and Channel, Finance and
 * Management see every department — Channel because it reviews every request regardless of
 * where it came from (the new Stage 1), Finance because it tracks spend company-wide, and
 * Management because that is what an executive view means. A department with no events of its
 * own (`OTHER`) defaults to seeing only `OTHER`, the same narrow pattern as Sales and Marketing.
 */
import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { DEPARTMENTS, type Department, type Role } from "@/lib/permissions";

export const ACCESS_POLICY_KEY = "access.policy";

/** Every department (`["SALES", "CHANNEL"]`), or every department at once (`"ALL"`). */
const departmentVisibilitySchema = z.union([z.literal("ALL"), z.array(z.enum(DEPARTMENTS)).max(DEPARTMENTS.length)]);
export type DepartmentVisibility = z.infer<typeof departmentVisibilitySchema>;

const visibleToSchema = z.object({
  SALES: departmentVisibilitySchema.default(["SALES"]),
  MARKETING: departmentVisibilitySchema.default(["MARKETING"]),
  CHANNEL: departmentVisibilitySchema.default("ALL"),
  FINANCE: departmentVisibilitySchema.default("ALL"),
  MANAGEMENT: departmentVisibilitySchema.default("ALL"),
  OTHER: departmentVisibilitySchema.default(["OTHER"]),
});

export const accessPolicySchema = z.object({
  /** Keyed by the *viewer's* department; the value is which event departments they may see. */
  visibleTo: visibleToSchema.default(() => visibleToSchema.parse({})),
});
export type AccessPolicy = z.infer<typeof accessPolicySchema>;

export const DEFAULT_ACCESS_POLICY: AccessPolicy = accessPolicySchema.parse({});

/** Reads the policy. `safeParse` with a fallback, so a hand-edited row can never throw on read. */
export async function getAccessPolicy(db: PrismaClient): Promise<AccessPolicy> {
  const row = await db.appSetting.findUnique({ where: { key: ACCESS_POLICY_KEY } });
  const parsed = accessPolicySchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : DEFAULT_ACCESS_POLICY;
}

export async function saveAccessPolicy(
  db: PrismaClient,
  visibleTo: Partial<Record<Department, DepartmentVisibility>>,
): Promise<AccessPolicy> {
  const current = await getAccessPolicy(db);
  const next = accessPolicySchema.parse({ visibleTo: { ...current.visibleTo, ...visibleTo } });
  await db.appSetting.upsert({
    where: { key: ACCESS_POLICY_KEY },
    update: { value: next },
    create: { key: ACCESS_POLICY_KEY, value: next },
  });
  return next;
}

/**
 * The event departments this viewer's own department may see, or `null` for a viewer with no
 * department set — which grants nothing beyond what role and personal involvement already give
 * them (see `eventVisibilityWhere`). Every active user today has a department; this only matters
 * if one is ever created without picking one, since the field is technically still optional.
 */
export function visibleDepartmentsFor(
  viewerDepartment: Department | null | undefined,
  policy: AccessPolicy,
): DepartmentVisibility | null {
  if (!viewerDepartment) return null;
  return policy.visibleTo[viewerDepartment];
}

/** Just enough of a signed-in user to decide what they may see. */
export type Viewer = { id: string; roles: readonly Role[]; department: Department | null };

/**
 * Which events this viewer may see at all, as a Prisma filter — the single predicate every event
 * read in the app is meant to be ANDed with (the register, exports, the event page, approvals,
 * attachment downloads, dashboards, reports).
 *
 * Three things always win over the department policy, because restricting them would break the
 * product rather than secure it:
 *
 *  - **An administrator sees everything.** The policy itself is admin-configurable, so an admin
 *    who could not see an event could not fix a misconfigured policy either.
 *  - **You always see your own events** — as requester, owner or manager — wherever they were
 *    filed. A Marketing requester whose event was classified under Channel must still be able to
 *    open and track the thing they raised; "Channel reviews everything" was never meant to mean
 *    "Marketing can lose sight of its own request."
 *  - **You always see an event you are currently assigned to decide.** Akshay, Mitul and Amit
 *    sir need every event awaiting their stage, not just the ones in their own department —
 *    that is the entire point of a cross-department approval chain.
 *
 * Below that, visibility follows the viewer's own department: `"ALL"` imposes no restriction at
 * all (the function returns `{}`, Prisma's "match everything"), a list restricts to exactly
 * those event departments, and no department at all (only possible if a user is ever created
 * without picking one — today none are) grants nothing beyond the three overrides above.
 */
export function eventVisibilityWhere(viewer: Viewer, policy: AccessPolicy): Prisma.EventWhereInput {
  if (viewer.roles.includes("ADMIN")) return {};

  const allowed = visibleDepartmentsFor(viewer.department, policy);
  if (allowed === "ALL") return {};

  return {
    OR: [
      { requesterId: viewer.id },
      { ownerId: viewer.id },
      { managerId: viewer.id },
      {
        approvalRounds: {
          some: { status: "PENDING", currentStage: { approvers: { some: { userId: viewer.id } } } },
        },
      },
      // Sales decides go / no-go on every new event, whatever its department, so they must see
      // the ones waiting for them and the ones they decided (src/server/events/sales-review.ts).
      ...(viewer.department === "SALES"
        ? [{ salesReviewStatus: "PENDING" } satisfies Prisma.EventWhereInput, { salesReview: { reviewedById: viewer.id } }]
        : []),
      ...(allowed?.length ? [{ department: { in: allowed } } satisfies Prisma.EventWhereInput] : []),
    ],
  };
}

/**
 * The same predicate as {@link eventVisibilityWhere}, as a raw-SQL fragment for the dashboard
 * engine's `compileWidget` — which builds its own parameterised `Prisma.sql` statements rather
 * than going through the Prisma Client's query builder, so the two can never be expressed as one
 * function. `null` means "no restriction", matching `{}` on the Client side, so a caller can skip
 * adding a clause at all rather than push a no-op `TRUE` into its `WHERE`.
 *
 * Every value here is a `${}` interpolation — the viewer's id, their visible departments — never
 * a `Prisma.raw` built from either; only the enum array cast is a literal, same rule the registry
 * itself holds every identifier to. Assumes the event table is aliased `e`, as `compileWidget`
 * always aliases it.
 */
export function eventVisibilitySql(viewer: Viewer, policy: AccessPolicy): Prisma.Sql | null {
  if (viewer.roles.includes("ADMIN")) return null;

  const allowed = visibleDepartmentsFor(viewer.department, policy);
  if (allowed === "ALL") return null;

  const clauses = [
    Prisma.sql`e."requesterId" = ${viewer.id}`,
    Prisma.sql`e."ownerId" = ${viewer.id}`,
    Prisma.sql`e."managerId" = ${viewer.id}`,
    Prisma.sql`EXISTS (
      SELECT 1 FROM "approval_rounds" ar
      JOIN "approval_stage_approvers" asa ON asa."stageId" = ar."currentStageId"
      WHERE ar."eventId" = e."id" AND ar."status" = 'PENDING' AND asa."userId" = ${viewer.id}
    )`,
    ...(viewer.department === "SALES"
      ? [
          Prisma.sql`e."salesReviewStatus" = 'PENDING'`,
          Prisma.sql`EXISTS (SELECT 1 FROM "sales_reviews" sr WHERE sr."eventId" = e."id" AND sr."reviewedById" = ${viewer.id})`,
        ]
      : []),
    ...(allowed?.length ? [Prisma.sql`e."department" = ANY(${allowed}::"Department"[])`] : []),
  ];
  return Prisma.sql`(${Prisma.join(clauses, " OR ")})`;
}
