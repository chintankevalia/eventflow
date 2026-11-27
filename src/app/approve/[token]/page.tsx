import type { Metadata } from "next";
import Link from "next/link";
import { LinkIcon } from "lucide-react";
import { MotadataLogo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatINR } from "@/lib/format";
import { DEPARTMENT_LABEL } from "@/lib/permissions";
import { inspectApprovalToken } from "@/server/approvals/tokens";
import { db } from "@/server/db";
import { ApproveForm } from "./approve-form";

export const metadata: Metadata = { title: "Approve or reject", referrer: "no-referrer", robots: { index: false } };
export const dynamic = "force-dynamic";

type Decision = "APPROVE" | "REJECT" | "REQUEST_CHANGES";

export default async function ApprovePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ decision?: string }>;
}) {
  const [{ token }, { decision }] = await Promise.all([params, searchParams]);
  const check = await inspectApprovalToken(db, token);

  if (!check.ok) {
    const messages = {
      invalid: "This approval link is not valid.",
      used: "This approval link has already been used.",
      expired: "This approval link has expired.",
      closed: "This request has already moved on, so the link no longer applies.",
    } as const;
    return (
      <Shell>
        <span className="flex size-11 items-center justify-center rounded-full bg-warning-soft">
          <LinkIcon className="size-5 text-warning" aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{messages[check.reason]}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Decisions are recorded once, and links stop working when a request changes. Open the Approval Center to see
          what is waiting for you.
        </p>
        <Button asChild className="mt-6">
          <Link href="/approvals">Go to the Approval Center</Link>
        </Button>
      </Shell>
    );
  }

  const [round, event] = await Promise.all([
    db.approvalRound.findUniqueOrThrow({
      where: { id: check.roundId },
      include: { currentStage: { select: { name: true } }, version: { select: { versionNo: true } } },
    }),
    db.event.findUniqueOrThrow({
      where: { id: check.eventId },
      include: {
        eventType: { select: { name: true } },
        requester: { select: { name: true } },
        owner: { select: { name: true } },
        partnerOrg: { select: { name: true, tier: { select: { label: true } } } },
        costLines: { include: { category: { select: { name: true } } }, orderBy: { sortOrder: "asc" } },
      },
    }),
  ]);

  // Dropdown answers are stored as machine values; show the labels people recognise.
  const answers = (event.answers ?? {}) as Record<string, unknown>;
  const lookupValues = [answers["basic.region"], answers["basic.format"]].filter(
    (v): v is string => typeof v === "string",
  );
  const lookupLabels = lookupValues.length
    ? await db.lookupItem.findMany({ where: { value: { in: lookupValues } }, select: { value: true, label: true } })
    : [];
  const labelFor = (value: unknown) =>
    typeof value === "string" ? (lookupLabels.find((l) => l.value === value)?.label ?? value) : null;
  const objective = typeof answers["basic.objective"] === "string" ? (answers["basic.objective"] as string) : null;
  const expectedRoi =
    typeof answers["budget.expectedRoi"] === "string" ? (answers["budget.expectedRoi"] as string) : null;
  const initial: Decision | undefined =
    decision === "approve" ? "APPROVE" : decision === "reject" ? "REJECT" : undefined;

  return (
    <Shell wide>
      <div className="w-full">
        <div className="mb-6">
          <Badge tone="warning">{round.currentStage?.name}</Badge>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{event.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[
              event.code,
              event.eventType.name,
              DEPARTMENT_LABEL[event.department],
              `version ${round.version.versionNo}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-3 text-sm">
            Hello <strong>{check.approverName}</strong> — this request is waiting for your decision.
          </p>
        </div>

        <Card className="mb-6">
          <CardContent className="p-5">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Detail label="Requested by" value={event.requester.name} />
              <Detail label="Event owner" value={event.owner?.name ?? "—"} />
              <Detail label="Date" value={event.proposedDate ? formatDate(event.proposedDate) : "Not set"} />
              <Detail
                label="Location"
                value={[event.city, labelFor(answers["basic.region"])].filter(Boolean).join(", ") || "Not set"}
              />
              {event.partnerOrg && (
                <Detail
                  label="Partner"
                  value={`${event.partnerOrg.name}${event.partnerOrg.tier ? ` (${event.partnerOrg.tier.label})` : ""}`}
                />
              )}
              <Detail label="Estimated cost" value={formatINR(Number(event.estimatedCost))} />
              {objective && <Detail label="Objective" value={objective} className="sm:col-span-2" />}
              {expectedRoi && <Detail label="Expected ROI" value={expectedRoi} className="sm:col-span-2" />}
            </dl>

            {event.costLines.length > 0 && (
              <table className="mt-5 w-full text-sm">
                <caption className="mb-2 text-left text-xs font-medium text-muted-foreground">Costing</caption>
                <tbody className="divide-y divide-border">
                  {event.costLines.map((line) => (
                    <tr key={line.id}>
                      <td className="py-1.5">
                        {line.description}
                        {line.category && <span className="text-muted-foreground"> · {line.category.name}</span>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatINR(Number(line.estimated))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-medium">
                    <td className="py-2">Estimated total</td>
                    <td className="py-2 text-right tabular-nums">{formatINR(Number(event.estimatedCost))}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </CardContent>
        </Card>

        <ApproveForm token={token} initial={initial} />
      </div>
    </Shell>
  );
}

function Detail({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border bg-card px-6 py-4">
        <MotadataLogo className="h-6" />
      </header>
      <main id="main" className="flex flex-1 justify-center px-4 py-10 sm:px-6">
        <div className={wide ? "w-full max-w-2xl" : "max-w-md text-center"}>{children}</div>
      </main>
      <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        EventFlow · www.motadata.com | support@motadata.com
      </footer>
    </div>
  );
}
