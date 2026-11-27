/**
 * Replaces every event in the app with what the Channel Marketing Master Sheet says, across all
 * four of its boards (Events, Blitz, Webinar, Weekly Pulse).
 *
 *   npm run reimport:master-sheet -- "C:\path\to\Channel Marketing Master Sheet.xlsx"
 *
 * Always a full run: back up every existing event to JSON, delete every event (and everything
 * that hangs off one — cost lines, tasks, approvals, attachments, import rows — cascade per the
 * schema), then import all four boards fresh with --commit. There is no dry-run flag: the backup
 * is the safety net, not a preview. The backup lands in `.data/backups/`, never deleted by this
 * script or any other, so an accidental run is always recoverable by hand.
 *
 * Run `npm run config:seed` first — the event types this needs (including the three activity
 * types: blitz, webinar, weekly_pulse) are seeded there.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { importActivitySheet, readActivitySheet, type ActivitySheetConfig } from "../src/server/import/activity-sheets";
import { importChannelSheet, readChannelWorkbook, SHEET_NAME as EVENTS_SHEET } from "../src/server/import/channel-sheet";

const { positionals } = parseArgs({ allowPositionals: true });
const filePath = positionals[0];
if (!filePath) {
  console.error('Usage: npm run reimport:master-sheet -- "<path to the .xlsx>"');
  process.exit(1);
}

const db = new PrismaClient();

const BLITZ: ActivitySheetConfig = {
  sheetName: "glob - blitz",
  typeKey: "blitz",
  label: "Blitz",
  nameColumn: "Name",
  statusColumn: "Status",
  dateColumn: "Date",
  regionColumn: "Region",
  noteColumns: ["Person", "Sales person", "Remarks"],
  statusMap: {
    done: { lifecycle: "CLOSED", approval: "APPROVED" },
    canceled: { lifecycle: "DROPPED", approval: "NOT_SUBMITTED" },
    cancelled: { lifecycle: "DROPPED", approval: "NOT_SUBMITTED" },
    "follow up": { lifecycle: "SCHEDULING", approval: "NOT_SUBMITTED" },
    postponed: { lifecycle: "SCHEDULING", approval: "NOT_SUBMITTED" },
    scheduled: { lifecycle: "SCHEDULING", approval: "NOT_SUBMITTED" },
    tbd: { lifecycle: "DRAFT", approval: "NOT_SUBMITTED" },
  },
};

const WEBINAR: ActivitySheetConfig = {
  sheetName: "glob - webinar",
  typeKey: "webinar",
  label: "Webinar",
  nameColumn: "Name",
  statusColumn: "Status",
  dateColumn: "Date",
  regionColumn: "Region",
  cityColumn: "Country/City",
  noteColumns: ["Collabration", "Time", "Speaker", "Type", "Registrations", "Attendee", "Remarks"],
  statusMap: {
    done: { lifecycle: "CLOSED", approval: "APPROVED" },
    canceled: { lifecycle: "DROPPED", approval: "NOT_SUBMITTED" },
    cancelled: { lifecycle: "DROPPED", approval: "NOT_SUBMITTED" },
    schedule: { lifecycle: "SCHEDULING", approval: "NOT_SUBMITTED" },
    scheduled: { lifecycle: "SCHEDULING", approval: "NOT_SUBMITTED" },
  },
};

const WEEKLY_PULSE: ActivitySheetConfig = {
  sheetName: "glob - weekly pulse",
  typeKey: "weekly_pulse",
  label: "Weekly Pulse",
  nameColumn: "Name",
  statusColumn: "Status",
  dateColumn: "Date",
  noteColumns: ["Type"],
  statusMap: {
    done: { lifecycle: "CLOSED", approval: "APPROVED" },
  },
};

async function resolveActor() {
  const admin =
    (await db.user.findFirst({ where: { roles: { has: "ADMIN" }, status: "ACTIVE" }, orderBy: { createdAt: "asc" } })) ??
    (await db.user.findFirst({ where: { roles: { has: "ADMIN" } }, orderBy: { createdAt: "asc" } }));
  if (!admin) throw new Error("No administrator exists yet. Run `npm run user:create-admin` first.");
  return admin;
}

async function backupEvents(): Promise<string> {
  const events = await db.event.findMany({
    include: {
      costLines: true,
      tasks: true,
      stakeholders: true,
      attachments: true,
      postEventResult: true,
      approvalRounds: { include: { decisions: true } },
    },
  });
  const dir = path.join(process.cwd(), ".data", "backups");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `events-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(events, null, 2), "utf8");
  return file;
}

async function wipeEvents() {
  await db.importRow.deleteMany({});
  await db.importBatch.deleteMany({});
  const { count } = await db.event.deleteMany({});
  return count;
}

function printSummary(label: string, imported: number, skipped: number, errors: number) {
  console.log(
    `  ${label.padEnd(14)}${String(imported).padStart(4)} imported${skipped ? `, ${skipped} skipped` : ""}${errors ? `, ${errors} errors` : ""}`,
  );
}

async function main() {
  const fileName = path.basename(filePath);
  const actor = await resolveActor();

  console.log(`Backing up existing events before anything is deleted…`);
  const existingCount = await db.event.count();
  const backupFile = await backupEvents();
  console.log(`  ${existingCount} event(s) backed up to ${path.relative(process.cwd(), backupFile)}`);

  console.log(`\nDeleting every existing event…`);
  const deleted = await wipeEvents();
  console.log(`  ${deleted} event(s) deleted (cost lines, tasks, approvals, attachments go with them).`);

  console.log(`\nImporting "${fileName}" fresh…`);

  const eventsSheet = await readChannelWorkbook(filePath);
  const eventsReport = await importChannelSheet(db, eventsSheet, { actorId: actor.id, fileName, commit: true });
  printSummary(EVENTS_SHEET, eventsReport.totals.events, eventsReport.skipped.length, eventsReport.errors.length);
  if (eventsReport.missingConfig.length) {
    console.error("Missing configuration:", eventsReport.missingConfig);
    process.exitCode = 1;
  }

  for (const config of [BLITZ, WEBINAR, WEEKLY_PULSE]) {
    const sheet = await readActivitySheet(filePath, config.sheetName);
    const report = await importActivitySheet(db, sheet, config, { actorId: actor.id, fileName, commit: true });
    printSummary(config.label, report.totals.imported, report.skipped.length, report.errors.length);
    if (report.missingConfig.length) {
      console.error(`Missing configuration for ${config.label}:`, report.missingConfig);
      process.exitCode = 1;
    }
  }

  const finalCount = await db.event.count();
  console.log(`\nDone. ${finalCount} event(s) now in the app, all from "${fileName}".`);
  console.log(`Backup of what was there before: ${path.relative(process.cwd(), backupFile)}`);
}

main()
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
