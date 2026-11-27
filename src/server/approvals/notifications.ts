import type { PrismaClient } from "@prisma/client";
import { DEPARTMENT_LABEL } from "@/lib/permissions";
import { ATTACHMENT_KIND_LABEL } from "@/lib/attachments";
import { sendMail, type MailMessage } from "@/server/mail/transport";
import type { EventSummary } from "./emails";
import { getApprovalPolicy, type ApprovalPolicy } from "./settings";

/** Sends an email and records the attempt, so failures are visible rather than silent (PRD §11). */
export async function sendAndLog(
  db: PrismaClient,
  message: MailMessage,
  context: { kind: string; eventId?: string | null; roundId?: string | null },
) {
  const recipients = [message.to].flat();
  try {
    await sendMail(message);
    await db.notificationLog.create({
      data: {
        kind: context.kind,
        eventId: context.eventId ?? null,
        roundId: context.roundId ?? null,
        recipients,
        ccList: message.cc ?? [],
        subject: message.subject,
        status: "SENT",
      },
    });
    return { ok: true as const };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[mail] ${context.kind} failed`, error);
    await db.notificationLog.create({
      data: {
        kind: context.kind,
        eventId: context.eventId ?? null,
        roundId: context.roundId ?? null,
        recipients,
        ccList: message.cc ?? [],
        subject: message.subject,
        status: "FAILED",
        error: reason.slice(0, 500),
      },
    });
    return { ok: false as const, error: reason };
  }
}

/**
 * Who is copied on approval emails. Confirmed policy: everyone — requester, owner, the manager
 * and listed stakeholders, earlier approvers and Finance — with the list configurable in
 * settings. This is also where "after Amit sir's approval, every stakeholder gets an email"
 * is satisfied: the final APPROVED outcome email (`engine.ts`, `notifyTargets`) builds its CC
 * list through this same function.
 */
export async function resolveCcList(
  db: PrismaClient,
  eventId: string,
  options: { excludeEmails?: string[]; policy?: ApprovalPolicy } = {},
) {
  const policy = options.policy ?? (await getApprovalPolicy(db));
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      requester: { select: { email: true } },
      owner: { select: { email: true } },
      manager: { select: { email: true } },
      // Only stakeholders who are EventFlow users have an email to send to; an external
      // contact (a partner's own person) has no account and is never invented one.
      stakeholders: { where: { userId: { not: null } }, select: { user: { select: { email: true } } } },
      approvalRounds: {
        where: { status: { in: ["PENDING", "APPROVED"] } },
        orderBy: { submittedAt: "desc" },
        take: 1,
        select: { decisions: { select: { approver: { select: { email: true } } } } },
      },
    },
  });
  if (!event) return [];

  const emails = new Set<string>();
  if (policy.ccRequester && event.requester?.email) emails.add(event.requester.email);
  if (policy.ccOwner && event.owner?.email) emails.add(event.owner.email);
  if (policy.ccStakeholders) {
    if (event.manager?.email) emails.add(event.manager.email);
    for (const stakeholder of event.stakeholders) {
      if (stakeholder.user?.email) emails.add(stakeholder.user.email);
    }
  }
  if (policy.ccEarlierApprovers) {
    for (const decision of event.approvalRounds[0]?.decisions ?? []) emails.add(decision.approver.email);
  }
  if (policy.ccFinance) {
    const finance = await db.user.findMany({
      where: { status: "ACTIVE", roles: { has: "FINANCE" } },
      select: { email: true },
    });
    for (const user of finance) emails.add(user.email);
  }
  for (const extra of policy.ccExtra) emails.add(extra);
  for (const excluded of options.excludeEmails ?? []) emails.delete(excluded);

  return [...emails];
}

/** Builds the summary block shared by every approval email. */
export async function buildEventSummary(db: PrismaClient, eventId: string, versionNo: number): Promise<EventSummary> {
  const event = await db.event.findUniqueOrThrow({
    where: { id: eventId },
    include: {
      eventType: { select: { name: true } },
      subtype: { select: { name: true } },
      requester: { select: { name: true } },
      owner: { select: { name: true } },
      partnerOrg: { include: { tier: { select: { label: true } } } },
      costLines: { include: { category: { select: { name: true } } }, orderBy: { sortOrder: "asc" } },
      attachments: { select: { fileName: true, kind: true } },
    },
  });

  // Dropdown answers are stored as machine values; show the labels people recognise.
  const answers = (event.answers ?? {}) as Record<string, unknown>;
  const lookupValues = [answers["basic.format"], answers["basic.region"], answers["basic.productFocus"]].filter(
    (v): v is string => typeof v === "string",
  );
  const labels = lookupValues.length
    ? await db.lookupItem.findMany({
        where: { value: { in: lookupValues } },
        select: { value: true, label: true, kind: true },
      })
    : [];
  const labelFor = (value: unknown, kind: string) =>
    typeof value === "string" ? (labels.find((l) => l.value === value && l.kind === kind)?.label ?? value) : null;

  const text = (key: string) => (typeof answers[key] === "string" ? (answers[key] as string) : null);

  return {
    code: event.code,
    title: event.title,
    eventTypeName: event.eventType.name,
    subtypeName: event.subtype?.name ?? null,
    department: DEPARTMENT_LABEL[event.department],
    requesterName: event.requester.name,
    ownerName: event.owner?.name ?? null,
    partnerName: event.partnerOrg?.name ?? null,
    partnerTierLabel: event.partnerOrg?.tier?.label ?? null,
    proposedDate: event.proposedDate,
    durationDays: event.durationDays,
    city: event.city,
    region: labelFor(answers["basic.region"], "REGION"),
    format: labelFor(answers["basic.format"], "EVENT_FORMAT"),
    productFocus: labelFor(answers["basic.productFocus"], "PRODUCT_FOCUS"),
    objective: text("basic.objective"),
    expectedRoi: text("budget.expectedRoi"),
    expectedRoiJustification: text("budget.expectedRoiJustification"),
    estimatedCost: Number(event.estimatedCost),
    motadataContribution: event.motadataContribution !== null ? Number(event.motadataContribution) : null,
    partnerContribution: event.partnerContribution !== null ? Number(event.partnerContribution) : null,
    mdfAllocation: event.mdfAllocation !== null ? Number(event.mdfAllocation) : null,
    costLines: event.costLines.map((line) => ({
      description: line.description,
      category: line.category?.name ?? null,
      estimated: Number(line.estimated),
    })),
    attachments: event.attachments.map((a) => ({ fileName: a.fileName, kindLabel: ATTACHMENT_KIND_LABEL[a.kind] })),
    versionNo,
  };
}
