import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";
import {
  Calendar,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  LayoutList,
  MapPin,
  Shield,
  TrendingUp,
  Users,
} from "lucide-react";
import { salesReviewAction, saveSectionAction, updateOwnershipAction } from "../actions";
import { SalesReviewForm } from "@/components/events/sales-review-form";
import { canReviewForSales } from "@/server/events/sales-review";
import { OwnershipPanel } from "@/components/events/ownership-panel";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { DecisionPanel } from "@/components/approvals/decision-panel";
import { ReopenButton, SubmitForApprovalButton } from "@/components/approvals/submit-button";
import { CostLinesPanel } from "@/components/events/cost-lines-panel";
import { EventActions } from "@/components/events/event-actions";
import { FilesPanel } from "@/components/events/files-panel";
import { SpeakersPanel, StakeholdersPanel } from "@/components/events/people-panels";
import { SectionForm } from "@/components/events/section-form";
import { TasksPanel } from "@/components/events/tasks-panel";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Stat } from "@/components/ui/stat";
import { Tabs } from "@/components/ui/tabs";
import { EventInfoPanel } from "@/components/events/event-info-panel";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { SECTION_META, type FormSection } from "@/lib/form-schema";
import { APPROVAL_META, LIFECYCLE_FLOW, LIFECYCLE_META, type LifecycleStatus } from "@/lib/lifecycle";
import { can, DEPARTMENT_LABEL } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { eventVisibilityWhere, getAccessPolicy, type Viewer } from "@/server/access/policy";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { UPLOADABLE_KINDS, ATTACHMENT_KIND_LABEL } from "@/lib/attachments";
import { resolveFieldsWithOptions } from "@/server/events/fields";
import { getActiveWorkflow, getApprovalHistory } from "@/server/approvals/engine";
import { canEditEvent, checkCompleteness, EDITABLE_STAGES, getEvent } from "@/server/events/service";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  await requirePagePermission("events.view");
  const { id } = await params;
  const event = await db.event.findUnique({ where: { id }, select: { code: true, title: true } });
  return { title: event ? `${event.code} · ${event.title}` : "Event" };
}

const TABS = [
  { key: "details",      label: "Details",     icon: FileText,    section: "BASIC_DETAILS" as FormSection },
  { key: "stakeholders", label: "Stakeholders", icon: Users,       section: "STAKEHOLDERS" as FormSection },
  { key: "budget",       label: "Budget",       icon: TrendingUp,  section: "BUDGET" as FormSection },
  { key: "planning",     label: "Planning",     icon: CheckSquare, section: "PLANNING" as FormSection },
  { key: "post-event",   label: "Post-event",   icon: LayoutList,  section: "POST_EVENT" as FormSection },
  { key: "files",        label: "Files",        icon: FileText,    section: null },
  { key: "approval",     label: "Approval",     icon: Shield,      section: null },
];

// Shown first, and only on events created since the Sales gate existed (see server/events/sales-review.ts).
const SALES_TAB = { key: "sales-review", label: "Sales review", icon: ClipboardCheck, section: null };

