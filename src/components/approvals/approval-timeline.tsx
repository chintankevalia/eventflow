import { Check, Circle, Clock, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TimelineStage = {
  id: string;
  name: string;
  sequence: number;
  approverNames: string[];
};

export type TimelineDecision = {
  id: string;
  stageName: string;
  approverName: string;
  decision: "APPROVE" | "REJECT" | "REQUEST_CHANGES";
  comment: string | null;
  channel: "PORTAL" | "EMAIL";
  decidedAt: Date;
};

export type TimelineRound = {
  id: string;
  versionNo: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED" | "SUPERSEDED";
  currentStageId: string | null;
  submittedByName: string;
  submittedAt: Date;
  decisions: TimelineDecision[];
};

const DECISION_META = {
  APPROVE: { label: "Approved", tone: "success" as const, Icon: Check },
  REJECT: { label: "Rejected", tone: "danger" as const, Icon: X },
  REQUEST_CHANGES: { label: "Changes requested", tone: "info" as const, Icon: Clock },
};

const ROUND_STATUS = {
  PENDING: { label: "In progress", tone: "warning" as const },
  APPROVED: { label: "Approved", tone: "success" as const },
  REJECTED: { label: "Rejected", tone: "danger" as const },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "info" as const },
  SUPERSEDED: { label: "Superseded", tone: "neutral" as const },
};

/** The approval chain for the current submission, plus every decision ever made on this event. */
export function ApprovalTimeline({ stages, rounds }: { stages: TimelineStage[]; rounds: TimelineRound[] }) {
  const current = rounds.find((r) => r.status === "PENDING") ?? rounds[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval</CardTitle>
        <CardDescription>
          {stages.map((s) => s.name).join(" → ") || "No approval workflow is configured yet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {current && (
          <ol className="space-y-3">
            {stages.map((stage) => {
              const decisions = current.decisions.filter((d) => d.stageName === stage.name);
              const isCurrent = current.currentStageId === stage.id && current.status === "PENDING";
              const settled =
                decisions.some((d) => d.decision !== "APPROVE") || decisions.length >= stage.approverNames.length;
              const state = settled ? "done" : isCurrent ? "current" : "waiting";

              return (
                <li key={stage.id} className="flex gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
                      state === "done" && "border-success bg-success-soft text-success",
                      state === "current" && "border-brand-coral bg-primary-soft text-brand-coral",
                      state === "waiting" && "border-border text-muted-foreground",
                    )}
                  >
                    {state === "done" ? (
                      <Check className="size-3.5" />
                    ) : state === "current" ? (
                      <Clock className="size-3.5" />
                    ) : (
                      <Circle className="size-2" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{stage.name}</span>
                      {isCurrent && <Badge tone="warning">Waiting</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {stage.approverNames.length ? stage.approverNames.join(", ") : "No approvers assigned"}
                    </p>
                    {decisions.map((d) => (
                      <p key={d.id} className="mt-1 text-sm">
                        <span
                          className={cn(
                            "font-medium",
                            d.decision === "APPROVE"
                              ? "text-success"
                              : d.decision === "REJECT"
                                ? "text-destructive"
                                : "text-info",
                          )}
                        >
                          {DECISION_META[d.decision].label}
                        </span>{" "}
                        by {d.approverName} · {formatDateTime(d.decidedAt)}
                        {d.channel === "EMAIL" ? " · from email" : ""}
                        {d.comment && <span className="mt-0.5 block text-muted-foreground">“{d.comment}”</span>}
                      </p>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {rounds.length === 0 ? (
          <p className="text-sm text-muted-foreground">This request has not been submitted for approval yet.</p>
        ) : (
          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">History</h3>
            <ul className="space-y-2 text-sm">
              {rounds.map((round) => (
                <li key={round.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">Version {round.versionNo}</span>
                    <Badge tone={ROUND_STATUS[round.status].tone}>{ROUND_STATUS[round.status].label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Submitted by {round.submittedByName} · {formatDateTime(round.submittedAt)}
                  </p>
                  {round.decisions.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {round.decisions.map((d) => (
                        <li key={d.id} className="text-xs text-muted-foreground">
                          {DECISION_META[d.decision].label} by {d.approverName} ({d.stageName}) ·{" "}
                          {formatDateTime(d.decidedAt)}
                          {d.comment ? ` — “${d.comment}”` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
