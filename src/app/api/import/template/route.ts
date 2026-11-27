import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/session";
import ExcelJS from "exceljs";
import { IMPORT_FIELDS } from "@/server/import/fields";

export async function GET() {
  await requirePermission("import.manage");

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Events");

  // Header row
  sheet.addRow(IMPORT_FIELDS.map((f) => f.label));

  // Style header
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F4" } };

  // Set column widths and add validation hints as comments
  IMPORT_FIELDS.forEach((f, i) => {
    const col = sheet.getColumn(i + 1);
    col.width = Math.max(f.label.length + 4, 18);
    if (f.hint) {
      const cell = headerRow.getCell(i + 1);
      cell.note = f.hint;
    }
    // Mark required columns
    if (f.required) {
      const cell = headerRow.getCell(i + 1);
      cell.font = { bold: true, color: { argb: "FFF17463" } };
    }
  });

  // Sample row
  sheet.addRow(
    IMPORT_FIELDS.map((f) => {
      if (f.key === "title") return "Partner Summit – Ahmedabad";
      if (f.key === "department") return "CHANNEL";
      if (f.key === "proposedDate") return "2026-11-15";
      if (f.key === "durationDays") return 1;
      if (f.key === "city") return "Ahmedabad";
      if (f.key === "region") return "West";
      if (f.key === "format") return "Physical";
      if (f.key === "productFocus") return "Both";
      if (f.key === "lifecycleStatus") return "CLOSED";
      if (f.key === "estimatedCost") return 150000;
      if (f.key === "actualCost") return 142000;
      if (f.key === "actualAttendance") return 45;
      if (f.key === "newLeads") return 12;
      if (f.key === "sqls") return 3;
      return "";
    }),
  );

  const buf = Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="eventflow-import-template.xlsx"`,
    },
  });
}
