"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import {
  type ContributionBar,
  ContributionChart,
  DepartmentSpendChart,
  SpendTrendChart,
  TurnaroundChart,
} from "@/components/charts";
import { ChartFrame, ChartLegend } from "@/components/charts/chart-frame";
import { CHART_COLOR, monthLabel } from "@/components/charts/chart-tokens";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Stat } from "@/components/ui/stat";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableFoot,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RANGE_PRESETS, type RangeKey } from "@/lib/date-range";
import { formatINR, formatINRCompact } from "@/lib/format";
import { DEPARTMENT_LABEL } from "@/lib/permissions";
import { LIFECYCLE_META } from "@/lib/lifecycle";
import type { BudgetRow, DeptSpend, OutcomeRow, ApprovalTurnaround, MonthlySeries } from "@/server/reports/queries";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "budget", label: "Budget & Spend" },
  { key: "outcomes", label: "Outcomes" },
  { key: "approvals", label: "Approval Turnaround" },
];

const DEPARTMENTS = ["SALES", "MARKETING", "CHANNEL", "FINANCE", "MANAGEMENT", "OTHER"] as const;

function deptLabel(d: string) {
  return DEPARTMENT_LABEL[d as keyof typeof DEPARTMENT_LABEL] ?? d;
}

/**
 * Over the approved budget is red, under it is green, and no approved figure
 * yet is neither. Colour is never the only signal — the number carries a `+`
 * when it is an overspend, for anyone who cannot tell the two hues apart.
 */
function varianceTone(variance: number | null) {
  if (variance === null || variance === 0) return undefined;
  return variance > 0 ? "text-destructive" : "text-success";
}

/**
 * Totals one optional column. A row that never recorded the metric contributes
 * nothing rather than breaking the sum, which is why every outcome total goes
 * through here instead of a bare `+`.
 */
function sumBy<T>(rows: T[], pick: (row: T) => number | null) {
  return rows.reduce((sum, row) => sum + (pick(row) ?? 0), 0);
}

