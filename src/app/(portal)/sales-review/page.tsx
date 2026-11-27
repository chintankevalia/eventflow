import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, ClipboardCheck, XCircle } from "lucide-react";
import type { SalesReviewStatus } from "@prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { formatDate } from "@/lib/format";
import { DEPARTMENT_LABEL } from "@/lib/permissions";
import { MAX_SCORE, scoreBand } from "@/lib/sales-review";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { canReviewForSales } from "@/server/events/sales-review";

export const metadata: Metadata = { title: "Sales Review" };

type Bucket = "PENDING" | "GO" | "NO_GO";

const TAB_META: Record<Bucket, { label: string; icon: typeof ClipboardCheck; empty: string }> = {
  PENDING: { label: "Waiting for review", icon: ClipboardCheck, empty: "No new events are waiting for Sales." },
  GO: { label: "Go", icon: CheckCircle2, empty: "No event has been given a Go yet." },
  NO_GO: { label: "No-go", icon: XCircle, empty: "No event has been turned down." },
};

export default async function SalesReviewPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  if (!canReviewForSales(user)) redirect("/forbidden");
  const { tab: tabParam } = await searchParams;
  const activeTab: Bucket = tabParam === "GO" || tabParam === "NO_GO" ? tabParam : "PENDING";

  const [events, grouped] = await Promise.all([
    db.event.findMany({
      where: { salesReviewStatus: activeTab },
      select: {
        id: true,
        code: true,
        title: true,
        department: true,
        city: true,
        proposedDate: true,
        createdAt: true,
        eventType: { select: { name: true } },
        requester: { select: { name: true } },
        salesReview: { select: { totalScore: true, reviewedAt: true, reviewedBy: { select: { name: true } } } },
      },
      // Oldest request first while waiting, so nothing sits at the bottom of the pile.
      orderBy: activeTab === "PENDING" ? { createdAt: "asc" } : { updatedAt: "desc" },
      take: 200,
    }),
    db.event.groupBy({ by: ["salesReviewStatus"], _count: true }),
  ]);

  const count = (s: SalesReviewStatus) => grouped.find((g) => g.salesReviewStatus === s)?._count ?? 0;
  const tabs: TabItem[] = (Object.keys(TAB_META) as Bucket[]).map((key) => ({
    key,
    label: TAB_META[key].label,
    icon: TAB_META[key].icon,
    href: `/sales-review?tab=${key}`,
    count: count(key),
  }));

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Sales Review"
        description="Every new event comes here first. Answer the business-case questions, score it, and decide whether it goes ahead."
      />
      <Tabs items={tabs} activeKey={activeTab} label="Sales review queue" className="mb-4" />

      {events.length === 0 ? (
        <EmptyState icon={TAB_META[activeTab].icon} tone="success" title={TAB_META[activeTab].empty} />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Proposed</TableHead>
                <TableHead>Raised by</TableHead>
                <TableHead>Score</TableHead>
                {activeTab !== "PENDING" && <TableHead>Decided</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => {
                const total = e.salesReview?.totalScore ?? null;
                const band = scoreBand(total);
                return (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link href={`/events/${e.id}?tab=sales-review`} className="font-medium hover:underline">
                        {e.title}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{e.code}</span>
                    </TableCell>
                    <TableCell muted>{e.eventType.name}</TableCell>
                    <TableCell muted>{DEPARTMENT_LABEL[e.department]}</TableCell>
                    <TableCell muted>
                      {e.proposedDate ? formatDate(e.proposedDate) : "—"}
                      {e.city ? <span className="block text-xs">{e.city}</span> : null}
                    </TableCell>
                    <TableCell muted>
                      {e.requester.name}
                      <span className="block text-xs">{formatDate(e.createdAt)}</span>
                    </TableCell>
                    <TableCell>
                      {total === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge tone={band.tone}>
                          {total}/{MAX_SCORE}
                        </Badge>
                      )}
                    </TableCell>
                    {activeTab !== "PENDING" && (
                      <TableCell muted>
                        {e.salesReview?.reviewedBy?.name ?? "—"}
                        {e.salesReview?.reviewedAt ? (
                          <span className="block text-xs">{formatDate(e.salesReview.reviewedAt)}</span>
                        ) : null}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
