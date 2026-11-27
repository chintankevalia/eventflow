/**
 * Imports the channel marketing team's master sheet (a Monday.com board export) into EventFlow.
 *
 *   npm run import:channel-sheet -- "C:\path\to\Channel Marketing Master Sheet.xlsx"            # dry run
 *   npm run import:channel-sheet -- "…\Channel Marketing Master Sheet.xlsx" --commit
 *   npm run import:channel-sheet -- "…\Channel Marketing Master Sheet.xlsx" --remove
 *
 * A dry run writes nothing and leaves a full row-by-row mapping in `.data/import-preview/` to read
 * before committing. A commit is safe to repeat: rows already imported from the same file name are
 * skipped. `--remove` takes a previous import back out — the events, the batch and any organisation
 * the import created that nothing else points at. Event codes are drawn from the real counter and are
 * never reissued, so a re-import gets fresh ones.
 *
 * Run `npm run config:seed` first: the event types, subtypes, regions and custom fields this needs
 * are seeded there.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import {
  COLUMN_MAP,
  SHEET_NAME,
  importChannelSheet,
  readChannelWorkbook,
  removeChannelImport,
  type ImportReport,
  type PlannedEvent,
} from "../src/server/import/channel-sheet";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    commit: { type: "boolean", default: false },
    remove: { type: "boolean", default: false },
    as: { type: "string" },
  },
});

const filePath = positionals[0];
if (!filePath) {
  console.error('Usage: npm run import:channel-sheet -- "<path to the .xlsx>" [--commit | --remove] [--as email]');
  process.exit(1);
}

const db = new PrismaClient();
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const pad = (s: string, n: number) => s.padEnd(n);

/** The import is recorded against a real administrator, so the audit trail names a person. */
async function resolveActor() {
  if (values.as) {
    const user = await db.user.findUnique({ where: { email: values.as.trim().toLowerCase() } });
    if (!user) throw new Error(`No user with the email ${values.as}.`);
    return user;
  }
  const admin =
    (await db.user.findFirst({ where: { roles: { has: "ADMIN" }, status: "ACTIVE" }, orderBy: { createdAt: "asc" } })) ??
    (await db.user.findFirst({ where: { roles: { has: "ADMIN" } }, orderBy: { createdAt: "asc" } }));
  if (!admin) throw new Error("No administrator exists yet. Run `npm run user:create-admin` first.");
  return admin;
}

