import { effectiveRoles } from "@/lib/permissions";
import type { PrismaClient } from "@prisma/client";
import { AUTH } from "./config";
import { generateToken, hashToken } from "./tokens";

/** Database side of sessions, free of Next.js APIs so it can be unit tested. */

export async function createSession(
  db: PrismaClient,
  userId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
  now = new Date(),
) {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + AUTH.sessionAbsoluteMs);
  await db.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt,
      lastSeenAt: now,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
  return { token, expiresAt };
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  roles: import("@/lib/permissions").Role[];
  department: import("@/lib/permissions").Department | null;
  jobTitle: string | null;
  /** The welcome-tour state (src/lib/tour-content.ts) — read on every request so the portal
   * layout can decide whether to auto-start it, without a second query. */
  tourDismissed: boolean;
  tourSeenSections: string[];
};

/** Returns the signed-in user for a raw session token, or null if the session is missing, expired, idle or the user is inactive. */
export async function validateSessionToken(
  db: PrismaClient,
  token: string,
  now = new Date(),
): Promise<{ user: SessionUser; sessionId: string } | null> {
  const id = hashToken(token);
  const session = await db.session.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          roles: true,
          department: true,
          jobTitle: true,
          status: true,
          tourDismissed: true,
          tourSeenSections: true,
        },
      },
    },
  });
  if (!session) return null;

  const idleExpired = now.getTime() - session.lastSeenAt.getTime() > AUTH.sessionIdleMs;
  if (session.expiresAt <= now || idleExpired || session.user.status !== "ACTIVE") {
    await db.session.deleteMany({ where: { id } });
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() > AUTH.sessionTouchMs) {
    await db.session.update({ where: { id }, data: { lastSeenAt: now } }).catch(() => {});
  }

  const { id: userId, email, name, roles, department, jobTitle, tourDismissed, tourSeenSections } = session.user;
  return {
    user: { id: userId, email, name, roles: effectiveRoles(roles, department), department, jobTitle, tourDismissed, tourSeenSections },
    sessionId: id,
  };
}

export async function deleteSessionByToken(db: PrismaClient, token: string) {
  await db.session.deleteMany({ where: { id: hashToken(token) } });
}

export async function deleteUserSessions(db: PrismaClient, userId: string) {
  const { count } = await db.session.deleteMany({ where: { userId } });
  return count;
}
