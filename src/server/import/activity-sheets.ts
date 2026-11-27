/**
 * Reads the Channel Marketing Master Sheet's other three boards — Blitz, Webinar and Weekly
 * Pulse — and turns each into EventFlow events, filed under its own event type (see
 * `scripts/seed-config.ts`: `blitz`, `webinar`, `weekly_pulse`).
 *
 * All three share `glob - events`' board-export layout (a title row, a repeated header row per
 * financial-year group, item rows), so this reuses `parseChannelGrid` from `./channel-sheet`
 * unchanged — none of them has a "Subitems" column, so that parser's subitem branch simply never
 * fires. What differs per board is only the columns and the status vocabulary, which is why this
 * is one generic importer taking both as configuration rather than three near-duplicates.
 *
 * Deliberately simpler than `./channel-sheet`'s event importer: no budget, no cost lines, no
 * tasks, no partner resolution — these boards have none of that. Columns with no structural home
 * on `Event` (Person, Sales person, Speaker, Registrations, Attendee, Remarks, Time) are read
 * into `issues` as informational notes on the import row so they are visible in the preview and
 * on the `ImportRow` record, but are not invented a place on the event itself.
 */
import { Prisma, type ApprovalStatus, type LifecycleStatus, type PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { startOfIstDay } from "@/lib/date-range";
import { nextEventCode } from "@/server/events/codes";
import { cellText, parseChannelGrid, type ChannelSheet, type Issue } from "./channel-sheet";
import { resolveRegion } from "./regions";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type ActivityStatusMap = Record<string, { lifecycle: LifecycleStatus; approval: ApprovalStatus }>;

export type ActivitySheetConfig = {
  /** The worksheet name, exactly as it appears in the workbook. */
  sheetName: string;
  /** The `EventType.key` every row is filed under (see `scripts/seed-config.ts`). */
  typeKey: string;
  /** What this board calls itself, for messages. */
  label: string;
  nameColumn: string;
  statusColumn: string;
  dateColumn: string;
  /** These boards write regions their own way ("Ind - South", "ME", "Global"); see ./regions. */
  regionColumn?: string;
  cityColumn?: string;
  statusMap: ActivityStatusMap;
  /** Columns kept only as a note on the import row — see the file comment. */
  noteColumns: string[];
};

export type MappedActivity = {
  rowIndex: number;
  sourceKey: string;
  title: string;
  statusLabel: string;
  lifecycleStatus: LifecycleStatus;
  approvalStatus: ApprovalStatus;
  isoDate: string | null;
  region: string | null;
  city: string | null;
  notes: string | null;
  issues: Issue[];
  raw: Record<string, string>;
};

export type PlannedActivity = MappedActivity & {
  code: string | null;
  skipReason: string | null;
};

export type ActivityImportReport = {
  fileName: string;
  sheetName: string;
  label: string;
  committed: boolean;
  activities: PlannedActivity[];
  skipped: PlannedActivity[];
  errors: PlannedActivity[];
  missingConfig: string[];
  totals: { imported: number };
  batchId: string | null;
};

/** Reads one of these boards out of a workbook already open (or opened fresh from disk). */
export async function readActivitySheet(filePath: string, sheetName: string): Promise<ChannelSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    const names = workbook.worksheets.map((w) => `"${w.name}"`).join(", ");
    throw new Error(`The workbook has no "${sheetName}" sheet. It has ${names}.`);
  }
  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    grid[rowNumber - 1] = (row.values as unknown[]).slice(1).map(cellText);
  });
  for (let i = 0; i < grid.length; i++) grid[i] ??= [];
  return parseChannelGrid(grid);
}

export function mapActivityItem(
  cells: Record<string, string>,
  rowIndex: number,
  config: ActivitySheetConfig,
): MappedActivity {
  const get = (key?: string) => (key ? (cells[key] ?? "").trim() : "");
  const issues: Issue[] = [];

  const title = get(config.nameColumn);
  const statusLabel = get(config.statusColumn);
  const status = config.statusMap[norm(statusLabel)];
  if (!status) {
    issues.push({
      field: config.statusColumn,
      message: `Status "${statusLabel}" is not one the portal knows; imported as a draft.`,
      severity: "warning",
    });
  }

  const dateText = get(config.dateColumn);
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : null;
  if (!isoDate && dateText) {
    issues.push({ field: config.dateColumn, message: `Date "${dateText}" is not a single day; left blank.`, severity: "warning" });
  }

  const city = get(config.cityColumn) || null;
  // "Ind - South", "ME", "Global"… resolved to the portal's own region list; "Global" and "Pan Ind"
  // span regions, so they are stored as no region rather than squeezed into one.
  const region = resolveRegion(get(config.regionColumn), city);

  const notes =
    config.noteColumns
      .map((col) => {
        const value = get(col);
        return value ? `${col}: ${value}` : null;
      })
      .filter(Boolean)
      .join("\n") || null;

  // These boards carry no id of their own, so an item is identified by what makes it distinct.
  const sourceKey = [config.typeKey, norm(title), isoDate ?? "no-date"].join("|");

  return {
    rowIndex,
    sourceKey,
    title,
    statusLabel,
    lifecycleStatus: status?.lifecycle ?? "DRAFT",
    approvalStatus: status?.approval ?? "NOT_SUBMITTED",
    isoDate,
    region,
    city,
    notes,
    issues,
    raw: { ...cells, __row: String(rowIndex) },
  };
}

type ImportOptions = { actorId: string; fileName: string; commit: boolean };