export function ReportsDashboard({
  budgetRows,
  outcomeRows,
  deptSpend,
  turnaround,
  monthly,
  currentTab,
  currentRange,
  currentFrom,
  currentTo,
  rangeLabel,
  currentDepts,
}: {
  budgetRows: BudgetRow[];
  outcomeRows: OutcomeRow[];
  deptSpend: DeptSpend[];
  turnaround: ApprovalTurnaround[];
  monthly: MonthlySeries[];
  currentTab: string;
  currentRange: RangeKey;
  currentFrom: string;
  currentTo: string;
  /** The dates the active range resolved to, `dd-mm-yyyy`, worked out server-side. */
  rangeLabel: string;
  currentDepts: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function hrefWith(patch: Record<string, string | string[] | undefined>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      next.delete(k);
      if (Array.isArray(v)) v.forEach((val) => next.append(k, val));
      else if (v) next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function navigate(patch: Record<string, string | string[] | undefined>) {
    router.push(hrefWith(patch));
  }

  /**
   * Picking a named period drops any leftover custom dates, so the URL only
   * ever carries the one that is in force. Custom keeps them, because they are
   * what it means.
   */
  function rangeHref(key: RangeKey) {
    if (key === "custom") return hrefWith({ range: "custom" });
    return hrefWith({ range: key === "all" ? undefined : key, from: undefined, to: undefined });
  }

  function buildExportUrl(type: "budget" | "outcomes") {
    const p = new URLSearchParams();
    if (currentRange !== "all") p.set("range", currentRange);
    if (currentRange === "custom") {
      if (currentFrom) p.set("from", currentFrom);
      if (currentTo) p.set("to", currentTo);
    }
    currentDepts.forEach((d) => p.append("dept", d));
    const qs = p.toString();
    return qs ? `/api/reports/${type}?${qs}` : `/api/reports/${type}`;
  }

  const totalEstimated = budgetRows.reduce((s, r) => s + r.estimated, 0);
  const totalApproved = budgetRows.reduce((s, r) => s + (r.approved ?? 0), 0);
  const totalActual = budgetRows.reduce((s, r) => s + r.actual, 0);
  const totalLeads = sumBy(outcomeRows, (r) => r.newLeads);
  const totalSQLs = sumBy(outcomeRows, (r) => r.sqls);

  const departmentBars = deptSpend.map((d) => ({
    label: deptLabel(d.department),
    estimated: d.estimated,
    actual: d.actual,
  }));

  /**
   * Who funded each department, rolled up from the same rows the table below
   * lists. A department that recorded no split at all is left out rather than
   * drawn as an empty bar — an unfilled field is not a ₹0 contribution.
   */
  const contributionBars: ContributionBar[] = [];
  for (const row of budgetRows) {
    const label = deptLabel(row.department);
    let bar = contributionBars.find((b) => b.label === label);
    if (!bar) {
      bar = { label, motadata: 0, partner: 0, mdf: 0 };
      contributionBars.push(bar);
    }
    bar.motadata += row.motadata ?? 0;
    bar.partner += row.partner ?? 0;
    bar.mdf += row.mdf ?? 0;
  }
  const fundedBars = contributionBars.filter((b) => b.motadata + b.partner + b.mdf > 0);

  // A flat line along the axis reads as "spent nothing"; the empty state says
  // "nothing to show", which is the truth.
  const hasTrend = monthly.some((m) => m.estimated > 0 || m.actual > 0);
  const decidedStages = turnaround.filter((t) => t.avgHours !== null);

  const planVsActual = [
    { label: "Estimated", color: CHART_COLOR.comparison },
    { label: "Actual", color: CHART_COLOR.primary },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl">
      <PageHeader
        title="Budget & Reports"
        description="Department spend, event outcomes, approval turnaround."
      />

      {/* Filters */}
      <div className="mb-5 space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/*
            The period is one choice out of five, so it is a segmented control of
            plain links rather than a pair of date boxes: the common periods take
            one click, and nobody has to guess whether a typed date means day or
            month first. Links, not buttons, so the browser's own back button and
            "open in new tab" keep working.
          */}
          <nav aria-label="Period" className="flex flex-wrap items-center rounded-md border border-border bg-background p-0.5">
            {RANGE_PRESETS.map((p) => {
              const active = currentRange === p.key;
              return (
                <Link
                  key={p.key}
                  href={rangeHref(p.key)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "rounded-[0.3125rem] px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? "bg-primary-soft text-brand-coral"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {p.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex flex-wrap gap-1.5">
            {DEPARTMENTS.map((dept) => {
              const active = currentDepts.includes(dept);
              return (
                <button
                  key={dept}
                  aria-pressed={active}
                  onClick={() => {
                    const next = active ? currentDepts.filter((d) => d !== dept) : [...currentDepts, dept];
                    navigate({ dept: next.length ? next : undefined });
                  }}
                  className={cn(
                    "rounded-full border px-3 py-0.5 text-xs font-medium transition-colors",
                    active
                      ? "border-brand-coral bg-brand-coral/10 text-brand-coral"
                      : "border-border bg-background text-muted-foreground hover:border-brand-coral/50",
                  )}
                >
                  {deptLabel(dept)}
                </button>
              );
            })}
          </div>

          {(currentRange !== "all" || currentDepts.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ range: undefined, from: undefined, to: undefined, dept: undefined })}
            >
              Clear
            </Button>
          )}
        </div>

        {currentRange === "custom" && (
          <div className="flex flex-wrap items-center gap-3">
            {/*
              `DateInput` prints each picked day in dd-mm-yyyy next to the field,
              because the browser draws the picker in its own locale. `max` and
              `min` stop the two fields crossing over.
            */}
            <div className="flex items-center gap-2">
              <label htmlFor="range-from" className="text-xs font-medium text-muted-foreground">
                From
              </label>
              <DateInput
                id="range-from"
                defaultValue={currentFrom}
                max={currentTo || undefined}
                className="h-8 w-40 text-sm"
                onChange={(e) => e.target.value && navigate({ from: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="range-to" className="text-xs font-medium text-muted-foreground">
                To
              </label>
              <DateInput
                id="range-to"
                defaultValue={currentTo}
                min={currentFrom || undefined}
                className="h-8 w-40 text-sm"
                onChange={(e) => e.target.value && navigate({ to: e.target.value })}
              />
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {rangeLabel ? (
            <>
              Showing events proposed <span className="font-medium text-foreground tabular-nums">{rangeLabel}</span>
            </>
          ) : currentRange === "custom" ? (
            "Pick both dates to apply a custom period."
          ) : (
            "Showing events from every period."
          )}
        </p>
      </div>

      {/* Summary KPIs */}
      {/* Zero leads and zero SQLs are passed as `null`, not as 0: before an
          event closes there is genuinely no figure yet, and `Stat` renders that
          as a dash that screen readers announce as "no data". */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total estimated" value={formatINRCompact(totalEstimated)} />
        <Stat label="Total actual spend" value={formatINRCompact(totalActual)} />
        <Stat label="New leads" value={totalLeads || null} />
        <Stat label="Sales-qualified leads" value={totalSQLs || null} />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-border" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === currentTab}
            onClick={() => navigate({ tab: t.key })}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors",
              t.key === currentTab
                ? "border-b-2 border-brand-coral text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Budget tab */}
      {currentTab === "budget" && (
        <div className="space-y-6">
          {/*
            The trend, then the two breakdowns side by side. Each one is the same
            chart component the dashboard uses, so the app has one chart language
            rather than a bar chart here and a progress bar there. On a reports
            page the data table under each chart is shown rather than hidden:
            this is a page people read for figures, and the table is the chart's
            own numbers, not a second copy kept in step by hand.
          */}
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 pb-2">
              <div>
                <CardTitle className="text-base">Monthly spend</CardTitle>
                {/* Said out loud, because this one card ignores the period above. */}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Six months back, six ahead — whatever period is selected
                </p>
              </div>
              <ChartLegend className="pt-1" items={planVsActual} />
            </CardHeader>
            <CardContent>
              <ChartFrame
                label="Estimated and actual spend per month, six months back and six ahead"
                height={240}
                empty={hasTrend ? undefined : "No approved spend from six months back to six ahead."}
                table={{
                  columns: ["Month", "Estimated", "Actual", "Events"],
                  rows: monthly.map((m) => [
                    monthLabel(m.month),
                    formatINR(m.estimated),
                    formatINR(m.actual),
                    m.eventCount,
                  ]),
                }}
              >
                <SpendTrendChart data={monthly} />
              </ChartFrame>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4 pb-2">
                <CardTitle className="text-base">Department spend</CardTitle>
                <ChartLegend className="pt-0.5" items={planVsActual} />
              </CardHeader>
              <CardContent>
                <ChartFrame
                  label="Estimated and actual spend per department"
                  height={Math.max(departmentBars.length * 44, 132)}
                  empty={departmentBars.length === 0 ? "No approved events in this period." : undefined}
                  tableVisible
                  table={{
                    columns: ["Department", "Estimated", "Actual", "Variance", "Events"],
                    rows: deptSpend.map((d) => [
                      deptLabel(d.department),
                      formatINR(d.estimated),
                      formatINR(d.actual),
                      <span key="v" className={varianceTone(d.variance)}>
                        {(d.variance > 0 ? "+" : "") + formatINR(d.variance)}
                      </span>,
                      d.eventCount,
                    ]),
                  }}
                >
                  <DepartmentSpendChart data={departmentBars} />
                </ChartFrame>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4 pb-2">
                <CardTitle className="text-base">Funding mix</CardTitle>
                <ChartLegend
                  className="pt-0.5"
                  items={[
                    { label: "Motadata", color: CHART_COLOR.primary },
                    { label: "Partner", color: CHART_COLOR.info },
                    { label: "MDF", color: CHART_COLOR.warning },
                  ]}
                />
              </CardHeader>
              <CardContent>
                <ChartFrame
                  label="Motadata, partner and MDF contribution per department"
                  height={Math.max(fundedBars.length * 44, 132)}
                  empty={fundedBars.length === 0 ? "No contribution split recorded in this period." : undefined}
                  tableVisible
                  table={{
                    columns: ["Department", "Motadata", "Partner", "MDF"],
                    rows: fundedBars.map((b) => [
                      b.label,
                      formatINR(b.motadata),
                      formatINR(b.partner),
                      formatINR(b.mdf),
                    ]),
                  }}
                >
                  <ContributionChart data={fundedBars} />
                </ChartFrame>
              </CardContent>
            </Card>
          </div>

          {/* Budget table */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Event budget detail ({budgetRows.length})</h2>
            <Button asChild variant="outline" size="sm">
              <a href={buildExportUrl("budget")} download>
                <Download /> CSV
              </a>
            </Button>
          </div>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Event</TableHead>
                  <TableHead>Dept</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Estimated</TableHead>
                  <TableHead align="right">Approved</TableHead>
                  <TableHead align="right">Actual</TableHead>
                  <TableHead align="right">Variance</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {budgetRows.length === 0 && (
                  <TableEmpty colSpan={7}>No approved events in this period.</TableEmpty>
                )}
                {budgetRows.map((r) => (
                  <TableRow key={r.eventId}>
                    <TableCell>
                      <Link href={`/events/${r.eventId}`} className="font-medium hover:underline">
                        {r.code}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">{r.title}</span>
                    </TableCell>
                    <TableCell className="text-xs">{deptLabel(r.department)}</TableCell>
                    <TableCell>
                      <Badge tone={LIFECYCLE_META[r.lifecycleStatus as keyof typeof LIFECYCLE_META]?.tone ?? "neutral"}>
                        {LIFECYCLE_META[r.lifecycleStatus as keyof typeof LIFECYCLE_META]?.label ?? r.lifecycleStatus}
                      </Badge>
                    </TableCell>
                    <TableCell align="right" numeric>
                      {formatINR(r.estimated)}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {r.approved !== null ? formatINR(r.approved) : "—"}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {formatINR(r.actual)}
                    </TableCell>
                    <TableCell align="right" numeric className={varianceTone(r.variance)}>
                      {r.variance !== null ? (r.variance > 0 ? "+" : "") + formatINR(r.variance) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {budgetRows.length > 0 && (
                <TableFoot>
                  <tr>
                    <TableCell colSpan={3}>Total</TableCell>
                    <TableCell align="right" numeric>
                      {formatINR(totalEstimated)}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {formatINR(totalApproved)}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {formatINR(totalActual)}
                    </TableCell>
                    <TableCell align="right" numeric className={varianceTone(totalActual - totalApproved)}>
                      {formatINR(totalActual - totalApproved)}
                    </TableCell>
                  </tr>
                </TableFoot>
              )}
            </Table>
          </Card>
        </div>
      )}

      {/* Outcomes tab */}
      {currentTab === "outcomes" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Post-event outcomes ({outcomeRows.length})</h2>
            <Button asChild variant="outline" size="sm">
              <a href={buildExportUrl("outcomes")} download>
                <Download /> CSV
              </a>
            </Button>
          </div>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Event</TableHead>
                  <TableHead>Dept</TableHead>
                  <TableHead align="right">Attendance</TableHead>
                  <TableHead align="right">Companies</TableHead>
                  <TableHead align="right">Leads</TableHead>
                  <TableHead align="right">SQLs</TableHead>
                  <TableHead align="right">Opps</TableHead>
                  <TableHead>Actual ROI</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {outcomeRows.length === 0 && (
                  <TableEmpty colSpan={8}>No post-event results in this period.</TableEmpty>
                )}
                {outcomeRows.map((r) => (
                  <TableRow key={r.eventId}>
                    <TableCell>
                      <Link href={`/events/${r.eventId}`} className="font-medium hover:underline">
                        {r.code}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">{r.title}</span>
                    </TableCell>
                    <TableCell className="text-xs">{deptLabel(r.department)}</TableCell>
                    <TableCell align="right" numeric>
                      {r.actualAttendance ?? "—"}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {r.companiesEngaged ?? "—"}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {r.newLeads ?? "—"}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {r.sqls ?? "—"}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {r.opportunities ?? "—"}
                    </TableCell>
                    <TableCell>{r.actualRoi ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {outcomeRows.length > 0 && (
                <TableFoot>
                  <tr>
                    <TableCell colSpan={2}>Total</TableCell>
                    <TableCell align="right" numeric>
                      {sumBy(outcomeRows, (r) => r.actualAttendance)}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {sumBy(outcomeRows, (r) => r.companiesEngaged)}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {totalLeads}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {totalSQLs}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {sumBy(outcomeRows, (r) => r.opportunities)}
                    </TableCell>
                    {/* Actual ROI is prose, so there is nothing to total. */}
                    <TableCell />
                  </tr>
                </TableFoot>
              )}
            </Table>
          </Card>
        </div>
      )}

      {/* Approvals tab */}
      {currentTab === "approvals" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold">Approval turnaround by stage</h2>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 pb-2">
              <div>
                <CardTitle className="text-base">Hours per stage</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Bar is the average, whisker the fastest and slowest decision
                </p>
              </div>
              <ChartLegend
                className="pt-1"
                items={[
                  { label: "Average", color: CHART_COLOR.primary },
                  { label: "Range", color: CHART_COLOR.comparison },
                ]}
              />
            </CardHeader>
            <CardContent>
              {/*
                No `table` on this frame: the table directly below is this chart's
                data, and a richer version of it — stage, count, average, min and
                max. Generating a second one would be two things to keep in step.
              */}
              <ChartFrame
                label="Average approval time per stage, in hours"
                height={Math.max(decidedStages.length * 44, 132)}
                empty={decidedStages.length === 0 ? "No decisions recorded in this period." : undefined}
              >
                <TurnaroundChart data={turnaround} />
              </ChartFrame>
            </CardContent>
          </Card>

          {/*
            The header stays up even with nothing to show, the way the budget and
            outcomes tables do. "No decisions recorded yet" under the column names
            says which four numbers are missing; the same sentence on its own does
            not.
          */}
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Stage</TableHead>
                  <TableHead align="right">Decisions</TableHead>
                  <TableHead align="right">Avg (hrs)</TableHead>
                  <TableHead align="right">Min (hrs)</TableHead>
                  <TableHead align="right">Max (hrs)</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {turnaround.length === 0 && (
                  <TableEmpty colSpan={5}>No decisions recorded in this period.</TableEmpty>
                )}
                {turnaround.map((t) => (
                  <TableRow key={t.stageName}>
                    <TableCell className="font-medium">{t.stageName}</TableCell>
                    <TableCell align="right" numeric>
                      {t.totalDecisions}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {t.avgHours ?? "—"}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {t.minHours ?? "—"}
                    </TableCell>
                    <TableCell align="right" numeric>
                      {t.maxHours ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
