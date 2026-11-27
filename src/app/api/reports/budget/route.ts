import { NextResponse } from "next/server";
import { getAccessPolicy, type Viewer } from "@/server/access/policy";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getBudgetReport } from "@/server/reports/queries";
import { csvDay, csvFile, csvHeaders } from "@/lib/csv";
import { resolveDateRange } from "@/lib/date-range";
import { DEPARTMENT_LABEL } from "@/lib/permissions";
import { LIFECYCLE_META } from "@/lib/lifecycle";

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

  const rows = await getBudgetReport(db, viewer, policy, range, depts.length ? depts : undefined);

  const header = [
    "Event ID",
    "Event name",
    "Department",
    "Status",
    "Proposed date",
    "Estimated (INR)",
    "Approved (INR)",
    "Actual (INR)",
    "Variance (INR)",
    "Motadata contribution (INR)",
    "Partner contribution (INR)",
    "MDF / co-marketing (INR)",
  ];

  // Amounts go out as plain numbers. They used to go through `formatINR`, whose
  // `₹2,50,000` put commas inside unquoted fields and split every 12-column row
  // into 24 — and left Finance unable to sum a column of text.
  const csv = csvFile(
    header,
    rows.map((r) => [
      r.code,
      r.title,
      DEPARTMENT_LABEL[r.department as keyof typeof DEPARTMENT_LABEL] ?? r.department,
      LIFECYCLE_META[r.lifecycleStatus as keyof typeof LIFECYCLE_META]?.label ?? r.lifecycleStatus,
      csvDay(r.proposedDate),
      r.estimated,
      r.approved,
      r.actual,
      r.variance,
      r.motadata,
      r.partner,
      r.mdf,
    ]),
  );

  return new NextResponse(csv, {
    headers: csvHeaders(`eventflow-budget-${csvDay(new Date())}.csv`),
  });
}
