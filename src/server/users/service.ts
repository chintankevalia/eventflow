import { Prisma, type PrismaClient, type User } from "@prisma/client";
import { z } from "zod";
import { DEPARTMENTS, ROLES, ROLE_META, type Role } from "@/lib/permissions";
import { writeAudit } from "@/server/audit";
import { issueAuthToken } from "@/server/auth/service";
import { deleteUserSessions } from "@/server/auth/session-store";
import { inviteEmail, passwordResetEmail } from "@/server/mail/templates";
import { sendMail } from "@/server/mail/transport";

/** Admin user-management use-cases (Settings → Users). */

export type Actor = { id: string; name: string; email: string };
type Meta = { ipAddress?: string | null };

export const userInputSchema = z.object({
  name: z.string().trim().min(2, "Enter the full name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  jobTitle: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => v || null),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+\d][\d\s-]*$/, "Use digits, spaces, + or - only.")
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  // Required: this is what decides which events the person can see (src/server/access/policy.ts),
  // not just a profile detail — a user with no department set falls back to seeing only their
  // own events, which is confusing for anyone whose job needs the department's whole queue.
  department: z.enum(DEPARTMENTS, { message: "Choose a department." }),
  roles: z
    .array(z.enum(ROLES))
    .min(1, "Choose at least one role.")
    .transform((r) => [...new Set(r)]),
});
export type UserInput = z.input<typeof userInputSchema>;

export class UserServiceError extends Error {
  constructor(
    message: string,
    public field?: keyof UserInput,
  ) {
    super(message);
  }
}

const AUDIT_FIELDS = ["name", "email", "jobTitle", "phone", "department", "roles", "status"] as const;
function snapshot(user: Pick<User, (typeof AUDIT_FIELDS)[number]>) {
  return Object.fromEntries(AUDIT_FIELDS.map((f) => [f, user[f]])) as Prisma.InputJsonObject;
}

function describeRoles(roles: readonly Role[]) {
  return roles.map((r) => ROLE_META[r].label).join(", ");
}

async function activeAdminCount(db: PrismaClient | Prisma.TransactionClient, excludeUserId?: string) {
  return db.user.count({
    where: { status: "ACTIVE", roles: { has: "ADMIN" }, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
  });
}

async function sendInvite(db: PrismaClient, user: Pick<User, "id" | "email" | "name">, actor: Actor) {
  const { token, ttlMs } = await issueAuthToken(db, user.id, "INVITE");
  try {
    await sendMail(inviteEmail({ to: user.email, name: user.name, invitedBy: actor.name, token, ttlMs }));
    return { emailSent: true };
  } catch (err) {
    console.error("[mail] invite failed", err);
    return { emailSent: false };
  }
}

export async function inviteUser(db: PrismaClient, actor: Actor, input: UserInput, meta: Meta = {}) {
  const data = userInputSchema.parse(input);
  let user: User;
  try {
    user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { ...data, status: "INVITED", createdById: actor.id } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "user.invited",
        entityType: "User",
        entityId: created.id,
        summary: `${actor.name} invited ${created.name} (${created.email}) as ${describeRoles(created.roles)}`,
        after: snapshot(created),
        ipAddress: meta.ipAddress,
      });
      return created;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new UserServiceError("A user with this email already exists.", "email");
    }
    throw err;
  }
  const { emailSent } = await sendInvite(db, user, actor);
  return { user, emailSent };
}

export async function updateUser(db: PrismaClient, actor: Actor, userId: string, input: UserInput, meta: Meta = {}) {
  const data = userInputSchema.parse(input);
  return db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: userId } });
    if (!existing) throw new UserServiceError("User not found.");

    const losingAdmin = existing.roles.includes("ADMIN") && !data.roles.includes("ADMIN");
    if (losingAdmin && userId === actor.id) {
      throw new UserServiceError("You cannot remove your own Administrator role.", "roles");
    }
    if (losingAdmin && existing.status === "ACTIVE" && (await activeAdminCount(tx, userId)) === 0) {
      throw new UserServiceError("EventFlow needs at least one active Administrator.", "roles");
    }

    let updated: User;
    try {
      updated = await tx.user.update({ where: { id: userId }, data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new UserServiceError("A user with this email already exists.", "email");
      }
      throw err;
    }

    const changed = AUDIT_FIELDS.filter((f) => JSON.stringify(existing[f]) !== JSON.stringify(updated[f]));
    if (changed.length) {
      await writeAudit(tx, {
        actorId: actor.id,
        action: "user.updated",
        entityType: "User",
        entityId: userId,
        summary: `${actor.name} updated ${updated.name}: ${changed.join(", ")}`,
        before: snapshot(existing),
        after: snapshot(updated),
        ipAddress: meta.ipAddress,
      });
    }
    // Email or role changes take effect immediately: end existing sessions.
    if (changed.includes("email") || changed.includes("roles")) {
      if (userId !== actor.id) await tx.session.deleteMany({ where: { userId } });
      if (changed.includes("email")) {
        await tx.authToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
      }
    }
    return updated;
  });
}

