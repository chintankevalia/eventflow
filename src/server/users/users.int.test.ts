import { afterAll, describe, expect, it } from "vitest";
import { db, meta, sentMail, STRONG_PASSWORD, tokenFromMail, uniqueEmail } from "../../../tests/integration/helpers";
import { hashPassword } from "../auth/password";
import { authenticate, setPasswordWithToken } from "../auth/service";
import { createSession, validateSessionToken } from "../auth/session-store";
import {
  deactivateUser,
  forceSignOut,
  inviteUser,
  listUsers,
  reactivateUser,
  resendInvite,
  updateUser,
  UserServiceError,
  type Actor,
} from "./service";

afterAll(() => db.$disconnect());

async function makeAdmin(): Promise<Actor> {
  const user = await db.user.create({
    data: {
      email: uniqueEmail("admin"),
      name: "Admin Person",
      roles: ["ADMIN"],
      status: "ACTIVE",
      passwordHash: await hashPassword(STRONG_PASSWORD),
    },
  });
  return { id: user.id, name: user.name, email: user.email };
}

const baseInput = (email = uniqueEmail("new")) => ({
  name: "Priya Shah",
  email,
  jobTitle: "Marketing Manager",
  phone: "+91 98765 43210",
  department: "MARKETING" as const,
  roles: ["REQUESTER" as const, "EVENT_OWNER" as const],
});

describe("invite user", () => {
  it("creates an invited user, emails a working link and audits it", async () => {
    const admin = await makeAdmin();
    const { user, emailSent } = await inviteUser(db, admin, baseInput(), meta());
    expect(emailSent).toBe(true);
    expect(user.status).toBe("INVITED");
    expect(user.passwordHash).toBeNull();

    const mail = sentMail.find((m) => m.to === user.email);
    expect(mail?.subject).toMatch(/invited/i);
    const token = tokenFromMail(mail, "invite");
    expect((await setPasswordWithToken(db, "INVITE", token, STRONG_PASSWORD, meta())).ok).toBe(true);
    expect((await authenticate(db, user.email, STRONG_PASSWORD, meta())).ok).toBe(true);

    const audit = await db.auditLog.findFirst({ where: { entityId: user.id, action: "user.invited" } });
    expect(audit?.actorId).toBe(admin.id);
  });

  it("normalises email and rejects duplicates in any letter case", async () => {
    const admin = await makeAdmin();
    const email = uniqueEmail("dup");
    const { user } = await inviteUser(db, admin, baseInput(email.toUpperCase()), meta());
    expect(user.email).toBe(email);
    await expect(inviteUser(db, admin, baseInput(email), meta())).rejects.toMatchObject({ field: "email" });
  });

  it("validates input", async () => {
    const admin = await makeAdmin();
    await expect(inviteUser(db, admin, { ...baseInput(), roles: [] }, meta())).rejects.toThrow();
    await expect(inviteUser(db, admin, { ...baseInput(), email: "not-an-email" }, meta())).rejects.toThrow();
  });

  it("re-sends invites only while the user is still invited", async () => {
    const admin = await makeAdmin();
    const { user } = await inviteUser(db, admin, baseInput(), meta());
    expect((await resendInvite(db, admin, user.id, meta())).emailSent).toBe(true);
    await db.user.update({ where: { id: user.id }, data: { status: "ACTIVE" } });
    await expect(resendInvite(db, admin, user.id, meta())).rejects.toBeInstanceOf(UserServiceError);
  });
});

describe("admin safeguards", () => {
  it("an admin cannot remove their own Administrator role or deactivate themselves", async () => {
    const admin = await makeAdmin();
    await expect(
      updateUser(db, admin, admin.id, { ...baseInput(admin.email), roles: ["REQUESTER"] }, meta()),
    ).rejects.toMatchObject({ field: "roles" });
    await expect(deactivateUser(db, admin, admin.id, meta())).rejects.toBeInstanceOf(UserServiceError);
  });

  it("another admin can be demoted while one remains", async () => {
    const a = await makeAdmin();
    const b = await makeAdmin();
    const updated = await updateUser(db, a, b.id, { ...baseInput(b.email), roles: ["REQUESTER"] }, meta());
    expect(updated.roles).toEqual(["REQUESTER"]);
  });

  it("the last active admin can be neither demoted nor deactivated", async () => {
    const sole = await makeAdmin();
    await db.user.updateMany({
      where: { roles: { has: "ADMIN" }, id: { not: sole.id } },
      data: { status: "DEACTIVATED" },
    });
    const operator: Actor = { id: "system", name: "Operator", email: "op@eventflow.test" };
    await expect(
      updateUser(db, operator, sole.id, { ...baseInput(sole.email), roles: ["REQUESTER"] }, meta()),
    ).rejects.toThrow(/at least one active Administrator/);
    await expect(deactivateUser(db, operator, sole.id, meta())).rejects.toThrow(/at least one active Administrator/);
  });
});

