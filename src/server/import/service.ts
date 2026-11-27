import "server-only";
import ExcelJS from "exceljs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { nextEventCode } from "@/server/events/codes";
import { IMPORT_FIELDS, IMPORT_FIELD_BY_KEY, guessFieldKey } from "./fields";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ColumnMapEntry = { sourceColumn: string; targetField: string | null };

export type RowIssue = { field: string; message: string; severity: "error" | "warning" };

export type ParsedRow = {
  rowIndex: number;
  rawData: Record<string, string>;
  mapped: Record<string, unknown>;
  issues: RowIssue[];
  status: "OK" | "WARNING" | "ERROR" | "SKIPPED";
};

export type PreviewResult = {
  headers: string[];
  autoMap: ColumnMapEntry[];
  rows: ParsedRow[];
  totalRows: number;
  errorCount: number;
  warnCount: number;
};

// ─── Excel parser ─────────────────────────────────────────────────────────────

export async function parseExcelBuffer(buffer: Buffer): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS expects its own Buffer type; pass via ArrayBuffer to satisfy the overload.
  await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook contains no worksheets.");

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? "").trim());
  });

  if (headers.length === 0) throw new Error("The first row is empty — no column headers found.");

  const rows: Record<string, string>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      const cell = row.getCell(i + 1);
      let val = "";
      if (cell.value instanceof Date) {
        // Deliberately UTC, unlike every other date in the app: ExcelJS turns a
        // date cell into UTC midnight, so a cell reading 10-Dec-2026 arrives as
        // `2026-12-10T00:00:00Z`. Reading it as an Indian day would push it to
        // the 11th. The `yyyy-mm-dd` that comes out of here is anchored to IST
        // later, when the value is written.
        val = cell.value.toISOString().slice(0, 10);
      } else if (cell.value !== null && cell.value !== undefined) {
        val = String(cell.value).trim();
      }
      record[h] = val;
    });
    // Skip completely empty rows
    if (Object.values(record).some((v) => v !== "")) rows.push(record);
  });

  return { headers, rows };
}

// ─── Value coercion & validation ──────────────────────────────────────────────

function coerceValue(raw: string, fieldKey: string): { value: unknown; issue: RowIssue | null } {
  const def = IMPORT_FIELD_BY_KEY[fieldKey];
  if (!def) return { value: raw, issue: null };

  if (raw === "" || raw === null || raw === undefined) {
    if (def.required) {
      return { value: null, issue: { field: fieldKey, message: `${def.label} is required.`, severity: "error" } };
    }
    return { value: null, issue: null };
  }

  if (def.type === "number") {
    // Strip currency symbols, commas, spaces
    const cleaned = raw.replace(/[₹,\s]/g, "");
    const n = Number(cleaned);
    if (isNaN(n)) {
      return {
        value: null,
        issue: { field: fieldKey, message: `${def.label}: "${raw}" is not a valid number.`, severity: "error" },
      };
    }
    return { value: n, issue: null };
  }

  if (def.type === "date") {
    const d = new Date(raw);
    if (isNaN(d.getTime())) {
      return {
        value: null,
        issue: { field: fieldKey, message: `${def.label}: "${raw}" is not a valid date.`, severity: "error" },
      };
    }
    return { value: d.toISOString(), issue: null };
  }

  if (def.type === "enum" && def.enumValues) {
    // Case-insensitive match
    const match = def.enumValues.find((v) => v.toLowerCase() === raw.toLowerCase());
    if (!match) {
      return {
        value: raw,
        issue: {
          field: fieldKey,
          message: `${def.label}: "${raw}" is not one of ${def.enumValues.join(", ")}.`,
          severity: "warning",
        },
      };
    }
    return { value: match, issue: null };
  }

  return { value: raw, issue: null };
}

// ─── Row mapping & validation ─────────────────────────────────────────────────

function mapRow(rawData: Record<string, string>, columnMap: ColumnMapEntry[]): { mapped: Record<string, unknown>; issues: RowIssue[] } {
  const mapped: Record<string, unknown> = {};
  const issues: RowIssue[] = [];

  for (const entry of columnMap) {
    if (!entry.targetField) continue;
    const raw = rawData[entry.sourceColumn] ?? "";
    const { value, issue } = coerceValue(raw, entry.targetField);
    mapped[entry.targetField] = value;
    if (issue) issues.push(issue);
  }

  // Check required fields that were not in the column map at all
  for (const f of IMPORT_FIELDS) {
    if (f.required && !(f.key in mapped)) {
      issues.push({ field: f.key, message: `${f.label} column is not mapped.`, severity: "error" });
    }
  }

  return { mapped, issues };
}