export async function deactivateUser(db: PrismaClient, actor: Actor, userId: string, meta: Meta = {}) {
  if (userId === actor.id) throw new UserServiceError("You cannot deactivate your own account.");
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserServiceError("User not found.");
    if (user.status === "DEACTIVATED") return;
    if (user.roles.includes("ADMIN") && user.status === "ACTIVE" && (await activeAdminCount(tx, userId)) === 0) {
      throw new UserServiceError("EventFlow needs at least one active Administrator.");
    }
    await tx.user.update({ where: { id: userId }, data: { status: "DEACTIVATED" } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.authToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "user.deactivated",
      entityType: "User",
      entityId: userId,
      summary: `${actor.name} deactivated ${user.name} (${user.email})`,
      before: { status: user.status },
      after: { status: "DEACTIVATED" },
      ipAddress: meta.ipAddress,
    });
  });
}

export async function reactivateUser(db: PrismaClient, actor: Actor, userId: string, meta: Meta = {}) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new UserServiceError("User not found.");
  if (user.status !== "DEACTIVATED") return { status: user.status, emailSent: false };

  // Someone who never set a password goes back to "invited" and gets a fresh link.
  const status = user.passwordHash ? "ACTIVE" : "INVITED";
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status, failedLoginCount: 0 } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "user.reactivated",
      entityType: "User",
      entityId: userId,
      summary: `${actor.name} reactivated ${user.name} (${user.email})`,
      before: { status: "DEACTIVATED" },
      after: { status },
      ipAddress: meta.ipAddress,
    });
  });
  const { emailSent } = status === "INVITED" ? await sendInvite(db, user, actor) : { emailSent: false };
  return { status, emailSent };
}

export async function resendInvite(db: PrismaClient, actor: Actor, userId: string, meta: Meta = {}) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new UserServiceError("User not found.");
  if (user.status !== "INVITED")
    throw new UserServiceError("Only invited users who have not set a password yet can be re-invited.");
  const result = await sendInvite(db, user, actor);
  await writeAudit(db, {
    actorId: actor.id,
    action: "user.invite_resent",
    entityType: "User",
    entityId: userId,
    summary: `${actor.name} re-sent the invite to ${user.email}`,
    ipAddress: meta.ipAddress,
  });
  return result;
}

export async function sendResetLink(db: PrismaClient, actor: Actor, userId: string, meta: Meta = {}) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new UserServiceError("User not found.");
  if (user.status !== "ACTIVE") throw new UserServiceError("Password reset links can only be sent to active users.");
  const { token, ttlMs } = await issueAuthToken(db, user.id, "PASSWORD_RESET");
  let emailSent = true;
  await sendMail(passwordResetEmail({ to: user.email, name: user.name, token, ttlMs })).catch((err) => {
    console.error("[mail] reset failed", err);
    emailSent = false;
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "user.reset_link_sent",
    entityType: "User",
    entityId: userId,
    summary: `${actor.name} sent a password reset link to ${user.email}`,
    ipAddress: meta.ipAddress,
  });
  return { emailSent };
}

export async function forceSignOut(db: PrismaClient, actor: Actor, userId: string, meta: Meta = {}) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new UserServiceError("User not found.");
  const count = await deleteUserSessions(db, userId);
  await writeAudit(db, {
    actorId: actor.id,
    action: "user.signed_out",
    entityType: "User",
    entityId: userId,
    summary: `${actor.name} signed ${user.name} out of ${count} session${count === 1 ? "" : "s"}`,
    ipAddress: meta.ipAddress,
  });
  return { count };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export const userListFiltersSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  role: z.enum(ROLES).optional().catch(undefined),
  status: z.enum(["INVITED", "ACTIVE", "DEACTIVATED"]).optional().catch(undefined),
  department: z.enum(DEPARTMENTS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type UserListFilters = z.infer<typeof userListFiltersSchema>;
export const USERS_PAGE_SIZE = 25;

export async function listUsers(db: PrismaClient, filters: UserListFilters) {
  const where: Prisma.UserWhereInput = {
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" } },
            { email: { contains: filters.q, mode: "insensitive" } },
            { jobTitle: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(filters.role ? { roles: { has: filters.role } } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.department ? { department: filters.department } : {}),
  };
  const [total, users, counts] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip: (filters.page - 1) * USERS_PAGE_SIZE,
      take: USERS_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        jobTitle: true,
        department: true,
        roles: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    db.user.groupBy({ by: ["status"], _count: true }),
  ]);
  const statusCounts = Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<
    Record<User["status"], number>
  >;
  return { total, users, statusCounts, pageCount: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)) };
}

export async function getUserDetail(db: PrismaClient, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      jobTitle: true,
      phone: true,
      department: true,
      roles: true,
      status: true,
      lastLoginAt: true,
      failedLoginCount: true,
      passwordChangedAt: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { id: true, name: true } },
      _count: { select: { sessions: { where: { expiresAt: { gt: new Date() } } } } },
    },
  });
  if (!user) return null;
  const history = await db.auditLog.findMany({
    where: { OR: [{ entityType: "User", entityId: userId }, { actorId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      action: true,
      summary: true,
      createdAt: true,
      ipAddress: true,
      actor: { select: { name: true } },
    },
  });
  return { user, history };
}
