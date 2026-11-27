import { Prisma, type DecisionChannel, type DecisionType, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { checkCompleteness, type Actor } from "@/server/events/service";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { approvalRequestEmail, decisionOutcomeEmail } from "./emails";
import { buildEventSummary, resolveCcList, sendAndLog } from "./notifications";
import { getApprovalPolicy } from "./settings";

type Meta = { ipAddress?: string | null };

export class ApprovalError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export async function getActiveWorkflow(db: PrismaClient) {
  return db.approvalWorkflow.findFirst({
    where: { active: true },
    include: {
      stages: {
        orderBy: { sequence: "asc" },
        include: { approvers: { include: { user: true }, orderBy: { sortOrder: "asc" } } },
      },
    },
  });
}

/** Freezes everything that was submitted, so an approval always refers to an exact plan (FR-20). */
async function snapshotEvent(tx: Prisma.TransactionClient, eventId: string, actorId: string) {
  const event = await tx.event.findUniqueOrThrow({
    where: { id: eventId },
    include: {
      costLines: { orderBy: { sortOrder: "asc" } },
      tasks: { orderBy: { sortOrder: "asc" } },
      stakeholders: true,
      speakers: true,
      attachments: { select: { id: true, fileName: true, kind: true } },
    },
  });
  const last = await tx.eventVersion.aggregate({ where: { eventId }, _max: { versionNo: true } });
  const versionNo = (last._max.versionNo ?? 0) + 1;

  const version = await tx.eventVersion.create({
    data: {
      eventId,
      versionNo,
      createdById: actorId,
      snapshot: {
        title: event.title,
        answers: event.answers,
        estimatedCost: event.estimatedCost.toString(),
        motadataContribution: event.motadataContribution?.toString() ?? null,
        partnerContribution: event.partnerContribution?.toString() ?? null,
        mdfAllocation: event.mdfAllocation?.toString() ?? null,
        costLines: event.costLines.map((l) => ({
          description: l.description,
          categoryId: l.categoryId,
          estimated: l.estimated.toString(),
          vendor: l.vendor,
        })),
        tasks: event.tasks.map((t) => ({ title: t.title, dueDate: t.dueDate, ownerId: t.ownerId })),
        stakeholders: event.stakeholders.map((s) => ({ userId: s.userId, externalName: s.externalName, role: s.role })),
        speakers: event.speakers.map((s) => ({ name: s.name, organization: s.organization, topic: s.topic })),
        attachments: event.attachments,
      } as Prisma.InputJsonValue,
    },
  });
  return { version, versionNo };
}

/** Issues one single-use link per approver of a stage and emails them the request. */
async function openStage(db: PrismaClient, roundId: string, stageId: string) {
  const [round, stage, policy] = await Promise.all([
    db.approvalRound.findUniqueOrThrow({ where: { id: roundId }, include: { version: true, event: true } }),
    db.approvalStage.findUniqueOrThrow({
      where: { id: stageId },
      include: {
        approvers: { include: { user: true }, orderBy: { sortOrder: "asc" } },
        workflow: { include: { stages: true } },
      },
    }),
    getApprovalPolicy(db),
  ]);

  const isFinalStage = stage.sequence === Math.max(...stage.workflow.stages.map((s) => s.sequence));
  const summary = await buildEventSummary(db, round.eventId, round.version.versionNo);
  const expiresAt = new Date(Date.now() + policy.tokenTtlHours * 3_600_000);

  for (const entry of stage.approvers) {
    if (entry.user.status !== "ACTIVE") continue;
    const token = generateToken();
    await db.approvalToken.create({
      data: { tokenHash: hashToken(token), roundId, stageId, approverId: entry.userId, expiresAt },
    });
    // The approver is the recipient, so keep them out of their own CC list.
    const cc = await resolveCcList(db, round.eventId, { excludeEmails: [entry.user.email], policy });
    const message = approvalRequestEmail({
      to: entry.user.email,
      approverName: entry.user.name,
      stageName: stage.name,
      isFinalStage,
      summary,
      token,
      // Only the detailed final-approval email carries the full CC list (PRD §7 step 3).
      cc: isFinalStage ? cc : undefined,
    });
    await sendAndLog(db, message, {
      kind: isFinalStage ? "approval.final_request" : "approval.request",
      eventId: round.eventId,
      roundId,
    });
  }
}

/** Kills any unused links for a round, so a closed or superseded request can no longer be decided. */
async function invalidateTokens(db: PrismaClient | Prisma.TransactionClient, roundId: string) {
  await db.approvalToken.updateMany({ where: { roundId, usedAt: null }, data: { usedAt: new Date() } });
}

/** Submits the request: snapshots it, opens the first stage and emails its approvers. */
export async function submitForApproval(db: PrismaClient, actor: Actor, eventId: string, meta: Meta = {}) {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) throw new ApprovalError("Event not found.");
  if (!["DRAFT", "SCHEDULING"].includes(event.lifecycleStatus)) {
    throw new ApprovalError(
      event.lifecycleStatus === "PENDING_APPROVAL"
        ? "This request is already with approvers."
        : "This event cannot be submitted from its current stage.",
    );
  }

  if (event.salesReviewStatus === "PENDING" || event.salesReviewStatus === "NO_GO") {
    throw new ApprovalError("Sales has not cleared this event yet. It can be submitted once Sales says Go.");
  }

  const completeness = await checkCompleteness(db, eventId);
  if (!completeness.complete) {
    throw new ApprovalError("Some required details are still missing. Fix them, then submit again.");
  }

  const workflow = await getActiveWorkflow(db);
  if (!workflow || workflow.stages.length === 0) {
    throw new ApprovalError("No approval workflow is set up. Ask an administrator to configure one.");
  }
  const firstStage = workflow.stages[0];
  if (firstStage.approvers.length === 0) {
    throw new ApprovalError(`No approvers are assigned to "${firstStage.name}". Ask an administrator to add them.`);
  }

  const roundId = await db.$transaction(async (tx) => {
    // An earlier round can no longer be acted on once a new version is submitted.
    const open = await tx.approvalRound.findMany({ where: { eventId, status: "PENDING" } });
    if (open.length) {
      await tx.approvalRound.updateMany({
        where: { eventId, status: "PENDING" },
        data: { status: "SUPERSEDED", completedAt: new Date() },
      });
      for (const previous of open) await invalidateTokens(tx, previous.id);
    }

    const { version, versionNo } = await snapshotEvent(tx, eventId, actor.id);
    const round = await tx.approvalRound.create({
      data: {
        eventId,
        versionId: version.id,
        workflowId: workflow.id,
        currentStageId: firstStage.id,
        submittedById: actor.id,
      },
    });
    await tx.event.update({
      where: { id: eventId },
      data: { lifecycleStatus: "PENDING_APPROVAL", approvalStatus: "PENDING", submittedAt: new Date() },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "approval.submitted",
      entityType: "Event",
      entityId: eventId,
      summary: `${actor.name} submitted ${event.code} for approval (version ${versionNo})`,
      before: { lifecycleStatus: event.lifecycleStatus },
      after: { lifecycleStatus: "PENDING_APPROVAL", versionNo },
      ipAddress: meta.ipAddress,
    });
    return round.id;
  });

  await openStage(db, roundId, firstStage.id);
  return db.approvalRound.findUniqueOrThrow({ where: { id: roundId } });
}