describe("update user", () => {
  it("records a before/after audit entry and signs the user out when roles change", async () => {
    const admin = await makeAdmin();
    const { user } = await inviteUser(db, admin, baseInput(), meta());
    await db.user.update({ where: { id: user.id }, data: { status: "ACTIVE" } });
    const { token } = await createSession(db, user.id, meta());

    await updateUser(db, admin, user.id, { ...baseInput(user.email), roles: ["REQUESTER", "FINANCE"] }, meta());
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: user.id, action: "user.updated" } });
    expect(audit.summary).toContain("roles");
    expect((audit.before as { roles: string[] }).roles).toEqual(["REQUESTER", "EVENT_OWNER"]);
    expect((audit.after as { roles: string[] }).roles).toEqual(["REQUESTER", "FINANCE"]);
    expect(await validateSessionToken(db, token)).toBeNull();
  });

  it("does not audit when nothing changed", async () => {
    const admin = await makeAdmin();
    const { user } = await inviteUser(db, admin, baseInput(), meta());
    await updateUser(db, admin, user.id, baseInput(user.email), meta());
    expect(await db.auditLog.count({ where: { entityId: user.id, action: "user.updated" } })).toBe(0);
  });
});

describe("deactivate / reactivate", () => {
  it("deactivation signs out, blocks sign-in and kills pending links; reactivation restores access", async () => {
    const admin = await makeAdmin();
    const { user } = await inviteUser(db, admin, baseInput(), meta());
    const token = tokenFromMail(
      sentMail.find((m) => m.to === user.email),
      "invite",
    );
    await setPasswordWithToken(db, "INVITE", token, STRONG_PASSWORD, meta());
    const session = await createSession(db, user.id, meta());

    await deactivateUser(db, admin, user.id, meta());
    expect(await validateSessionToken(db, session.token)).toBeNull();
    expect((await authenticate(db, user.email, STRONG_PASSWORD, meta())).ok).toBe(false);

    const r = await reactivateUser(db, admin, user.id, meta());
    expect(r.status).toBe("ACTIVE");
    expect((await authenticate(db, user.email, STRONG_PASSWORD, meta())).ok).toBe(true);
  });

  it("a user who never set a password is reactivated as invited with a fresh link", async () => {
    const admin = await makeAdmin();
    const { user } = await inviteUser(db, admin, baseInput(), meta());
    await deactivateUser(db, admin, user.id, meta());
    sentMail.length = 0;
    const r = await reactivateUser(db, admin, user.id, meta());
    expect(r).toEqual({ status: "INVITED", emailSent: true });
    expect(sentMail).toHaveLength(1);
  });

  it("force sign-out ends every session", async () => {
    const admin = await makeAdmin();
    const { user } = await inviteUser(db, admin, baseInput(), meta());
    await db.user.update({ where: { id: user.id }, data: { status: "ACTIVE" } });
    await createSession(db, user.id, meta());
    await createSession(db, user.id, meta());
    expect(await forceSignOut(db, admin, user.id, meta())).toEqual({ count: 2 });
  });
});

describe("list users", () => {
  it("filters by search, role and status", async () => {
    const admin = await makeAdmin();
    const marker = `Zx${Date.now()}`;
    await inviteUser(db, admin, { ...baseInput(), name: `${marker} Finance`, roles: ["FINANCE"] }, meta());
    await inviteUser(db, admin, { ...baseInput(), name: `${marker} Requester`, roles: ["REQUESTER"] }, meta());

    const bySearch = await listUsers(db, { q: marker, page: 1 });
    expect(bySearch.total).toBe(2);
    const byRole = await listUsers(db, { q: marker, role: "FINANCE", page: 1 });
    expect(byRole.users.map((u) => u.name)).toEqual([`${marker} Finance`]);
    const byStatus = await listUsers(db, { q: marker, status: "ACTIVE", page: 1 });
    expect(byStatus.total).toBe(0);
  });
});
