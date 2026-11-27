import type { AuthTokenType, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/server/audit";
import { sendMail } from "@/server/mail/transport";
import { passwordChangedEmail, passwordResetEmail } from "@/server/mail/templates";
import { AUTH, RATE_LIMITS } from "./config";
import { burnPasswordCheck, checkPasswordPolicy, hashPassword, verifyPassword } from "./password";
import { clearRateLimit, hitRateLimit, peekRateLimit } from "./rate-limit";
import { deleteUserSessions } from "./session-store";
import { generateToken, hashToken } from "./tokens";

/**
 * Authentication use-cases. Framework-free: callers pass the database and request metadata,
 * and the Next.js layer (actions) handles cookies and redirects.
 */

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

type Meta = { ipAddress?: string | null; userAgent?: string | null };

export type LoginResult = { ok: true; userId: string } | { ok: false; reason: "invalid" | "locked" | "rate_limited" };

export async function authenticate(
  db: PrismaClient,
  emailInput: string,
  password: string,
  meta: Meta,
): Promise<LoginResult> {
  const email = normaliseEmail(emailInput);
  const ipKey = `login:ip:${meta.ipAddress ?? "unknown"}`;
  const emailKey = `login:email:${email}`;

  const ip = await hitRateLimit(db, ipKey, RATE_LIMITS.loginPerIp);
  if (!ip.allowed) return { ok: false, reason: "rate_limited" };

  const lock = await peekRateLimit(db, emailKey, RATE_LIMITS.loginFailuresPerEmail);
  if (lock.blocked) return { ok: false, reason: "locked" };

  const user = await db.user.findUnique({ where: { email } });
  const valid =
    user?.status === "ACTIVE" && user.passwordHash
      ? await verifyPassword(user.passwordHash, password)
      : (await burnPasswordCheck(password), false);

  if (!user || !valid) {
    const failures = await hitRateLimit(db, emailKey, RATE_LIMITS.loginFailuresPerEmail);
    if (user) {
      await db.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } } });
      await writeAudit(db, {
        actorId: null,
        action: "auth.login_failed",
        entityType: "User",
        entityId: user.id,
        summary: `Failed sign-in for ${user.email}${user.status !== "ACTIVE" ? ` (account ${user.status.toLowerCase()})` : ""}`,
        ipAddress: meta.ipAddress,
      });
    }
    // Say so on the attempt that triggers the lock, not only on the next one.
    const nowLocked = failures.count >= RATE_LIMITS.loginFailuresPerEmail.limit;
    return { ok: false, reason: nowLocked ? "locked" : "invalid" };
  }

  await clearRateLimit(db, emailKey);
  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lastLoginAt: new Date() } });
  await writeAudit(db, {
    actorId: user.id,
    action: "auth.login",
    entityType: "User",
    entityId: user.id,
    summary: `${user.email} signed in`,
    ipAddress: meta.ipAddress,
  });
  return { ok: true, userId: user.id };
}

// ─── Single-use email tokens ────────────────────────────────────────────────

export async function issueAuthToken(db: PrismaClient, userId: string, type: AuthTokenType) {
  const token = generateToken();
  const ttl = type === "INVITE" ? AUTH.inviteTtlMs : AUTH.resetTtlMs;
  await db.$transaction([
    // Only the newest link of each type works.
    db.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } }),
    db.authToken.create({
      data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttl) },
    }),
  ]);
  return { token, ttlMs: ttl };
}

/** Looks up a token without consuming it (for rendering the set-password page). */
export async function inspectAuthToken(db: PrismaClient, type: AuthTokenType, token: string) {
  const record = await db.authToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true, status: true } } },
  });
  if (!record || record.type !== type || record.usedAt || record.expiresAt <= new Date()) return null;
  const expectedStatus = type === "INVITE" ? "INVITED" : "ACTIVE";
  if (record.user.status !== expectedStatus) return null;
  return record;
}

export type SetPasswordResult = { ok: true; userId: string } | { ok: false; error: string };