/** Plans — and, when `commit` is set, performs — the import of one activity board. */
export async function importActivitySheet(
  db: PrismaClient,
  sheet: ChannelSheet,
  config: ActivitySheetConfig,
  { actorId, fileName, commit }: ImportOptions,
): Promise<ActivityImportReport> {
  const mapped = sheet.items
    .map((item) => mapActivityItem(item.cells, item.rowIndex, config))
    .filter((e) => e.title); // a row with no name is a stray spacer, not an activity

  const type = await db.eventType.findUnique({ where: { key: config.typeKey } });
  const missingConfig: string[] = [];
  if (!type) missingConfig.push(`Event type "${config.typeKey}" is not configured — run \`npm run config:seed\`.`);

  const priorRows = await db.importRow.findMany({
    where: { batch: { fileName, status: "DONE" } },
    select: { rawData: true, eventId: true },
  });
  const alreadyImported = new Set(
    priorRows
      .map((r) => (r.rawData as Record<string, unknown> | null)?.__sourceKey)
      .filter((k): k is string => typeof k === "string"),
  );

  const seen = new Map<string, number>();
  const planned: PlannedActivity[] = mapped.map((activity) => {
    const fatal = activity.issues.some((i) => i.severity === "error") || !type;
    const dup = seen.get(activity.sourceKey);
    let skipReason: string | null = null;
    if (alreadyImported.has(activity.sourceKey)) skipReason = "Already imported from this file.";
    else if (dup != null) skipReason = `Identical to row ${dup} in this board.`;
    else if (fatal) skipReason = !type ? "Event type is not configured." : "Row has an error; nothing was created.";
    if (dup == null) seen.set(activity.sourceKey, activity.rowIndex);
    return { ...activity, code: null, skipReason };
  });

  const report: ActivityImportReport = {
    fileName,
    sheetName: config.sheetName,
    label: config.label,
    committed: commit,
    activities: planned,
    skipped: planned.filter((a) => a.skipReason),
    errors: planned.filter((a) => a.issues.some((i) => i.severity === "error")),
    missingConfig,
    totals: { imported: planned.filter((a) => !a.skipReason).length },
    batchId: null,
  };

  if (!commit) return report;
  if (missingConfig.length) throw new Error(`Configuration is missing:\n  ${missingConfig.join("\n  ")}`);

  const batch = await db.importBatch.create({
    data: {
      uploadedById: actorId,
      fileName,
      columnMap: [
        { sourceColumn: config.nameColumn, targetField: "title" },
        { sourceColumn: config.statusColumn, targetField: "lifecycleStatus" },
        { sourceColumn: config.dateColumn, targetField: "proposedDate" },
        ...(config.regionColumn ? [{ sourceColumn: config.regionColumn, targetField: "region" }] : []),
        ...(config.cityColumn ? [{ sourceColumn: config.cityColumn, targetField: "city" }] : []),
        ...config.noteColumns.map((c) => ({ sourceColumn: c, targetField: null })),
      ] as unknown as Prisma.InputJsonValue,
      status: "PROCESSING",
      totalRows: planned.length,
    },
  });
  report.batchId = batch.id;

  for (const activity of planned) {
    if (activity.skipReason) {
      await db.importRow.create({
        data: {
          batchId: batch.id,
          rowIndex: activity.rowIndex,
          rawData: { ...activity.raw, __sourceKey: activity.sourceKey },
          mapped: {},
          status: activity.issues.some((i) => i.severity === "error") ? "ERROR" : "SKIPPED",
          issues: activity.issues as unknown as Prisma.InputJsonValue,
        },
      });
      continue;
    }

    const code = await db.$transaction(async (tx) => {
      const when = activity.isoDate ? startOfIstDay(activity.isoDate) : null;
      const code = await nextEventCode(tx, when ?? new Date());
      const answers: Record<string, unknown> = { "basic.name": activity.title };
      if (activity.isoDate) answers["basic.proposedDate"] = activity.isoDate;
      if (activity.region) answers["basic.region"] = activity.region;
      if (activity.city) answers["basic.city"] = activity.city;

      const row = await tx.event.create({
        data: {
          code,
          title: activity.title,
          eventTypeId: type!.id,
          department: "CHANNEL",
          requesterId: actorId,
          lifecycleStatus: activity.lifecycleStatus,
          approvalStatus: activity.approvalStatus,
          droppedReason:
            activity.lifecycleStatus === "DROPPED"
              ? `Recorded as "${activity.statusLabel}" in the Channel Marketing Master Sheet (${config.label}).`
              : null,
          answers: answers as Prisma.InputJsonValue,
          proposedDate: when,
          city: activity.city,
          region: activity.region,
          closedAt: activity.lifecycleStatus === "CLOSED" ? when : null,
        },
      });

      if (activity.notes) {
        await tx.postEventResult.create({ data: { eventId: row.id, notes: activity.notes } });
      }

      await tx.importRow.create({
        data: {
          batchId: batch.id,
          rowIndex: activity.rowIndex,
          rawData: { ...activity.raw, __sourceKey: activity.sourceKey },
          mapped: { title: activity.title, lifecycleStatus: activity.lifecycleStatus } as Prisma.InputJsonValue,
          status: activity.issues.length ? "WARNING" : "OK",
          issues: activity.issues as unknown as Prisma.InputJsonValue,
          eventId: row.id,
        },
      });
      return code;
    });
    activity.code = code;
  }

  const done = planned.filter((a) => a.code);
  await db.importBatch.update({
    where: { id: batch.id },
    data: {
      status: "DONE",
      okRows: done.filter((a) => !a.issues.length).length,
      warnRows: done.filter((a) => a.issues.length).length,
      errorRows: report.errors.length,
      skippedRows: planned.filter((a) => a.skipReason && !report.errors.includes(a)).length,
    },
  });

  return report;
}
