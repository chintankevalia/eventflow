import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import type { MailMessage } from "@/server/mail/transport";

export const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });

/** Emails "sent" during the current test (captured by tests/integration/setup.ts). */
export const sentMail = (globalThis as unknown as { __sentMail: MailMessage[] }).__sentMail;

export const uid = () => randomBytes(4).toString("hex");
export const uniqueEmail = (label = "user") => `${label}.${uid()}@eventflow.test`;
export const meta = () => ({
  ipAddress: `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  userAgent: "vitest",
});

/** Pulls the token out of an invite / reset email link. */
export function tokenFromMail(message: MailMessage | undefined, kind: "invite" | "reset-password") {
  const match = message?.text.match(new RegExp(`/${kind}/([A-Za-z0-9_-]{20,})`));
  if (!match) throw new Error(`No ${kind} link in email`);
  return match[1];
}

export const STRONG_PASSWORD = "correct horse battery staple";

/** A real User row to act as the audit actor (audit_logs.actorId is a foreign key). */
export async function makeActor(name = "Test Admin") {
  const user = await db.user.create({
    data: { email: uniqueEmail("actor"), name, roles: ["ADMIN"], status: "ACTIVE" },
  });
  return { id: user.id, name: user.name, email: user.email };
}

/** Records Sales' Go directly, for tests about what happens after the Sales gate. */
export async function salesGo<T extends { id: string }>(event: T): Promise<T> {
  await db.event.update({ where: { id: event.id }, data: { salesReviewStatus: "GO" } });
  return event;
}
