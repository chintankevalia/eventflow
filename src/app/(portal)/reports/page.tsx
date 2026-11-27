import type { Metadata } from "next";
import { activeRangeKey, formatRangeDMY, resolveDateRange } from "@/lib/date-range";
import { getAccessPolicy, type Viewer } from "@/server/access/policy";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getApprovalTurnaround, getBudgetReport, getDepartmentSpend, getMonthlySpend, getOutcomeReport } from "@/server/reports/queries";
import { ReportsDashboard } from "./reports-dashboard";

export const metadata: Metadata = { title: "Budget & Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string; from?: string; to?: string; dept?: string | string[] }>;
}) {
  const user = await requirePagePermission("reports.view");
  const viewer: Viewer = { id: user.id, roles: user.roles, department: user.department };
  const policy = await getAccessPolicy(db);

  const sp = await searchParams;
  const depts = sp.dept ? (Array.isArray(sp.dept) ? sp.dept : [sp.dept]) : [];

  // `?range=` names the period — "fy", "quarter" — and the dates it stands for
  // are worked out here. The two date fields only speak for `range=custom`.
  const rangeKey = activeRangeKey(sp);
  const range = resolveDateRange(sp);

  const [budgetRows, outcomeRows, deptSpend, turnaround, monthly] = await Promise.all([
    getBudgetReport(db, viewer, policy, range, depts.length ? depts : undefined),
    getOutcomeReport(db, viewer, policy, range, depts.length ? depts : undefined),
    getDepartmentSpend(db, viewer, policy, range),
    getApprovalTurnaround(db, viewer, policy, range),
    // The trend keeps its own window — six months back, six ahead — whatever
    // period is selected, because a trend over "last 30 days" is one bar. It
    // must still respect the department chips, or it contradicts every other
    // figure on the page.
    getMonthlySpend(db, viewer, policy, { departments: depts.length ? depts : undefined }),
  ]);

  return (
    <ReportsDashboard
      budgetRows={budgetRows}
      outcomeRows={outcomeRows}
      deptSpend={deptSpend}
      turnaround={turnaround}
      monthly={monthly}
      currentTab={sp.tab ?? "budget"}
      currentRange={rangeKey}
      currentFrom={sp.from ?? ""}
      currentTo={sp.to ?? ""}
      rangeLabel={range ? formatRangeDMY(range) : ""}
      currentDepts={depts}
    />
  );
}