function tally(events: PlannedEvent[], of: (e: PlannedEvent) => string) {
  const counts = new Map<string, number>();
  for (const event of events) counts.set(of(event), (counts.get(of(event)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const LIFECYCLE_LABEL: Record<string, string> = {
  CLOSED: "Closed, budget approved",
  SCHEDULING: "Scheduling",
  DRAFT: "Draft",
  DROPPED: "Dropped",
};

/** Everything I decided without being told, printed so any of it can be vetoed in one line. */
const DECISIONS = [
  "Every event is filed under the Channel department, requested by the administrator above, with no event owner set — assign owners in the portal.",
  "A Completed event becomes Closed with its budget marked approved and spent, so the dashboard reports the money rather than a 100% underspend. No approval rounds are written: no approval happened in this portal.",
  "Sheduled → Scheduling, Planning and TBD → Draft, Canceled → Dropped (with a note saying the sheet said so).",
  "The budget is imported as cost lines, never as a bare total: the portal recomputes an event's total from its lines, so a bare total would vanish the first time anyone edited a line.",
  "The Budget column sets each event's total, because that is the column the sheet's own financial-year totals add up. Priced subitems are imported as the breakdown inside it, and anything they do not account for becomes one 'Unitemised balance' line so no money is lost. Where the priced subitems come to more than the budget cell, the lines are kept and that event ends up above the sheet figure.",
  "The 150 subitems also become tasks, all marked Done, with the responsible person and the vendor contact in the task notes.",
  "An event with no budget figure at all gets no cost line and shows ₹0.",
  "Country/City goes into the city field and the country is left blank — the sheet keeps one location column. Clear misspellings are corrected (Banglore → Bangalore, Hydrabad/Hydarabad → Hyderabad, Secundrabad → Secunderabad, Sri Laka → Sri Lanka, Phillipines → Philippines, Saudi Arab → Saudi Arabia, Bhubaneshwar → Bhubaneswar, Cochin → Kochi). A value naming two places, such as Pune (Lonavala), is left exactly as written.",
  "Collaboration becomes the partner organisation. 'Individule' means Motadata ran it alone. 'Softsheild' and 'Softshield' are one partner. An organisation is recorded as a distributor if the sheet runs distributor-led events with it, otherwise as a partner.",
  "Two rows leave Event Type blank, which the portal cannot accept. The team confirmed both on 15-Oct-2026: r67 ETL Chapter Pune is a Customer event, r98 Manila Tech Update Event is a Partner event. Both are flagged as warnings so the answer stays visible on the row.",
  "Venue and the participant list go into two new fields, Venue and Internal participants, in the Planning section.",
  "Format, product focus, objective, collaboration model, country and duration are left blank rather than guessed.",
  "Pipeline and Closed won are ignored — both columns are empty in the sheet.",
  "The Monday subitem IDs are kept on the import record, not on the event.",
];

function reportToMarkdown(report: ImportReport, actorEmail: string): string {
  const lines: string[] = [];
  lines.push(`# ${report.fileName} → ${SHEET_NAME}`);
  lines.push("");
  lines.push(`${report.committed ? "Committed" : "Dry run"} · ${report.events.length} rows read · actor ${actorEmail}`);
  lines.push("");
  lines.push("## Column mapping");
  lines.push("");
  lines.push("| Sheet column | Goes to |");
  lines.push("| --- | --- |");
  for (const column of COLUMN_MAP) {
    lines.push(`| ${column.sourceColumn} | ${column.targetField ?? "_ignored_" } |`);
  }

  for (const event of report.events) {
    lines.push("");
    lines.push(`## Row ${event.rowIndex} — ${event.title || "(no name)"}`);
    lines.push("");
    if (event.skipReason) lines.push(`**Not imported.** ${event.skipReason}`, "");
    lines.push("| Field | Sheet says | Imported as |");
    lines.push("| --- | --- | --- |");
    const rows: [string, string, string][] = [
      ["Event code", "—", event.code ?? (event.skipReason ? "—" : "assigned on commit")],
      ["Name", event.raw.Name ?? "", event.title],
      ["Status", event.statusLabel, `${LIFECYCLE_LABEL[event.lifecycleStatus]} / ${event.approvalStatus}`],
      ["Date", event.raw.Date ?? "", event.isoDate ?? "(blank)"],
      ["Region", event.raw.Region ?? "", event.regionValue ?? "(blank)"],
      ["Country/City", event.cityAsWritten, event.city ?? "(blank)"],
      ["Event Type", event.typeLabel, event.typeKey ?? "(none — row not imported)"],
      ["Event Sub Type", event.subtypeLabel, event.subtypeName ?? "(blank)"],
      ["Collaboration", event.collaborationLabel, event.partnerName ?? "(no partner)"],
      ["Venue", event.raw.Venue ?? "", event.venue ?? "(blank)"],
      ["Participant Name", event.raw["Participant Name"] ?? "", event.participants ?? "(blank)"],
      ["Budget", event.raw.Budget ?? "", event.budget == null ? "(blank)" : inr(event.budget)],
      ["Group", event.group, "(not imported — financial year grouping)"],
    ];
    for (const [field, from, to] of rows) {
      lines.push(`| ${field} | ${from.replace(/\|/g, "\\|") || "—"} | ${to.replace(/\|/g, "\\|")} |`);
    }
    if (event.costLines.length) {
      lines.push("");
      lines.push(`### Cost lines (${event.costLines.length})`);
      lines.push("");
      lines.push("| Description | Vendor | Estimated |");
      lines.push("| --- | --- | --- |");
      for (const line of event.costLines) {
        lines.push(`| ${line.description} | ${line.vendor ?? "—"} | ${inr(line.estimated)} |`);
      }
      const total = event.costLines.reduce((n, l) => n + l.estimated, 0);
      lines.push(`| **Total** | | **${inr(total)}** |`);
    }
    if (event.tasks.length) {
      lines.push("");
      lines.push(`### Tasks (${event.tasks.length}, all Done)`);
      lines.push("");
      for (const task of event.tasks) {
        lines.push(`- ${task.title}${task.notes ? ` — ${task.notes.replace(/\n/g, "; ")}` : ""}`);
      }
    }
    if (event.issues.length) {
      lines.push("");
      lines.push("### Notes");
      lines.push("");
      for (const issue of event.issues) {
        lines.push(`- **${issue.severity === "error" ? "Error" : "Warning"}** (${issue.field}) ${issue.message}`);
      }
    }
  }
  return lines.join("\n");
}

function printReport(report: ImportReport, actorLabel: string) {
  const willCreate = report.events.filter((e) => !e.skipReason);
  const alreadyThere = report.events.filter((e) => e.skipReason?.startsWith("Already imported"));
  const duplicates = report.events.filter((e) => e.skipReason?.startsWith("Identical"));

  console.log(`\n${report.fileName} → ${SHEET_NAME}`);
  console.log(report.committed ? "Mode: COMMIT — writing to the database" : "Mode: dry run — nothing is written");
  console.log(`Actor: ${actorLabel}`);

  console.log(`\n${report.events.length} events read`);
  console.log(`  ${pad("Imported", 22)}${willCreate.length}`);
  console.log(`  ${pad("Already imported", 22)}${alreadyThere.length}`);
  console.log(`  ${pad("Duplicate rows", 22)}${duplicates.length}`);
  console.log(`  ${pad("Errors (not imported)", 22)}${report.errors.length}`);

  const show = (heading: string, counts: [string, number][]) => {
    console.log(`\n${heading}`);
    for (const [label, count] of counts) console.log(`  ${pad(label || "(blank)", 34)}${count}`);
  };
  show(
    "Status",
    tally(report.events, (e) => `${e.statusLabel || "(blank)"} → ${LIFECYCLE_LABEL[e.lifecycleStatus]}`),
  );
  show(
    "Event type",
    tally(report.events, (e) => `${e.typeLabel || "(blank)"} → ${e.typeKey ?? "not imported"}`),
  );
  show(
    "Sub type",
    tally(report.events, (e) => `${e.subtypeLabel || "(blank)"} → ${e.subtypeName ?? "(blank)"}`),
  );
  show(
    "Region",
    tally(report.events, (e) => `${e.raw.Region || "(blank)"} → ${e.regionValue ?? "(blank)"}`),
  );

  console.log("\nOrganisations");
  const matched = new Set(
    report.events.filter((e) => e.partnerName && !e.partnerIsNew).map((e) => e.partnerName as string),
  );
  console.log(`  ${pad("Matched by name", 22)}${matched.size}${matched.size ? ` — ${[...matched].join(", ")}` : ""}`);
  for (const type of ["DISTRIBUTOR", "PARTNER"] as const) {
    const names = report.newPartners.filter((p) => p.type === type).map((p) => p.name);
    if (names.length) console.log(`  ${pad(`New ${type.toLowerCase()}s (${names.length})`, 22)}${names.join(", ")}`);
  }
  const noPartner = report.events.filter((e) => !e.partnerName).length;
  console.log(`  ${pad("Run without a partner", 22)}${noPartner} events`);

  console.log("\nMoney and work");
  console.log(`  ${pad("Cost lines", 22)}${report.totals.costLines}, ${inr(report.totals.budget)}`);
  console.log(`  ${pad("No budget figure", 22)}${willCreate.filter((e) => !e.costLines.length).length} events at ₹0`);
  console.log(`  ${pad("Tasks", 22)}${report.totals.tasks}`);

  // The sheet's own financial-year totals add up the Budget column, so that is the figure the
  // import has to reproduce. Any difference is named rather than left for someone to find.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const sum = (events: PlannedEvent[]) => round2(events.reduce((n, e) => n + (e.budget ?? 0), 0));
  const sheetTotal = sum(report.events);
  const dropped = sum(report.events.filter((e) => e.skipReason));
  const expected = round2(sheetTotal - dropped);
  const difference = round2(report.totals.budget - expected);
  console.log("\nReconciliation against the sheet's Budget column");
  console.log(`  ${pad(`All ${report.events.length} rows`, 34)}${inr(sheetTotal)}`);
  console.log(`  ${pad(`Less ${report.events.length - willCreate.length} row(s) not imported`, 34)}−${inr(dropped)}`);
  console.log(`  ${pad("Expected", 34)}${inr(expected)}`);
  console.log(`  ${pad("Imported", 34)}${inr(report.totals.budget)}${difference === 0 ? "  ✓" : ""}`);
  if (difference !== 0) {
    console.log(
      `  ${pad("Difference", 34)}${difference > 0 ? "+" : "−"}${inr(Math.abs(difference))} — priced subitems that exceed their event's budget cell`,
    );
  }

  if (report.missingConfig.length) {
    console.log("\nConfiguration missing — a commit would refuse to run");
    for (const line of report.missingConfig) console.log(`  ✗ ${line}`);
  }

  const warnings = report.events.flatMap((e) =>
    e.issues.filter((i) => i.severity === "warning").map((i) => ({ row: e.rowIndex, title: e.title, ...i })),
  );
  const noisy = new Set(["No budget in the sheet; recorded as ₹0.", "No date in the sheet."]);
  const notable = warnings.filter((w) => !noisy.has(w.message));
  console.log(`\nWarnings: ${warnings.length} (${warnings.length - notable.length} are simply blank cells)`);
  for (const warning of notable) {
    console.log(`  r${pad(String(warning.row), 5)}${pad(warning.title.slice(0, 34), 36)}${warning.message}`);
  }

  if (report.errors.length) {
    console.log(`\nErrors — these rows were not imported`);
    for (const event of report.errors) {
      for (const issue of event.issues.filter((i) => i.severity === "error")) {
        console.log(`  r${pad(String(event.rowIndex), 5)}${pad(event.title.slice(0, 34), 36)}${issue.message}`);
      }
    }
  }

  console.log("\nDecisions I made — say the word and I'll change any of them");
  DECISIONS.forEach((decision, i) => console.log(`  ${String(i + 1).padStart(2)}. ${decision}`));

  if (report.committed) {
    console.log(`\nDone. Import batch ${report.batchId}.`);
    const codes = willCreate.map((e) => e.code).filter(Boolean);
    if (codes.length) console.log(`Event codes ${codes[0]} … ${codes[codes.length - 1]}.`);
    console.log(`To undo: npm run import:channel-sheet -- "${filePath}" --remove`);
  }
}

async function main() {
  const fileName = path.basename(filePath);

  if (values.remove) {
    const removed = await removeChannelImport(db, fileName);
    console.log(
      `Removed ${removed.events} event(s), ${removed.batches} import batch(es) and ${removed.organizations} organisation(s) from "${fileName}".`,
    );
    if (!removed.batches) console.log("Nothing had been imported from that file name.");
    return;
  }

  const actor = await resolveActor();
  const sheet = await readChannelWorkbook(filePath);
  const report = await importChannelSheet(db, sheet, { actorId: actor.id, fileName, commit: values.commit });

  printReport(report, `${actor.name} <${actor.email}>`);

  const previewDir = path.join(process.cwd(), ".data", "import-preview");
  await mkdir(previewDir, { recursive: true });
  const preview = path.join(previewDir, `${path.parse(fileName).name}.md`);
  await writeFile(preview, reportToMarkdown(report, actor.email), "utf8");
  console.log(`\nFull row-by-row mapping: ${path.relative(process.cwd(), preview)}`);
  if (!report.committed) {
    console.log(`Read it, then re-run with --commit to import.`);
  }
}

main()
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
