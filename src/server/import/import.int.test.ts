import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, makeActor, uid } from "../../../tests/integration/helpers";
import { buildPreview, executeImport, parseExcelBuffer } from "./service";
import ExcelJS from "exceljs";

// ── Helper: build an in-memory .xlsx buffer ───────────────────────────────────

async function makeXlsx(
  headers: string[],
  rows: (string | number | null)[][],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Events");
  ws.addRow(headers);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Excel import", () => {
  let actorId: string;

  beforeAll(async () => {
    const actor = await makeActor("Import Tester");
    actorId = actor.id;
    // Ensure a default event type exists
    const existing = await db.eventType.findFirst();
    if (!existing) {
      await db.eventType.create({
        data: { key: "default", name: "Default", active: true, sortOrder: 0 },
      });
    }
  });

  afterAll(() => db.$disconnect());

  // ── parseExcelBuffer ─────────────────────────────────────────────────────────

  it("parses headers and data rows from an xlsx buffer", async () => {
    const buf = await makeXlsx(
      ["Event Name", "Department", "Proposed Date"],
      [
        ["Partner Summit", "SALES", "2026-12-01"],
        ["Tech Meetup", "MARKETING", "2027-01-15"],
      ],
    );
    const { headers, rows } = await parseExcelBuffer(buf);
    expect(headers).toEqual(["Event Name", "Department", "Proposed Date"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]["Event Name"]).toBe("Partner Summit");
    expect(rows[1]["Department"]).toBe("MARKETING");
  });

  it("throws when the first row is empty (no headers)", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Empty");
    const buf = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
    await expect(parseExcelBuffer(buf)).rejects.toThrow(/no column headers/i);
  });

  it("skips blank rows", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet");
    ws.addRow(["Event Name"]);
    ws.addRow(["Real event"]);
    ws.addRow([""]); // blank
    ws.addRow(["Another event"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
    const { rows } = await parseExcelBuffer(buf);
    expect(rows).toHaveLength(2);
  });

  // ── buildPreview ─────────────────────────────────────────────────────────────

  it("auto-maps common header names and reports no errors for a valid row", async () => {
    const buf = await makeXlsx(
      ["Event Name", "Department", "Date", "City"],
      [["Channel Day", "CHANNEL", "2026-11-10", "Pune"]],
    );
    const result = await buildPreview(buf, [], db);
    expect(result.totalRows).toBe(1);
    expect(result.errorCount).toBe(0);
    const row = result.rows[0];
    expect(row.status).toBe("OK");
    expect(row.mapped.title).toBe("Channel Day");
    expect(row.mapped.department).toBe("CHANNEL");
    expect(row.mapped.city).toBe("Pune");
  });

  it("flags a missing required title as ERROR", async () => {
    const buf = await makeXlsx(
      ["Department", "Date"],
      [["SALES", "2026-11-10"]],
    );
    const result = await buildPreview(buf, [], db);
    expect(result.errorCount).toBe(1);
    const row = result.rows[0];
    expect(row.status).toBe("ERROR");
    expect(row.issues.some((i) => i.field === "title")).toBe(true);
  });

  it("flags an invalid department value as WARNING (not ERROR)", async () => {
    const buf = await makeXlsx(
      ["Event Name", "Department"],
      [["Test Event", "UNKNOWN_DEPT"]],
    );
    const result = await buildPreview(buf, [], db);
    const row = result.rows[0];
    expect(row.issues.some((i) => i.field === "department" && i.severity === "warning")).toBe(true);
  });

  it("detects a duplicate event code as ERROR", async () => {
    const code = `EF-2026-${uid().slice(0, 4).toUpperCase()}`;
    await db.event.create({
      data: {
        code,
        title: "Pre-existing",
        eventTypeId: (await db.eventType.findFirst())!.id,
        department: "SALES",
        requesterId: actorId,
        lifecycleStatus: "DRAFT",
        approvalStatus: "NOT_SUBMITTED",
      },
    });

    const buf = await makeXlsx(
      ["Event Name", "Event Code", "Department"],
      [["Duplicate event", code, "SALES"]],
    );
    const result = await buildPreview(buf, [], db);
    expect(result.errorCount).toBe(1);
    expect(result.rows[0].issues.some((i) => i.field === "code")).toBe(true);
  });

  it("strips INR symbols and commas from numeric fields", async () => {
    const buf = await makeXlsx(
      ["Event Name", "Department", "Estimated Budget (INR)"],
      [["Budget Test", "SALES", "₹1,50,000"]],
    );
    const result = await buildPreview(
      buf,
      [
        { sourceColumn: "Event Name", targetField: "title" },
        { sourceColumn: "Department", targetField: "department" },
        { sourceColumn: "Estimated Budget (INR)", targetField: "estimatedCost" },
      ],
      db,
    );
    expect(result.rows[0].mapped.estimatedCost).toBe(150000);
  });

  // ── executeImport ─────────────────────────────────────────────────────────────

  it("creates events for valid rows and records ImportBatch/ImportRow", async () => {
    const title = `Import Test ${uid()}`;
    const buf = await makeXlsx(
      ["Event Name", "Department", "Date", "City", "Status"],
      [[title, "MARKETING", "2026-11-20", "Mumbai", "CLOSED"]],
    );

    const result = await executeImport(
      buf,
      [
        { sourceColumn: "Event Name", targetField: "title" },
        { sourceColumn: "Department", targetField: "department" },
        { sourceColumn: "Date", targetField: "proposedDate" },
        { sourceColumn: "City", targetField: "city" },
        { sourceColumn: "Status", targetField: "lifecycleStatus" },
      ],
      actorId,
      "test-import.xlsx",
      db,
    );

    expect(result.okRows).toBe(1);
    expect(result.errorRows).toBe(0);

    const batch = await db.importBatch.findUnique({ where: { id: result.batchId } });
    expect(batch?.status).toBe("DONE");
    expect(batch?.okRows).toBe(1);

    const importRow = await db.importRow.findFirst({ where: { batchId: result.batchId } });
    expect(importRow?.status).toBe("OK");
    expect(importRow?.eventId).toBeTruthy();

    const event = await db.event.findUnique({ where: { id: importRow!.eventId! } });
    expect(event?.title).toBe(title);
    expect(event?.lifecycleStatus).toBe("CLOSED");
    expect(event?.city).toBe("Mumbai");
  });

  it("skips rows with errors and marks them ERROR in ImportRow", async () => {
    const buf = await makeXlsx(
      ["Department", "Date"],
      [["SALES", "2026-12-01"]], // missing title
    );

    const result = await executeImport(buf, [], actorId, "error-test.xlsx", db);
    expect(result.errorRows).toBe(1);
    expect(result.okRows).toBe(0);

    const row = await db.importRow.findFirst({ where: { batchId: result.batchId } });
    expect(row?.status).toBe("ERROR");
  });

  it("skips duplicate codes and records them as SKIPPED", async () => {
    const code = `EF-SKIP-${uid().slice(0, 4).toUpperCase()}`;
    await db.event.create({
      data: {
        code,
        title: "Already exists",
        eventTypeId: (await db.eventType.findFirst())!.id,
        department: "SALES",
        requesterId: actorId,
        lifecycleStatus: "DRAFT",
        approvalStatus: "NOT_SUBMITTED",
      },
    });

    const buf = await makeXlsx(
      ["Event Name", "Event Code", "Department"],
      [["Dup import", code, "SALES"]],
    );

    const result = await executeImport(
      buf,
      [
        { sourceColumn: "Event Name", targetField: "title" },
        { sourceColumn: "Event Code", targetField: "code" },
        { sourceColumn: "Department", targetField: "department" },
      ],
      actorId,
      "dup-test.xlsx",
      db,
    );

    expect(result.skippedRows).toBe(1);
    expect(result.okRows).toBe(0);
  });

  it("creates PostEventResult when outcome fields are present in a CLOSED row", async () => {
    const title = `Outcome Import ${uid()}`;
    const buf = await makeXlsx(
      ["Event Name", "Department", "Status", "Actual Attendance", "New Leads", "Actual ROI"],
      [[title, "CHANNEL", "CLOSED", 85, 14, "High — 3 opportunities created"]],
    );

    const result = await executeImport(
      buf,
      [
        { sourceColumn: "Event Name", targetField: "title" },
        { sourceColumn: "Department", targetField: "department" },
        { sourceColumn: "Status", targetField: "lifecycleStatus" },
        { sourceColumn: "Actual Attendance", targetField: "actualAttendance" },
        { sourceColumn: "New Leads", targetField: "newLeads" },
        { sourceColumn: "Actual ROI", targetField: "actualRoi" },
      ],
      actorId,
      "outcome-import.xlsx",
      db,
    );

    expect(result.okRows).toBe(1);
    const row = await db.importRow.findFirst({ where: { batchId: result.batchId } });
    const per = await db.postEventResult.findUnique({ where: { eventId: row!.eventId! } });
    expect(per?.actualAttendance).toBe(85);
    expect(per?.newLeads).toBe(14);
    expect(per?.actualRoi).toContain("3 opportunities");
  });
});
