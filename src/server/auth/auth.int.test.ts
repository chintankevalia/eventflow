import { afterAll, describe, expect, it } from "vitest";
import { db, meta, sentMail, STRONG_PASSWORD, tokenFromMail, uniqueEmail } from "../../../tests/integration/helpers";
import { AUTH } from "./config";
import { hashPassword } from "./password";
import {
  authenticate,
  changeOwnPassword,
  inspectAuthToken,
  issueAuthToken,
  requestPasswordReset,
  setPasswordWithToken,
} from "./service";
import { createSession, validateSessionToken } from "./session-store";

afterAll(() => db.$disconnect());

async function activeUser(overrides: { roles?: ("ADMIN" | "REQUESTER")[] } = {}) {
  const email = uniqueEmail();
  const user = await db.user.create({
    data: {
      email,
      name: "Test Person",
      roles: overrides.roles ?? ["REQUESTER"],
      status: "ACTIVE",
      passwordHash: await hashPassword(STRONG_PASSWORD),
    },
  });
  return user;
}

describe("sign-in", () => {
  it("accepts the right password, case-insensitive email", async () => {
    const user = await activeUser();
    const result = await authenticate(db, user.email.toUpperCase(), STRONG_PASSWORD, meta());
    expect(result).toEqual({ ok: true, userId: user.id });
    const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.lastLoginAt).not.toBeNull();
  });

  it("rejects a wrong password with a generic reason and counts it", async () => {
    const user = await activeUser();
    expect(await authenticate(db, user.email, "wrong password here", meta())).toEqual({ ok: false, reason: "invalid" });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(1);
  });

  it("locks after 5 wrong passwords, even when the 6th is correct", async () => {
    const user = await activeUser();
    const m = meta();
    for (let i = 0; i < 4; i++) expect((await authenticate(db, user.email, "nope nope nope", m)).ok).toBe(false);
    expect(await authenticate(db, user.email, "nope nope nope", m)).toEqual({ ok: false, reason: "locked" });
    expect(await authenticate(db, user.email, STRONG_PASSWORD, m)).toEqual({ ok: false, reason: "locked" });
  });

  it("behaves the same for unknown emails (no account enumeration)", async () => {
    const email = uniqueEmail("ghost");
    const m = meta();
    expect(await authenticate(db, email, "whatever123456", m)).toEqual({ ok: false, reason: "invalid" });
    for (let i = 0; i < 3; i++) await authenticate(db, email, "whatever123456", m);
    expect(await authenticate(db, email, "whatever123456", m)).toEqual({ ok: false, reason: "locked" });
  });

  it("refuses invited and deactivated accounts", async () => {
    const user = await activeUser();
    await db.user.update({ where: { id: user.id }, data: { status: "DEACTIVATED" } });
    expect(await authenticate(db, user.email, STRONG_PASSWORD, meta())).toEqual({ ok: false, reason: "invalid" });
  });

  it("throttles many attempts from one IP", async () => {
    const m = meta();
    let last;
    for (let i = 0; i < 31; i++) last = await authenticate(db, uniqueEmail("spray"), "whatever123456", m);
    expect(last).toEqual({ ok: false, reason: "rate_limited" });
  });
});