export const decisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT", "REQUEST_CHANGES"]),
    comment: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((v) => v || null),
  })
  .refine((v) => v.decision === "APPROVE" || (v.comment && v.comment.length >= 5), {
    path: ["comment"],
    message: "Give a reason of at least 5 characters.",
  });

/** Records one approver's verdict and moves the round on. */
export async function recordDecision(
  db: PrismaClient,
  input: {
    roundId: string;
    approverId: string;
    decision: DecisionType;
    comment?: string | null;
    channel: DecisionChannel;
  },
  meta: Meta = {},
) {
  const parsed = decisionSchema.parse({ decision: input.decision, comment: input.comment ?? undefined });

  const round = await db.approvalRound.findUnique({
    where: { id: input.roundId },
    include: {
      event: true,
      version: true,
      currentStage: {
        include: { approvers: true, workflow: { include: { stages: { orderBy: { sequence: "asc" } } } } },
      },
      decisions: true,
    },
  });
  if (!round) throw new ApprovalError("Approval request not found.");
  if (round.status !== "PENDING" || !round.currentStage) {
    throw new ApprovalError("A decision has already been recorded for this request.");
  }

  const stage = round.currentStage;
  if (!stage.approvers.some((a) => a.userId === input.approverId)) {
    throw new ApprovalError("You are not an approver for this stage.");
  }
  if (round.decisions.some((d) => d.stageId === stage.id && d.approverId === input.approverId)) {
    throw new ApprovalError("You have already decided on this request.");
  }

  const policy = await getApprovalPolicy(db);
  if (!policy.allowSelfApproval && round.event.requesterId === input.approverId) {
    throw new ApprovalError("You cannot approve your own request.");
  }

  const approver = await db.user.findUniqueOrThrow({
    where: { id: input.approverId },
    select: { name: true, email: true },
  });
  const stages = stage.workflow.stages;

  // Record the verdict first; the unique index makes a double submit impossible.
  await db.approvalDecision.create({
    data: {
      roundId: round.id,
      stageId: stage.id,
      approverId: input.approverId,
      decision: parsed.decision,
      comment: parsed.comment,
      channel: input.channel,
      ipAddress: meta.ipAddress ?? null,
    },
  });
  await writeAudit(db, {
    actorId: input.approverId,
    action: `approval.${parsed.decision.toLowerCase()}`,
    entityType: "Event",
    entityId: round.eventId,
    summary: `${approver.name} ${verb(parsed.decision)} ${round.event.code} at "${stage.name}" (version ${round.version.versionNo}, ${input.channel.toLowerCase()})${parsed.comment ? `: ${parsed.comment}` : ""}`,
    ipAddress: meta.ipAddress,
  });

  const summary = await buildEventSummary(db, round.eventId, round.version.versionNo);
  const notifyTargets = async () => {
    const event = await db.event.findUniqueOrThrow({
      where: { id: round.eventId },
      select: { requester: { select: { email: true } }, owner: { select: { email: true } } },
    });
    const to = [...new Set([event.requester.email, event.owner?.email].filter(Boolean) as string[])];
    const cc = await resolveCcList(db, round.eventId, { excludeEmails: to, policy });
    return { to, cc };
  };

  // A rejection or a change request ends the round immediately.
  if (parsed.decision !== "APPROVE") {
    const status = parsed.decision === "REJECT" ? "REJECTED" : "CHANGES_REQUESTED";
    await db.$transaction(async (tx) => {
      await tx.approvalRound.update({ where: { id: round.id }, data: { status, completedAt: new Date() } });
      await tx.event.update({
        where: { id: round.eventId },
        data: { lifecycleStatus: "SCHEDULING", approvalStatus: status },
      });
      await invalidateTokens(tx, round.id);
    });
    const { to, cc } = await notifyTargets();
    await sendAndLog(
      db,
      decisionOutcomeEmail({ to, cc, summary, outcome: status, approverName: approver.name, comment: parsed.comment }),
      { kind: `approval.${status.toLowerCase()}`, eventId: round.eventId, roundId: round.id },
    );
    return { outcome: status };
  }

  // An approval: has this stage now reached its verdict?
  const approvals = [
    ...round.decisions.filter((d) => d.stageId === stage.id && d.decision === "APPROVE"),
    { approverId: input.approverId },
  ];
  const activeApprovers = await db.approvalStageApprover.count({
    where: { stageId: stage.id, user: { status: "ACTIVE" } },
  });
  const stageSatisfied = stage.mode === "ANY" ? true : approvals.length >= activeApprovers;

  if (!stageSatisfied) {
    return { outcome: "STAGE_PENDING" as const, waitingFor: activeApprovers - approvals.length };
  }

  const nextStage = stages.find((s) => s.sequence > stage.sequence);
  if (nextStage) {
    await db.approvalRound.update({
      where: { id: round.id },
      data: { currentStageId: nextStage.id, stageEnteredAt: new Date(), lastReminderAt: null, escalatedAt: null },
    });
    await invalidateTokens(db, round.id);
    await openStage(db, round.id, nextStage.id);
    return { outcome: "STAGE_ADVANCED" as const, nextStageName: nextStage.name };
  }

  // Final stage cleared: approve the event and lock the approved plan and costing (FR-20).
  await db.$transaction(async (tx) => {
    await tx.approvalRound.update({
      where: { id: round.id },
      data: { status: "APPROVED", currentStageId: null, completedAt: new Date() },
    });
    await tx.$executeRaw`UPDATE "cost_line_items" SET "approved" = "estimated" WHERE "eventId" = ${round.eventId}`;
    const totals = await tx.costLineItem.aggregate({ where: { eventId: round.eventId }, _sum: { approved: true } });
    await tx.event.update({
      where: { id: round.eventId },
      data: {
        lifecycleStatus: "APPROVED",
        approvalStatus: "APPROVED",
        approvedAt: new Date(),
        approvedCost: totals._sum.approved ?? new Prisma.Decimal(0),
      },
    });
    await invalidateTokens(tx, round.id);
    await writeAudit(tx, {
      actorId: input.approverId,
      action: "approval.completed",
      entityType: "Event",
      entityId: round.eventId,
      summary: `${round.event.code} fully approved; plan and costing locked at version ${round.version.versionNo}`,
      ipAddress: meta.ipAddress,
    });
  });

  const { to, cc } = await notifyTargets();
  await sendAndLog(
    db,
    decisionOutcomeEmail({
      to,
      cc,
      summary,
      outcome: "APPROVED",
      approverName: approver.name,
      comment: parsed.comment,
    }),
    { kind: "approval.approved", eventId: round.eventId, roundId: round.id },
  );
  return { outcome: "APPROVED" as const };
}