// Lifecycle flow without DROPPED (it's a side-exit, not a step)
const FLOW_STEPS = LIFECYCLE_FLOW;

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; created?: string }>;
}) {
  const user = await requirePagePermission("events.view");
  const [{ id }, { tab: tabParam, created }] = await Promise.all([params, searchParams]);

  const event = await getEvent(db, id);
  if (!event) notFound();

  // Department visibility, on top of events.view: the same predicate the register and the
  // export route use, so a department-restricted viewer can never reach by direct link what
  // they could not already find by browsing. A 404, not a 403 — an event outside what you may
  // see should not even confirm it exists. One extra, trivial query rather than teaching this
  // page a second, in-memory copy of eventVisibilityWhere's logic that could drift from it.
  const policy = await getAccessPolicy(db);
  const viewer: Viewer = { id: user.id, roles: user.roles, department: user.department };
  const visible = await db.event.count({ where: { id, ...eventVisibilityWhere(viewer, policy) } });
  if (!visible) notFound();

  const tabs = event.salesReviewStatus === "NOT_REQUIRED" ? TABS : [SALES_TAB, ...TABS];
  // While Sales hasn't decided, the review is what everyone needs to see first.
  const defaultTab = event.salesReviewStatus === "PENDING" ? SALES_TAB : TABS[0];
  const tab = tabs.find((t) => t.key === tabParam) ?? defaultTab;
  const isSalesReviewer = canReviewForSales(user);
  const salesPending = event.salesReviewStatus === "PENDING";
  const canEdit = canEditEvent(user, event);
  const planEditable = canEdit && EDITABLE_STAGES.includes(event.lifecycleStatus);
  const executionEditable = canEdit && ["APPROVED", "IN_EXECUTION"].includes(event.lifecycleStatus);
  // Actuals, invoices and payment: the plan's own editors, or Finance/an admin, once the event
  // is approved — through to Closed, since payment is usually settled after the event, not on
  // the day. Mirrors editableByFinance() in events/actions.ts exactly, so the UI never shows a
  // control the server would then refuse.
  const canRecordActuals =
    (canEdit || can(user.roles, "finance.view")) && ["APPROVED", "IN_EXECUTION", "CLOSED"].includes(event.lifecycleStatus);

  const [{ fields, options }, completeness, categories, people, history, workflow, partners, tiers] = await Promise.all([
    resolveFieldsWithOptions(db, event.eventTypeId, event.partnerTier),
    checkCompleteness(db, event.id),
    db.expenseCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, department: true },
    }),
    getApprovalHistory(db, id),
    getActiveWorkflow(db),
    // Only the Stakeholders tab needs these lists, so other tabs do not pay for them.
    tab.key === "stakeholders"
      ? db.organization.findMany({
          where: { status: "ACTIVE", type: { in: ["PARTNER", "DISTRIBUTOR"] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, type: true, tier: { select: { value: true } } },
        })
      : Promise.resolve([]),
    tab.key === "stakeholders"
      ? db.lookupItem.findMany({
          where: { kind: "PARTNER_TIER", active: true },
          orderBy: { sortOrder: "asc" },
          select: { value: true, label: true },
        })
      : Promise.resolve([]),
  ]);

  const answers = (event.answers ?? {}) as Record<string, unknown>;
  const lifecycle = LIFECYCLE_META[event.lifecycleStatus];
  const approval = APPROVAL_META[event.approvalStatus === "NOT_SUBMITTED" ? "PENDING" : event.approvalStatus];

  const openRound = history.find((r) => r.status === "PENDING");
  const currentStage = openRound?.currentStageId
    ? workflow?.stages.find((s) => s.id === openRound.currentStageId)
    : undefined;
  const awaitingMyDecision = Boolean(
    openRound &&
    currentStage?.approvers.some((a) => a.userId === user.id) &&
    !openRound.decisions.some((d) => d.approverId === user.id && d.stageId === currentStage.id),
  );

  const sectionFields = (section: FormSection) =>
    fields
      .filter((f) => f.section === section && f.visible && !f.system)
      .map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, help: f.help, options: options[f.key] }));

  // Compute lifecycle step index
  const currentStepIdx = FLOW_STEPS.indexOf(event.lifecycleStatus as LifecycleStatus);
  const isDropped = event.lifecycleStatus === "DROPPED";

  const tabItems = tabs.map((t) => ({
    key: t.key,
    label: t.label,
    icon: t.icon,
    href: `/events/${event.id}?tab=${t.key}`,
  }));

  // Neighbouring tabs, for "Save & continue" and the prev/next bar under every section.
  const tabIndex = tabs.findIndex((t) => t.key === tab.key);
  const prevTab = tabIndex > 0 ? tabItems[tabIndex - 1] : null;
  const nextTab = tabIndex < tabs.length - 1 ? tabItems[tabIndex + 1] : null;

  const infoPanel = (
    <EventInfoPanel
      budget={{
        estimated: Number(event.estimatedCost),
        actual: Number(event.actualCost),
        motadata: event.motadataContribution !== null ? Number(event.motadataContribution) : null,
        partner: event.partnerContribution !== null ? Number(event.partnerContribution) : null,
        mdf: event.mdfAllocation !== null ? Number(event.mdfAllocation) : null,
      }}
      info={{
        type: event.eventType.name,
        subtype: event.subtype?.name ?? null,
        department: DEPARTMENT_LABEL[event.department],
        city: event.city,
        proposedDate: event.proposedDate,
        partner: event.partnerOrg?.name ?? null,
      }}
      people={{
        requester: event.requester?.name ?? null,
        owner: event.owner?.name ?? null,
        manager: event.manager?.name ?? null,
      }}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[88rem]">

      {/* ── Ticket header bar (ServiceOps style) ── */}
      <div className="mb-0 border-b border-border bg-card px-0 pb-0">

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
          <Link href="/events" className="hover:text-foreground transition-colors">Event Register</Link>
          <ChevronRight className="size-3" />
          <span className="font-medium text-foreground">{event.code}</span>
        </nav>

        {/* Title row */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5 mb-1">
              <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono font-medium text-muted-foreground">
                {event.code}
              </span>
              <h1 className="text-xl font-semibold tracking-tight leading-tight">{event.title}</h1>
            </div>
            <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1">
                <Users className="size-3" />
                {event.requester?.name ?? "Unknown requester"}
              </span>
              {event.proposedDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="size-3" />
                  {formatDate(event.proposedDate)}
                </span>
              )}
              {event.city && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3" />
                  {event.city}
                </span>
              )}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canEdit && planEditable && !salesPending && (
              <SubmitForApprovalButton eventId={event.id} issues={completeness.issues} />
            )}
            {canEdit && event.lifecycleStatus === "APPROVED" && <ReopenButton eventId={event.id} />}
            <EventActions
              eventId={event.id}
              lifecycleStatus={event.lifecycleStatus}
              canEdit={canEdit}
              salesPending={salesPending}
            />
          </div>
        </div>

        {/* ── Metadata chip strip (like ServiceOps top row) ── */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 pb-4 text-sm">
          <Stat variant="chip" label="Status" value={
            <Badge tone={isDropped ? "danger" : lifecycle.tone}>{lifecycle.label}</Badge>
          } />

          {event.approvalStatus !== "NOT_SUBMITTED" && (
            <Stat variant="chip" label="Approval" value={
              <Badge tone={approval.tone}>{approval.label}</Badge>
            } />
          )}

          <Stat variant="chip" label="Department" value={
            <span className="font-medium">{DEPARTMENT_LABEL[event.department]}</span>
          } />

          <Stat variant="chip" label="Type" value={
            <span className="font-medium">
              {event.eventType.name}{event.subtype ? ` · ${event.subtype.name}` : ""}
            </span>
          } />

          <Stat variant="chip" label="Owner" value={
            <span className="font-medium">{event.owner?.name ?? <span className="text-muted-foreground italic">Unassigned</span>}</span>
          } />

          {event.partnerOrg && (
            <Stat variant="chip" label="Partner" value={
              <span className="font-medium">
                {event.partnerOrg.name}
                {event.partnerOrg.tier ? ` (${event.partnerOrg.tier.label})` : ""}
              </span>
            } />
          )}
        </div>
      </div>

      {/* ── Lifecycle progress stepper ── */}
      {!isDropped && (
        <div className="border-b border-border bg-muted/30 px-0 py-3 mb-0">
          <div className="flex items-center gap-0 overflow-x-auto">
            {FLOW_STEPS.map((step, idx) => {
              const meta = LIFECYCLE_META[step];
              const isDone = currentStepIdx > idx;
              const isCurrent = currentStepIdx === idx;
              const isUpcoming = currentStepIdx < idx;
              return (
                <div key={step} className="flex items-center shrink-0">
                  <div className={cn(
                    "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors",
                    isCurrent && "bg-primary-soft text-brand-coral",
                    isDone && "text-success",
                    isUpcoming && "text-muted-foreground",
                  )}>
                    <span className={cn(
                      "flex size-4 items-center justify-center rounded-full text-[10px] font-bold shrink-0",
                      isCurrent && "bg-primary text-primary-foreground",
                      isDone && "bg-success text-white",
                      isUpcoming && "bg-muted text-muted-foreground",
                    )}>
                      {isDone ? "✓" : idx + 1}
                    </span>
                    {meta.label}
                  </div>
                  {idx < FLOW_STEPS.length - 1 && (
                    <Separator decorative className={cn("w-4", isDone && "bg-success/50")} />
                  )}
                </div>
              );
            })}
            {isDropped && (
              <div className="ml-3 flex items-center gap-1.5 rounded-full bg-destructive/15 px-3 py-1 text-xs font-medium text-destructive">
                <span className="flex size-4 items-center justify-center rounded-full bg-destructive text-white text-[10px]">✕</span>
                Dropped
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Alerts ── */}
      {created === "1" && (
        <div className="mt-4 flex gap-2 rounded-lg border border-success/30 bg-success-soft/30 px-4 py-3 text-sm">
          <span>
            Request <strong>{event.code}</strong> created as a draft
            {event.template ? ` from the template "${event.template.name}"` : ""}.{" "}
            {salesPending
              ? "Sales has been asked to review the business case; planning starts once they say Go. Meanwhile you can fill in the details."
              : "Fill in the sections below, then move to Scheduling."}
          </span>
        </div>
      )}
      {salesPending && tab.key !== "sales-review" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning-soft/40 px-4 py-3 text-sm">
          <span>
            {isSalesReviewer
              ? "This event needs your go / no-go before planning can start."
              : "Waiting for Sales to review the business case. Planning starts once they say Go."}
          </span>
          <Link href={`/events/${event.id}?tab=sales-review`} className="font-medium text-brand-coral hover:underline">
            {isSalesReviewer ? "Review now" : "See the review"}
          </Link>
        </div>
      )}
      {event.lifecycleStatus === "DROPPED" && event.droppedReason && (
        <div className="mt-4 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <strong>Dropped:</strong> {event.droppedReason}
        </div>
      )}
      {awaitingMyDecision && openRound && (
        <Card className="mt-4 border-brand-coral/40 bg-primary-soft">
          <CardContent className="space-y-3 p-5">
            <div>
              <h2 className="font-semibold text-sm">Your decision is needed</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                You are an approver at &ldquo;{currentStage?.name}&rdquo;. Approving is enough on its own; rejecting or requesting changes requires a comment.
              </p>
            </div>
            <DecisionPanel roundId={openRound.id} compact />
          </CardContent>
        </Card>
      )}

      {/* ── Main body: tabs left + info sidebar right ── */}
      <div className="mt-4 flex gap-5 items-start">

        {/* ── Tab content (main) ── */}
        <div className="min-w-0 flex-1">
          <Tabs items={tabItems} activeKey={tab.key} label="Event sections" className="mb-4" />

          {/* Tab content */}
          <div className="space-y-5">
            {tab.key === "sales-review" && event.salesReviewStatus !== "NOT_REQUIRED" && (
              <SalesReviewForm
                key={`${event.id}-sales`}
                values={(event.salesReview?.answers ?? {}) as Record<string, unknown>}
                action={salesReviewAction.bind(null, event.id)}
                canDecide={isSalesReviewer && salesPending && event.lifecycleStatus !== "DROPPED"}
                status={event.salesReviewStatus}
                reviewedBy={event.salesReview?.reviewedBy?.name}
                reviewedAt={event.salesReview?.reviewedAt}
                comment={event.salesReview?.comment}
              />
            )}

            {tab.section && (
              <SectionForm
                key={`${event.id}-${tab.section}`}
                title={SECTION_META[tab.section].label}
                description={SECTION_META[tab.section].purpose}
                fields={sectionFields(tab.section)}
                values={answers}
                action={saveSectionAction.bind(null, event.id)}
                next={nextTab ? { href: nextTab.href, label: nextTab.label } : undefined}
                readOnly={tab.section === "POST_EVENT" ? !executionEditable && !planEditable : !planEditable}
                readOnlyNote={
                  canEdit
                    ? tab.section === "POST_EVENT"
                      ? "Post-event results are recorded once the event has been approved and run."
                      : "The plan is locked at this stage."
                    : "You can view this event but not change it."
                }
              />
            )}

            {tab.key === "stakeholders" && (
              <OwnershipPanel
                values={{
                  ownerId: event.ownerId,
                  managerId: event.managerId,
                  partnerOrgId: event.partnerOrgId,
                  partnerTier: event.partnerTier,
                }}
                users={people.map((p) => ({
                  value: p.id,
                  label: p.department ? `${p.name} · ${DEPARTMENT_LABEL[p.department]}` : p.name,
                }))}
                partners={partners.map((o) => ({
                  value: o.id,
                  label: `${o.name}${o.type === "DISTRIBUTOR" ? " (distributor)" : ""}`,
                  tier: o.tier?.value ?? null,
                }))}
                tiers={tiers}
                needsPartner={event.eventType.needsPartner}
                readOnly={!planEditable}
                action={updateOwnershipAction.bind(null, event.id)}
              />
            )}

            {tab.key === "stakeholders" && (
              <StakeholdersPanel
                eventId={event.id}
                canEdit={planEditable}
                people={people}
                stakeholders={event.stakeholders.map((s) => ({
                  id: s.id,
                  name: s.user?.name ?? s.externalName ?? "Unnamed",
                  role: s.role,
                  responsibility: s.responsibility,
                  isUser: Boolean(s.userId),
                }))}
              />
            )}

            {tab.key === "budget" && (
              <CostLinesPanel
                eventId={event.id}
                canEditPlan={planEditable}
                canRecordActuals={canRecordActuals}
                categories={categories}
                contributions={{
                  motadata: event.motadataContribution !== null ? Number(event.motadataContribution) : null,
                  partner: event.partnerContribution !== null ? Number(event.partnerContribution) : null,
                  mdf: event.mdfAllocation !== null ? Number(event.mdfAllocation) : null,
                }}
                lines={event.costLines.map((l) => ({
                  id: l.id,
                  description: l.description,
                  categoryName: l.category?.name ?? null,
                  vendor: l.vendor,
                  estimated: Number(l.estimated),
                  approved: l.approved !== null ? Number(l.approved) : null,
                  actual: l.actual !== null ? Number(l.actual) : null,
                  invoiceRef: l.invoiceRef,
                  invoiceStatus: l.invoiceStatus,
                  paymentStatus: l.paymentStatus,
                  invoices: l.invoices,
                }))}
              />
            )}

            {tab.key === "planning" && (
              <>
                <TasksPanel
                  eventId={event.id}
                  canEdit={canEdit && event.lifecycleStatus !== "CLOSED" && event.lifecycleStatus !== "DROPPED"}
                  people={people}
                  tasks={event.tasks.map((t) => ({
                    id: t.id,
                    title: t.title,
                    ownerName: t.owner?.name ?? null,
                    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
                    status: t.status,
                    notes: t.notes,
                    dependsOnIds: t.dependsOn.map((d) => d.dependsOnTaskId),
                  }))}
                />
                <SpeakersPanel
                  eventId={event.id}
                  canEdit={canEdit && event.lifecycleStatus !== "DROPPED"}
                  speakers={event.speakers}
                />
              </>
            )}

            {tab.key === "files" && (
              <FilesPanel
                eventId={event.id}
                canEdit={canEdit && event.lifecycleStatus !== "DROPPED"}
                kinds={UPLOADABLE_KINDS.map((k) => ({ value: k, label: ATTACHMENT_KIND_LABEL[k] }))}
                attachments={event.attachments.map((a) => ({
                  id: a.id,
                  kind: a.kind,
                  kindLabel: ATTACHMENT_KIND_LABEL[a.kind],
                  fileName: a.fileName,
                  sizeBytes: a.sizeBytes,
                  uploadedBy: a.uploadedBy.name,
                  createdAt: a.createdAt.toISOString(),
                }))}
              />
            )}

            {tab.key === "approval" && (
              <ApprovalTimeline
                stages={(workflow?.stages ?? []).map((stage) => ({
                  id: stage.id,
                  name: stage.name,
                  sequence: stage.sequence,
                  approverNames: stage.approvers.map((a) => a.user.name),
                }))}
                rounds={history.map((round) => ({
                  id: round.id,
                  versionNo: round.version.versionNo,
                  status: round.status,
                  currentStageId: round.currentStageId,
                  submittedByName: round.submittedBy.name,
                  submittedAt: round.submittedAt,
                  decisions: round.decisions.map((d) => ({
                    id: d.id,
                    stageName: d.stage.name,
                    approverName: d.approver.name,
                    decision: d.decision,
                    comment: d.comment,
                    channel: d.channel,
                    decidedAt: d.decidedAt,
                  })),
                }))}
              />
            )}
          </div>

          {/* Previous / next section, so the form reads as a sequence rather than seven islands. */}
          <nav aria-label="Section navigation" className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
            {prevTab ? (
              <Button asChild variant="outline" size="sm">
                <Link href={prevTab.href}>
                  <ChevronLeft className="mr-1 size-4" aria-hidden /> {prevTab.label}
                </Link>
              </Button>
            ) : (
              <span />
            )}
            {nextTab && (
              <Button asChild variant="outline" size="sm">
                <Link href={nextTab.href}>
                  {nextTab.label} <ChevronRight className="ml-1 size-4" aria-hidden />
                </Link>
              </Button>
            )}
          </nav>

          {/* Same panel as the right rail, reachable on phones and tablets. */}
          <details className="group mt-5 overflow-hidden rounded-lg border border-border bg-card lg:hidden">
            <summary className="flex cursor-pointer items-center justify-between gap-2 bg-muted/40 px-4 py-3 text-sm font-medium">
              Event information
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
            </summary>
            <div className="p-3">{infoPanel}</div>
          </details>
        </div>

        {/* ── Right sidebar: ticket info panel ── */}
        <aside className="hidden w-60 shrink-0 lg:block" aria-label="Event information">
          {infoPanel}
        </aside>
      </div>
    </div>
  );
}