describe("sessions", () => {
  it("validates a fresh session and rejects tampered tokens", async () => {
    const user = await activeUser();
    const { token } = await createSession(db, user.id, meta());
    expect((await validateSessionToken(db, token))?.user.id).toBe(user.id);
    expect(await validateSessionToken(db, token + "x")).toBeNull();
  });

  it("stores only a hash of the token", async () => {
    const user = await activeUser();
    const { token } = await createSession(db, user.id, meta());
    const rows = await db.session.findMany({ where: { userId: user.id } });
    expect(rows.every((r) => r.id !== token)).toBe(true);
  });

  it("expires idle sessions", async () => {
    const user = await activeUser();
    const { token } = await createSession(db, user.id, meta());
    const later = new Date(Date.now() + AUTH.sessionIdleMs + 1000);
    expect(await validateSessionToken(db, token, later)).toBeNull();
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("ends when the user is deactivated", async () => {
    const user = await activeUser();
    const { token } = await createSession(db, user.id, meta());
    await db.user.update({ where: { id: user.id }, data: { status: "DEACTIVATED" } });
    expect(await validateSessionToken(db, token)).toBeNull();
  });
});

describe("invite links", () => {
  async function invited() {
    const user = await db.user.create({
      data: { email: uniqueEmail("invitee"), name: "New Person", roles: ["REQUESTER"] },
    });
    const { token } = await issueAuthToken(db, user.id, "INVITE");
    return { user, token };
  }

  it("activates the account with a strong password, then signs in", async () => {
    const { user, token } = await invited();
    expect(await inspectAuthToken(db, "INVITE", token)).not.toBeNull();
    const result = await setPasswordWithToken(db, "INVITE", token, STRONG_PASSWORD, meta());
    expect(result).toEqual({ ok: true, userId: user.id });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("ACTIVE");
    expect((await authenticate(db, user.email, STRONG_PASSWORD, meta())).ok).toBe(true);
  });

  it("is single-use", async () => {
    const { token } = await invited();
    expect((await setPasswordWithToken(db, "INVITE", token, STRONG_PASSWORD, meta())).ok).toBe(true);
    expect((await setPasswordWithToken(db, "INVITE", token, "another strong passphrase", meta())).ok).toBe(false);
  });

  it("rejects weak passwords and keeps the link usable", async () => {
    const { token } = await invited();
    const weak = await setPasswordWithToken(db, "INVITE", token, "short", meta());
    expect(weak.ok).toBe(false);
    expect((await setPasswordWithToken(db, "INVITE", token, STRONG_PASSWORD, meta())).ok).toBe(true);
  });

  it("expires", async () => {
    const { token, user } = await invited();
    await db.authToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await inspectAuthToken(db, "INVITE", token)).toBeNull();
  });

  it("only the newest link works", async () => {
    const { user, token: first } = await invited();
    const { token: second } = await issueAuthToken(db, user.id, "INVITE");
    expect(await inspectAuthToken(db, "INVITE", first)).toBeNull();
    expect(await inspectAuthToken(db, "INVITE", second)).not.toBeNull();
  });

  it("cannot be used as a reset link", async () => {
    const { token } = await invited();
    expect(await inspectAuthToken(db, "PASSWORD_RESET", token)).toBeNull();
  });
});

describe("password reset", () => {
  it("emails active users and lets them set a new password", async () => {
    const user = await activeUser();
    const { token: sessionToken } = await createSession(db, user.id, meta());
    await requestPasswordReset(db, user.email, meta());
    const resetMail = sentMail.find((m) => m.to === user.email);
    const token = tokenFromMail(resetMail, "reset-password");

    const result = await setPasswordWithToken(db, "PASSWORD_RESET", token, "a brand new passphrase", meta());
    expect(result.ok).toBe(true);
    expect((await authenticate(db, user.email, "a brand new passphrase", meta())).ok).toBe(true);
    // Existing sessions end, and a "password changed" notice goes out.
    expect(await validateSessionToken(db, sessionToken)).toBeNull();
    expect(sentMail.some((m) => m.subject.includes("password was changed"))).toBe(true);
  });

  it("sends nothing for unknown or deactivated emails, but responds the same", async () => {
    const user = await activeUser();
    await db.user.update({ where: { id: user.id }, data: { status: "DEACTIVATED" } });
    expect(await requestPasswordReset(db, user.email, meta())).toEqual({ ok: true });
    expect(await requestPasswordReset(db, uniqueEmail("nobody"), meta())).toEqual({ ok: true });
    expect(sentMail).toHaveLength(0);
  });
});

describe("change own password", () => {
  it("requires the current password and keeps only this session", async () => {
    const user = await activeUser();
    const keep = await createSession(db, user.id, meta());
    const other = await createSession(db, user.id, meta());
    const keepId = (await validateSessionToken(db, keep.token))!.sessionId;

    const wrong = await changeOwnPassword(db, user.id, "not my password", "fresh passphrase here", keepId, meta());
    expect(wrong).toMatchObject({ ok: false, field: "currentPassword" });

    const ok = await changeOwnPassword(db, user.id, STRONG_PASSWORD, "fresh passphrase here", keepId, meta());
    expect(ok).toEqual({ ok: true });
    expect(await validateSessionToken(db, keep.token)).not.toBeNull();
    expect(await validateSessionToken(db, other.token)).toBeNull();
  });
});

describe("audit log", () => {
  it("is append-only at the database level", async () => {
    const user = await activeUser();
    await authenticate(db, user.email, STRONG_PASSWORD, meta());
    const entry = await db.auditLog.findFirstOrThrow({ where: { entityId: user.id, action: "auth.login" } });
    await expect(db.auditLog.update({ where: { id: entry.id }, data: { summary: "tampered" } })).rejects.toThrow(
      /append-only/,
    );
    await expect(db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
  });
});
