import { NextResponse } from "next/server";
import { getAccessPolicy, type Viewer } from "@/server/access/policy";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getOutcomeReport } from "@/server/reports/queries";
import { csvDay, csvFile, csvHeaders } from "@/lib/csv";
import { resolveDateRange } from "@/lib/date-range";
import { DEPARTMENT_LABEL } from "@/lib/permissions";

export async function GET(request: Request) {
  const user = await requirePermission("reports.view");
  const viewer: Viewer = { id: user.id, roles: user.roles, department: user.department };
  const policy = await getAccessPolicy(db);

  const url = new URL(request.url);
  const depts = url.searchParams.getAll("dept");

  // The same resolver the screen uses, so the file matches what was on screen
  // when the button was pressed — including what `?range=fy` means today.
  const range = resolveDateRange({
    range: url.searchParams.get("range"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });

  const rows = await getOutcomeReport(db, viewer, policy, range, depts.length ? depts : undefined);

  const header = [
    "Event ID",
    "Event name",
    "Department",
    "Proposed date",
    "Actual attendance",
    "Companies engaged",
    "New leads",
    "SQLs",
    "Opportunities",
    "Meetings conducted",
    "Actual ROI",
  ];

  // Built with the shared CSV helpers, like the budget export: they quote the
  // fields that need it, defuse anything a spreadsheet would read as a formula,
  // and emit the BOM Excel needs. A blank cell is a metric nobody recorded, so
  // it stays blank rather than becoming a zero somebody could average.
  const csv = csvFile(
    header,
    rows.map((r) => [
      r.code,
      r.title,
      DEPARTMENT_LABEL[r.department as keyof typeof DEPARTMENT_LABEL] ?? r.department,
      csvDay(r.proposedDate),
      r.actualAttendance,
      r.companiesEngaged,
      r.newLeads,
      r.sqls,
      r.opportunities,
      r.meetingsConducted,
      r.actualRoi,
    ]),
  );

  return new NextResponse(csv, {
    headers: csvHeaders(`eventflow-outcomes-${csvDay(new Date())}.csv`),
  });
}