// ─── Preview (no DB writes) ───────────────────────────────────────────────────

export async function buildPreview(
  buffer: Buffer,
  columnMap: ColumnMapEntry[],
  db: PrismaClient = defaultDb,
): Promise<PreviewResult> {
  const { headers, rows } = await parseExcelBuffer(buffer);
  const autoMap: ColumnMapEntry[] = headers.map((h) => ({
    sourceColumn: h,
    targetField: columnMap.find((e) => e.sourceColumn === h)?.targetField ?? guessFieldKey(h),
  }));

  // Collect all codes and titles+dates to detect duplicates within file and against DB
  const codesToCheck = rows
    .map((r) => {
      const codeEntry = autoMap.find((e) => e.targetField === "code");
      return codeEntry ? r[codeEntry.sourceColumn] : "";
    })
    .filter(Boolean);

  const existingCodes = codesToCheck.length
    ? await db.event.findMany({ where: { code: { in: codesToCheck } }, select: { code: true } })
    : [];
  const existingCodeSet = new Set(existingCodes.map((e) => e.code));

  const parsedRows: ParsedRow[] = rows.map((rawData, i) => {
    const { mapped, issues } = mapRow(rawData, autoMap);

    // Duplicate check
    const code = mapped.code as string | null;
    if (code && existingCodeSet.has(code)) {
      issues.push({ field: "code", message: `Event code "${code}" already exists in the database.`, severity: "error" });
    }

    // Title is required: synthesise from event name
    if (!mapped.title) {
      issues.push({ field: "title", message: "Event Name is required.", severity: "error" });
    }

    const hasError = issues.some((i) => i.severity === "error");
    const hasWarn = issues.some((i) => i.severity === "warning");
    const status = hasError ? "ERROR" : hasWarn ? "WARNING" : "OK";

    return { rowIndex: i + 2, rawData, mapped, issues, status };
  });

  const errorCount = parsedRows.filter((r) => r.status === "ERROR").length;
  const warnCount = parsedRows.filter((r) => r.status === "WARNING").length;

  return { headers, autoMap, rows: parsedRows, totalRows: rows.length, errorCount, warnCount };
}

// ─── Import execution ─────────────────────────────────────────────────────────

export type ImportResult = {
  batchId: string;
  totalRows: number;
  okRows: number;
  warnRows: number;
  errorRows: number;
  skippedRows: number;
};