/** Completes an invite or a reset: sets the password, burns the token, signs out other sessions. */
export async function setPasswordWithToken(
  db: PrismaClient,
  type: AuthTokenType,
  token: string,
  password: string,
  meta: Meta,
): Promise<SetPasswordResult> {
  const record = await inspectAuthToken(db, type, token);
  if (!record) return { ok: false, error: "This link is invalid or has expired. Ask for a new one." };

  const policyError = checkPasswordPolicy(password, { email: record.user.email, name: record.user.name });
  if (policyError) return { ok: false, error: policyError };

  const passwordHash = await hashPassword(password);
  const consumed = await db.$transaction(async (tx) => {
    // Conditional update makes the token single-use even under concurrent submits.
    const burn = await tx.authToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (burn.count !== 1) return false;
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, passwordChangedAt: new Date(), status: "ACTIVE", failedLoginCount: 0 },
    });
    await tx.session.deleteMany({ where: { userId: record.userId } });
    await writeAudit(tx, {
      actorId: record.userId,
      action: type === "INVITE" ? "auth.invite_accepted" : "auth.password_reset",
      entityType: "User",
      entityId: record.userId,
      summary:
        type === "INVITE"
          ? `${record.user.email} accepted the invite and set a password`
          : `${record.user.email} reset their password`,
      ipAddress: meta.ipAddress,
    });
    return true;
  });
  if (!consumed) return { ok: false, error: "This link has already been used." };

  await clearRateLimit(db, `login:email:${record.user.email}`);
  if (type === "PASSWORD_RESET") {
    await sendMail(passwordChangedEmail({ to: record.user.email, name: record.user.name })).catch((err) =>
      console.error("[mail] password-changed notice failed", err),
    );
  }
  return { ok: true, userId: record.userId };
}

/** "Forgot password". Always behaves the same from the outside, whether or not the email exists. */
export async function requestPasswordReset(db: PrismaClient, emailInput: string, meta: Meta) {
  const email = normaliseEmail(emailInput);
  const ip = await hitRateLimit(db, `reset:ip:${meta.ipAddress ?? "unknown"}`, RATE_LIMITS.resetPerIp);
  const perEmail = await hitRateLimit(db, `reset:email:${email}`, RATE_LIMITS.resetPerEmail);
  if (!ip.allowed) return { ok: false as const, reason: "rate_limited" as const };
  if (!perEmail.allowed) return { ok: true as const };

  const user = await db.user.findUnique({ where: { email } });
  if (user?.status === "ACTIVE") {
    const { token, ttlMs } = await issueAuthToken(db, user.id, "PASSWORD_RESET");
    await writeAudit(db, {
      actorId: null,
      action: "auth.password_reset_requested",
      entityType: "User",
      entityId: user.id,
      summary: `Password reset requested for ${user.email}`,
      ipAddress: meta.ipAddress,
    });
    await sendMail(passwordResetEmail({ to: user.email, name: user.name, token, ttlMs })).catch((err) =>
      console.error("[mail] reset email failed", err),
    );
  }
  return { ok: true as const };
}

/** Signed-in user changes their own password; other sessions are signed out. */
export async function changeOwnPassword(
  db: PrismaClient,
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId: string | null,
  meta: Meta,
): Promise<{ ok: true } | { ok: false; error: string; field?: "currentPassword" | "newPassword" }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user?.passwordHash) return { ok: false, error: "Account not found." };
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    return { ok: false, error: "Current password is incorrect.", field: "currentPassword" };
  }
  if (currentPassword === newPassword) {
    return { ok: false, error: "Choose a password different from the current one.", field: "newPassword" };
  }
  const policyError = checkPasswordPolicy(newPassword, { email: user.email, name: user.name });
  if (policyError) return { ok: false, error: policyError, field: "newPassword" };

  const passwordHash = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) } });
    await writeAudit(tx, {
      actorId: userId,
      action: "auth.password_changed",
      entityType: "User",
      entityId: userId,
      summary: `${user.email} changed their password`,
      ipAddress: meta.ipAddress,
    });
  });
  await sendMail(passwordChangedEmail({ to: user.email, name: user.name })).catch((err) =>
    console.error("[mail] password-changed notice failed", err),
  );
  return { ok: true };
}

export { deleteUserSessions };