const verb = (decision: DecisionType) =>
  decision === "APPROVE" ? "approved" : decision === "REJECT" ? "rejected" : "requested changes to";

/**
 * Reopens an approved event for editing. Any material change needs a fresh approval (PRD §7),
 * so this sends it back to Scheduling and the next submission starts a new round.
 */
export async function reopenForChanges(
  db: PrismaClient,
  actor: Actor,
  eventId: string,
  reason: string,
  meta: Meta = {},
) {
  const clean = z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000).parse(reason);
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) throw new ApprovalError("Event not found.");
  if (!["APPROVED", "IN_EXECUTION"].includes(event.lifecycleStatus)) {
    throw new ApprovalError("Only an approved event needs reopening.");
  }

  const updated = await db.event.update({
    where: { id: eventId },
    data: { lifecycleStatus: "SCHEDULING", approvalStatus: "CHANGES_REQUESTED" },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "approval.reopened",
    entityType: "Event",
    entityId: eventId,
    summary: `${actor.name} reopened ${event.code} for changes: ${clean}. It needs approval again before it can run.`,
    before: { lifecycleStatus: event.lifecycleStatus },
    after: { lifecycleStatus: "SCHEDULING" },
    ipAddress: meta.ipAddress,
  });
  return updated;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/** Requests waiting on this approver right now. */