export async function executeImport(
  buffer: Buffer,
  columnMap: ColumnMapEntry[],
  actorId: string,
  fileName: string,
  db: PrismaClient = defaultDb,
): Promise<ImportResult> {
  const { rows } = await parseExcelBuffer(buffer);

  // Resolve default event type (first active one)
  const defaultEventType = await db.eventType.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  if (!defaultEventType) throw new Error("No active event types found. Create one in Settings → Form Fields.");

  // Create the batch record
  const batch = await db.importBatch.create({
    data: {
      uploadedById: actorId,
      fileName,
      columnMap: columnMap as unknown as Prisma.InputJsonValue,
      status: "PROCESSING",
      totalRows: rows.length,
    },
  });

  let okRows = 0;
  let warnRows = 0;
  let errorRows = 0;
  let skippedRows = 0;

  for (let i = 0; i < rows.length; i++) {
    const rawData = rows[i];
    const { mapped, issues } = mapRow(rawData, columnMap);

    const hasError = issues.some((iss) => iss.severity === "error");
    if (hasError) {
      await db.importRow.create({
        data: {
          batchId: batch.id,
          rowIndex: i + 2,
          rawData: rawData as unknown as Prisma.InputJsonValue,
          mapped: mapped as unknown as Prisma.InputJsonValue,
          status: "ERROR",
          issues: issues as unknown as Prisma.InputJsonValue,
        },
      });
      errorRows++;
      continue;
    }

    // Check duplicate
    const code = mapped.code as string | undefined;
    if (code) {
      const existing = await db.event.findUnique({ where: { code }, select: { id: true } });
      if (existing) {
        await db.importRow.create({
          data: {
            batchId: batch.id,
            rowIndex: i + 2,
            rawData: rawData as unknown as Prisma.InputJsonValue,
            mapped: mapped as unknown as Prisma.InputJsonValue,
            status: "SKIPPED",
            issues: [
              { field: "code", message: `Event code "${code}" already exists; row skipped.`, severity: "error" },
            ] as unknown as Prisma.InputJsonValue,
          },
        });
        skippedRows++;
        continue;
      }
    }

    try {
      const eventId = await db.$transaction(async (tx) => {
        const eventCode = code || (await nextEventCode(tx));
        const title = mapped.title as string;
        const department = (mapped.department as string) || "OTHER";
        const lifecycleStatus = (mapped.lifecycleStatus as string) || "DRAFT";
        const approvalStatus = ["APPROVED", "IN_EXECUTION", "CLOSED"].includes(lifecycleStatus) ? "APPROVED" : "NOT_SUBMITTED";

        const event = await tx.event.create({
          data: {
            code: eventCode,
            title,
            eventTypeId: defaultEventType.id,
            department: department as never,
            requesterId: actorId,
            ownerId: actorId,
            lifecycleStatus: lifecycleStatus as never,
            approvalStatus: approvalStatus as never,
            proposedDate: mapped.proposedDate ? new Date(mapped.proposedDate as string) : null,
            durationDays: mapped.durationDays != null ? Number(mapped.durationDays) : null,
            city: (mapped.city as string) || null,
            region: (mapped.region as string) || null,
            format: (mapped.format as string) || null,
            productFocus: (mapped.productFocus as string) || null,
            estimatedCost: mapped.estimatedCost != null ? new Prisma.Decimal(Number(mapped.estimatedCost)) : new Prisma.Decimal(0),
            actualCost: mapped.actualCost != null ? new Prisma.Decimal(Number(mapped.actualCost)) : new Prisma.Decimal(0),
            motadataContribution: mapped.motadataContribution != null ? new Prisma.Decimal(Number(mapped.motadataContribution)) : null,
            partnerContribution: mapped.partnerContribution != null ? new Prisma.Decimal(Number(mapped.partnerContribution)) : null,
            mdfAllocation: mapped.mdfAllocation != null ? new Prisma.Decimal(Number(mapped.mdfAllocation)) : null,
            answers: {
              "basic.name": title,
              ...(mapped.objective ? { "basic.objective": mapped.objective } : {}),
            } as Prisma.InputJsonValue,
            closedAt: lifecycleStatus === "CLOSED" ? (mapped.proposedDate ? new Date(mapped.proposedDate as string) : new Date()) : null,
          },
        });

        // Post-event results if outcomes are present
        const hasOutcomes =
          mapped.actualAttendance != null ||
          mapped.newLeads != null ||
          mapped.sqls != null ||
          mapped.companiesEngaged != null ||
          mapped.actualRoi != null;
        if (hasOutcomes && ["IN_EXECUTION", "CLOSED"].includes(lifecycleStatus)) {
          await tx.postEventResult.create({
            data: {
              eventId: event.id,
              actualAttendance: mapped.actualAttendance != null ? Number(mapped.actualAttendance) : null,
              companiesEngaged: mapped.companiesEngaged != null ? Number(mapped.companiesEngaged) : null,
              newLeads: mapped.newLeads != null ? Number(mapped.newLeads) : null,
              sqls: mapped.sqls != null ? Number(mapped.sqls) : null,
              actualRoi: (mapped.actualRoi as string) || null,
            },
          });
        }

        return event.id;
      });

      const hasWarn = issues.some((iss) => iss.severity === "warning");
      await db.importRow.create({
        data: {
          batchId: batch.id,
          rowIndex: i + 2,
          rawData: rawData as unknown as Prisma.InputJsonValue,
          mapped: mapped as unknown as Prisma.InputJsonValue,
          status: hasWarn ? "WARNING" : "OK",
          issues: issues as unknown as Prisma.InputJsonValue,
          eventId,
        },
      });
      if (hasWarn) warnRows++; else okRows++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.importRow.create({
        data: {
          batchId: batch.id,
          rowIndex: i + 2,
          rawData: rawData as unknown as Prisma.InputJsonValue,
          mapped: mapped as unknown as Prisma.InputJsonValue,
          status: "ERROR",
          issues: [{ field: "_row", message: msg, severity: "error" }] as unknown as Prisma.InputJsonValue,
        },
      });
      errorRows++;
    }
  }

  await db.importBatch.update({
    where: { id: batch.id },
    data: { status: "DONE", okRows, warnRows, errorRows, skippedRows },
  });

  return { batchId: batch.id, totalRows: rows.length, okRows, warnRows, errorRows, skippedRows };
}
