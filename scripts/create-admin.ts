/**
 * Creates the first EventFlow administrator (or re-issues their invite) and prints the set-password link.
 * No password is ever typed into a terminal; the admin chooses it in the browser.
 *
 *   npm run user:create-admin -- --email name@motadata.com --name "Full Name"
 */
import { PrismaClient } from "@prisma/client";
import { parseArgs } from "node:util";
import { writeAudit } from "../src/server/audit";
import { issueAuthToken, normaliseEmail } from "../src/server/auth/service";
import { inviteEmail } from "../src/server/mail/templates";
import { sendMail } from "../src/server/mail/transport";
import { appUrl } from "../src/server/mail/layout";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
if (!values.email || !values.name) {
  console.error('Usage: npm run user:create-admin -- --email name@motadata.com --name "Full Name"');
  process.exit(1);
}

const db = new PrismaClient();

async function main() {
  const email = normaliseEmail(values.email!);
  const name = values.name!.trim();
  let user = await db.user.findUnique({ where: { email } });

  if (user && user.status !== "INVITED") {
    console.error(`${email} already exists with status ${user.status}. Use Settings → Users instead.`);
    process.exit(1);
  }
  if (!user) {
    user = await db.user.create({ data: { email, name, roles: ["ADMIN"], status: "INVITED" } });
    await writeAudit(db, {
      actorId: null,
      action: "user.invited",
      entityType: "User",
      entityId: user.id,
      summary: `Administrator ${name} (${email}) created from the command line`,
    });
  }

  const { token, ttlMs } = await issueAuthToken(db, user.id, "INVITE");
  await sendMail(inviteEmail({ to: email, name: user.name, invitedBy: "EventFlow setup", token, ttlMs })).catch((e) =>
    console.warn("Invite email could not be sent:", e.message),
  );
  console.log(`\nAdministrator invite for ${email}`);
  console.log(`Open this link to set the password (valid ${Math.round(ttlMs / 3_600_000)} hours, single use):\n`);
  console.log(`  ${appUrl(`/invite/${token}`)}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
