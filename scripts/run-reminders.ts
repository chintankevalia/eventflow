/**
 * Sends approval reminders and escalations that are now due.
 * Run it on a schedule — hourly is plenty, since the windows are measured in hours:
 *
 *   npm run approvals:remind
 *
 * In Docker, a cron entry or a scheduled task should call this. It is safe to run repeatedly:
 * each round is chased at most once a day.
 */
import { PrismaClient } from "@prisma/client";
import { runApprovalReminders } from "../src/server/approvals/reminders";

const db = new PrismaClient();

runApprovalReminders(db)
  .then((result) => {
    console.log(
      `Checked ${result.checked} open approval(s): ${result.reminded} reminder(s), ${result.escalated} escalation(s).`,
    );
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
