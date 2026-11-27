import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { can, type Permission } from "@/lib/permissions";
import { db } from "@/server/db";
import { AUTH } from "./config";
import { createSession, deleteSessionByToken, validateSessionToken, type SessionUser } from "./session-store";

/** Signed-in user and session for this request (memoised per request), or null. */
export const getCurrentSession = cache(async () => {
  const token = (await cookies()).get(AUTH.sessionCookie)?.value;
  if (!token) return null;
  return validateSessionToken(db, token);
});

export async function getCurrentUser(): Promise<SessionUser | null> {
  return (await getCurrentSession())?.user ?? null;
}

/** For pages and actions: redirects to sign-in when there is no valid session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export class ForbiddenError extends Error {
  constructor() {
    super("You do not have permission to do this.");
  }
}

/** For server actions: throws when the user lacks the permission. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.roles, permission)) throw new ForbiddenError();
  return user;
}

/** For pages: shows the 403 page when the user lacks the permission. */
export async function requirePagePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.roles, permission)) redirect("/forbidden");
  return user;
}

export async function startSession(userId: string, meta: { ipAddress?: string | null; userAgent?: string | null }) {
  const { token, expiresAt } = await createSession(db, userId, meta);
  (await cookies()).set(AUTH.sessionCookie, token, {
    httpOnly: true,
    secure: AUTH.secureCookies,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(AUTH.sessionCookie)?.value;
  if (token) await deleteSessionByToken(db, token);
  jar.delete(AUTH.sessionCookie);
}

export type { SessionUser };