export async function pendingForApprover(db: PrismaClient, userId: string) {
  const rounds = await db.approvalRound.findMany({
    where: {
      status: "PENDING",
      currentStage: { approvers: { some: { userId } } },
      decisions: { none: { approverId: userId } },
    },
    orderBy: { stageEnteredAt: "asc" },
    include: {
      event: {
        include: {
          eventType: { select: { name: true } },
          requester: { select: { name: true } },
          owner: { select: { name: true } },
          partnerOrg: { select: { name: true } },
        },
      },
      version: { select: { versionNo: true } },
      currentStage: { select: { id: true, name: true, sequence: true, reminderHours: true } },
      decisions: { include: { approver: { select: { name: true } } } },
    },
  });
  return rounds;
}

export async function getRoundForEvent(db: PrismaClient, eventId: string) {
  return db.approvalRound.findFirst({
    where: { eventId },
    orderBy: { submittedAt: "desc" },
    include: {
      version: { select: { versionNo: true } },
      currentStage: { include: { approvers: { include: { user: { select: { id: true, name: true } } } } } },
      decisions: {
        include: { approver: { select: { name: true } }, stage: { select: { name: true } } },
        orderBy: { decidedAt: "asc" },
      },
      workflow: {
        include: {
          stages: {
            orderBy: { sequence: "asc" },
            include: { approvers: { include: { user: { select: { id: true, name: true } } } } },
          },
        },
      },
    },
  });
}

/** Full approval history for an event, newest round first. */
export async function getApprovalHistory(db: PrismaClient, eventId: string) {
  return db.approvalRound.findMany({
    where: { eventId },
    orderBy: { submittedAt: "desc" },
    include: {
      version: { select: { versionNo: true } },
      submittedBy: { select: { name: true } },
      decisions: {
        orderBy: { decidedAt: "asc" },
        include: { approver: { select: { name: true } }, stage: { select: { name: true } } },
      },
    },
  });
}
