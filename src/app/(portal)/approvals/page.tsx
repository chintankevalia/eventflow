import type { Metadata } from "next";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import Link from "next/link";
import { CheckSquare, Clock, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { DecisionPanel } from "@/components/approvals/decision-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";
import { DEPARTMENT_LABEL } from "@/lib/permissions";
import { requirePagePermission } from "@/server/auth/session";
import { pendingForApprover } from "@/server/approvals/engine";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Approval Center" };

function hoursSince(date: Date) {
  return Math.floor((Date.now() - date.getTime()) / 3_600_000);
}

export default async function ApprovalCenterPage() {
  const user = await requirePagePermission("approvals.view");
  const rounds = await pendingForApprover(db, user.id);

  const decidedByMe = await db.approvalDecision.findMany({
    where: { approverId: user.id },
    orderBy: { decidedAt: "desc" },
    take: 10,
    include: {
      stage: { select: { name: true } },
      round: { include: { event: { select: { id: true, code: true, title: true } } } },
    },
  });

  return (
    <div className="mx-auto w-full max-w-5xl">
      <AutoRefresh />
      <PageHeader
        title="Approval Center"
        description="Event requests waiting for your decision. You can also decide straight from the email."
      />

      {rounds.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          tone="success"
          title="Nothing waiting for you"
          description="New requests appear here and in your inbox."
        />
      ) : (
        <ul className="space-y-4" data-tour="approval-queue">
          {rounds.map((round) => {
            const waiting = hoursSince(round.stageEnteredAt);
            const overdue = waiting >= (round.currentStage?.reminderHours ?? 24);
            const alreadyDecided = round.decisions.filter((d) => d.stageId === round.currentStageId);

            return (
              <li key={round.id}>
                <Card>
                  <CardContent className="space-y-4 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold">{round.event.title}</h2>
                          <Badge tone="warning">{round.currentStage?.name}</Badge>
                          {overdue && (
                            <Badge tone="danger" className="gap-1">
                              <Clock className="size-3" aria-hidden /> waiting {waiting}h
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {[
                            round.event.code,
                            round.event.eventType.name,
                            DEPARTMENT_LABEL[round.event.department],
                            round.event.partnerOrg?.name,
                            round.event.proposedDate ? formatDate(round.event.proposedDate) : "no date",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          Requested by {round.event.requester.name}
                          {round.event.owner && round.event.owner.name !== round.event.requester.name
                            ? ` · owner ${round.event.owner.name}`
                            : ""}{" "}
                          · submitted {formatDateTime(round.submittedAt)} · version {round.version.versionNo}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Estimated cost</p>
                        <p className="text-xl font-semibold tabular-nums">
                          {formatINR(Number(round.event.estimatedCost))}
                        </p>
                      </div>
                    </div>

                    {alreadyDecided.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        Already approved at this stage by {alreadyDecided.map((d) => d.approver.name).join(", ")}.
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/events/${round.event.id}`}>
                          <ExternalLink /> Open the full request
                        </Link>
                      </Button>
                    </div>

                    <DecisionPanel roundId={round.id} />
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {decidedByMe.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Your recent decisions</h2>
          <Card>
            <ul className="divide-y divide-border">
              {decidedByMe.map((decision) => (
                <li key={decision.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <Link href={`/events/${decision.round.event.id}`} className="font-medium hover:underline">
                      {decision.round.event.title}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {decision.round.event.code} · {decision.stage.name} · {formatDateTime(decision.decidedAt)} ·{" "}
                      {decision.channel === "EMAIL" ? "from email" : "in the portal"}
                    </span>
                    {decision.comment && <span className="mt-0.5 block text-sm">“{decision.comment}”</span>}
                  </div>
                  <Badge
                    tone={
                      decision.decision === "APPROVE" ? "success" : decision.decision === "REJECT" ? "danger" : "info"
                    }
                  >
                    {decision.decision === "APPROVE"
                      ? "Approved"
                      : decision.decision === "REJECT"
                        ? "Rejected"
                        : "Changes requested"}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
