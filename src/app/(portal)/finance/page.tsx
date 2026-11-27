import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, FileText, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { formatDate, formatINR } from "@/lib/format";
import { DEPARTMENT_LABEL } from "@/lib/permissions";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Finance" };

const QUEUE_LIFECYCLE = ["APPROVED", "IN_EXECUTION", "CLOSED"] as const;

type Bucket = "invoice" | "payment" | "paid";

type QueueRow = {
  id: string;
  code: string;
  title: string;
  department: string;
  proposedDate: Date | null;
  lifecycleStatus: string;
  approvedCost: number;
  actualCost: number;
  invoicesReceived: number;
  invoicesExpected: number;
  bucket: Bucket;
};

/**
 * Which of the three tabs an event belongs in, from its own cost lines. An event cannot reach
 * `APPROVED` without at least one cost line (the submission checklist requires it), so there is
 * no "no lines" case to special-case here.
 */
function bucketFor(lines: { invoiceStatus: string; paymentStatus: string | null }[]): Bucket {
  if (lines.some((l) => l.invoiceStatus === "NOT_RAISED")) return "invoice";
  if (lines.some((l) => l.paymentStatus !== "PAID")) return "payment";
  return "paid";
}

const TAB_META: Record<Bucket, { label: string; icon: typeof FileText }> = {
  invoice: { label: "Awaiting invoice", icon: FileText },
  payment: { label: "Awaiting payment", icon: Wallet },
  paid: { label: "Paid", icon: CheckCircle2 },
};

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePagePermission("finance.view");
  const { tab: tabParam } = await searchParams;

  const events = await db.event.findMany({
    where: { lifecycleStatus: { in: [...QUEUE_LIFECYCLE] } },
    select: {
      id: true,
      code: true,
      title: true,
      department: true,
      proposedDate: true,
      lifecycleStatus: true,
      costLines: { select: { approved: true, actual: true, invoiceStatus: true, paymentStatus: true } },
    },
    orderBy: { proposedDate: "desc" },
  });

  const rows: QueueRow[] = events.map((e) => ({
    id: e.id,
    code: e.code,
    title: e.title,
    department: e.department,
    proposedDate: e.proposedDate,
    lifecycleStatus: e.lifecycleStatus,
    approvedCost: e.costLines.reduce((n, l) => n + Number(l.approved ?? 0), 0),
    actualCost: e.costLines.reduce((n, l) => n + Number(l.actual ?? 0), 0),
    invoicesReceived: e.costLines.filter((l) => l.invoiceStatus !== "NOT_RAISED").length,
    invoicesExpected: e.costLines.length,
    bucket: bucketFor(e.costLines),
  }));

  const counts: Record<Bucket, number> = { invoice: 0, payment: 0, paid: 0 };
  for (const row of rows) counts[row.bucket]++;

  const activeTab: Bucket = tabParam === "payment" || tabParam === "paid" ? tabParam : "invoice";
  const visible = rows.filter((r) => r.bucket === activeTab);

  const tabs: TabItem[] = (Object.keys(TAB_META) as Bucket[]).map((key) => ({
    key,
    label: TAB_META[key].label,
    icon: TAB_META[key].icon,
    href: `/finance?tab=${key}`,
    count: counts[key],
  }));

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Finance"
        description="Approved events, tracked through to invoice and payment. Open an event for its full history and files."
      />

      <div data-tour="finance-tabs">
        <Tabs items={tabs} activeKey={activeTab} label="Finance queue" className="mb-4" />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={TAB_META[activeTab].icon}
          tone="success"
          title={`Nothing ${TAB_META[activeTab].label.toLowerCase()}`}
          description="Events move here once they are approved, and between tabs as invoices come in and are paid."
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead align="right">Approved</TableHead>
                <TableHead align="right">Actual</TableHead>
                <TableHead>Invoices</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableEmpty colSpan={7}>Nothing here.</TableEmpty>
              ) : (
                visible.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link href={`/events/${row.id}?tab=budget`} className="font-medium hover:underline">
                        {row.title}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{row.code}</span>
                    </TableCell>
                    <TableCell muted>{DEPARTMENT_LABEL[row.department as keyof typeof DEPARTMENT_LABEL]}</TableCell>
                    <TableCell muted>{row.proposedDate ? formatDate(row.proposedDate) : "—"}</TableCell>
                    <TableCell>
                      <Badge tone={row.lifecycleStatus === "CLOSED" ? "neutral" : "info"}>
                        {row.lifecycleStatus === "IN_EXECUTION" ? "In execution" : row.lifecycleStatus === "CLOSED" ? "Closed" : "Approved"}
                      </Badge>
                    </TableCell>
                    <TableCell align="right" numeric>{formatINR(row.approvedCost)}</TableCell>
                    <TableCell align="right" numeric>{row.actualCost ? formatINR(row.actualCost) : "—"}</TableCell>
                    <TableCell muted>
                      {row.invoicesReceived} of {row.invoicesExpected}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
