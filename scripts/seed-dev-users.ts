/**
 * Development only: creates test accounts covering every role, all with the password in DEV_SEED_PASSWORD (.env).
 * Emails use the reserved .test domain, so they can never reach a real mailbox.
 *
 *   npm run db:seed-dev
 */
import { PrismaClient, type Department, type Role } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed test users in production.");
const dbUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(dbUrl.hostname))
  throw new Error("Test users can only be seeded into a local database.");
const password = process.env.DEV_SEED_PASSWORD;
if (!password || password.length < 12) throw new Error("Set DEV_SEED_PASSWORD (12+ characters) in .env first.");

const USERS: { email: string; name: string; jobTitle: string; department: Department; roles: Role[] }[] = [
  {
    email: "admin@eventflow.test",
    name: "Test Admin",
    jobTitle: "EventFlow Administrator",
    department: "MANAGEMENT",
    roles: ["ADMIN"],
  },
  {
    email: "sales.requester@eventflow.test",
    name: "Riya Sales (test)",
    jobTitle: "Account Manager",
    department: "SALES",
    roles: ["REQUESTER", "EVENT_OWNER"],
  },
  {
    email: "marketing.manager@eventflow.test",
    name: "Karan Marketing (test)",
    jobTitle: "Event Manager",
    department: "MARKETING",
    roles: ["REQUESTER", "EVENT_OWNER", "EVENT_MANAGER"],
  },
  {
    email: "channel.requester@eventflow.test",
    name: "Neha Channel (test)",
    jobTitle: "Channel Manager",
    department: "CHANNEL",
    roles: ["REQUESTER", "EVENT_OWNER"],
  },
  {
    email: "akshay@eventflow.test",
    name: "Akshay (test)",
    jobTitle: "Stage 1 Approver",
    department: "MANAGEMENT",
    roles: ["APPROVER", "REPORTING"],
  },
  {
    email: "mitul@eventflow.test",
    name: "Mitul (test)",
    jobTitle: "Stage 1 Approver",
    department: "MANAGEMENT",
    roles: ["APPROVER", "REPORTING"],
  },
  {
    email: "amit@eventflow.test",
    name: "Amit (test)",
    jobTitle: "Executive Approver",
    department: "MANAGEMENT",
    roles: ["EXECUTIVE_APPROVER", "REPORTING"],
  },
  {
    email: "finance@eventflow.test",
    name: "Finance Team (test)",
    jobTitle: "Finance",
    department: "FINANCE",
    roles: ["FINANCE", "REPORTING"],
  },
];

const db = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword(password!);
  for (const u of USERS) {
    await db.user.upsert({
      where: { email: u.email },
      update: { ...u, status: "ACTIVE", passwordHash, failedLoginCount: 0 },
      create: { ...u, status: "ACTIVE", passwordHash, passwordChangedAt: new Date() },
    });
  }
  console.log(`Seeded ${USERS.length} test users (password from DEV_SEED_PASSWORD):`);
  for (const u of USERS) console.log(`  ${u.email.padEnd(36)} ${u.roles.join(", ")}`);
  // Wire the test approvers into the seeded workflow: Akshay + Mitul at Stage 1, Amit at Stage 2.
  const workflow = await db.approvalWorkflow.findFirst({
    where: { active: true },
    include: { stages: { orderBy: { sequence: "asc" } } },
  });
  if (workflow) {
    const byEmail = async (email: string) => db.user.findUnique({ where: { email }, select: { id: true } });
    const stageOne = workflow.stages.find((s) => s.sequence === 1);
    const stageTwo = workflow.stages.find((s) => s.sequence === 2);
    const assign = async (stageId: string, emails: string[]) => {
      for (const [index, email] of emails.entries()) {
        const user = await byEmail(email);
        if (!user) continue;
        await db.approvalStageApprover.upsert({
          where: { stageId_userId: { stageId, userId: user.id } },
          update: { sortOrder: index },
          create: { stageId, userId: user.id, sortOrder: index },
        });
      }
    };
    if (stageOne) await assign(stageOne.id, ["akshay@eventflow.test", "mitul@eventflow.test"]);
    if (stageTwo) await assign(stageTwo.id, ["amit@eventflow.test"]);
    console.log("Assigned test approvers to the approval workflow.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
