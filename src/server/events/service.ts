import { Prisma, type LifecycleStatus, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Department } from "@/lib/permissions";
import { writeAudit } from "@/server/audit";
import { db as defaultDb } from "@/server/db";
import { promotedColumns, validateAnswers, type Answers } from "./answers";
import { nextEventCode } from "./codes";
import { resolveFieldsWithOptions } from "./fields";
import { salesReviewPrefill } from "./sales-review";

export type Actor = { id: string; name: string; department?: Department | null };
type Meta = { ipAddress?: string | null };

export class EventError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

/** Stages in which the requester may still edit the plan. */
export const EDITABLE_STAGES: LifecycleStatus[] = ["DRAFT", "SCHEDULING"];

export const createEventSchema = z.object({
  eventTypeId: z.string().min(1, "Choose an event type."),
  subtypeId: z
    .string()
    .optional()
    .transform((v) => v || null),
  title: z.string().trim().min(3, "Enter an event name.").max(200),
  department: z.enum(["SALES", "MARKETING", "CHANNEL", "FINANCE", "MANAGEMENT", "OTHER"]),
  partnerOrgId: z
    .string()
    .optional()
    .transform((v) => v || null),
  templateId: z
    .string()
    .optional()
    .transform((v) => v || null),
});
export type CreateEventInput = z.input<typeof createEventSchema>;

type TemplateSeed = {
  answers: Answers;
  costLines: { description: string; categoryId?: string | null; estimated?: number }[];
  tasks: { title: string; offsetDays?: number; notes?: string | null }[];
};

function readTemplate(template: { answers: unknown; costLines: unknown; tasks: unknown } | null): TemplateSeed {
  if (!template) return { answers: {}, costLines: [], tasks: [] };
  return {
    answers: (template.answers ?? {}) as Answers,
    costLines: Array.isArray(template.costLines) ? (template.costLines as TemplateSeed["costLines"]) : [],
    tasks: Array.isArray(template.tasks) ? (template.tasks as TemplateSeed["tasks"]) : [],
  };
}

/** Creates a Draft event, optionally pre-filled from a template. */
export async function createEvent(db: PrismaClient, actor: Actor, input: CreateEventInput, meta: Meta = {}) {
  const data = createEventSchema.parse(input);

  const eventType = await db.eventType.findFirst({ where: { id: data.eventTypeId, active: true } });
  if (!eventType) throw new EventError("Choose a valid event type.", "eventTypeId");

  if (data.subtypeId) {
    const subtype = await db.eventSubtype.findFirst({ where: { id: data.subtypeId, eventTypeId: eventType.id } });
    if (!subtype) throw new EventError("Choose a valid subtype.", "subtypeId");
  }

  let partnerTier: string | null = null;
  if (data.partnerOrgId) {
    if (!eventType.needsPartner) throw new EventError("This event type does not involve a partner.", "partnerOrgId");
    const org = await db.organization.findFirst({
      where: { id: data.partnerOrgId, status: "ACTIVE", type: { in: ["PARTNER", "DISTRIBUTOR"] } },
      include: { tier: true },
    });
    if (!org) throw new EventError("Choose a valid partner or distributor.", "partnerOrgId");
    partnerTier = org.tier?.value ?? null;
  }

  const template = data.templateId
    ? await db.eventTemplate.findFirst({ where: { id: data.templateId, active: true, eventTypeId: eventType.id } })
    : null;
  if (data.templateId && !template) throw new EventError("Choose a valid template.", "templateId");
  const seed = readTemplate(template);

  // Keep only answers that this event type's configuration actually shows.
  const { fields, options } = await resolveFieldsWithOptions(db, eventType.id, partnerTier);
  const seeded = validateAnswers(fields, { ...seed.answers, "basic.name": data.title }, { options });
  const answers = seeded.answers;

  return db.$transaction(async (tx) => {
    const code = await nextEventCode(tx);
    const promoted = promotedColumns(answers);
    const event = await tx.event.create({
      data: {
        code,
        title: data.title,
        eventTypeId: eventType.id,
        subtypeId: data.subtypeId ?? template?.subtypeId ?? null,
        department: data.department,
        requesterId: actor.id,
        ownerId: actor.id,
        partnerOrgId: data.partnerOrgId,
        partnerTier,
        templateId: template?.id ?? null,
        // Every new event waits for Sales' go / no-go before planning starts (./sales-review.ts).
        salesReviewStatus: "PENDING",
        salesReview: {
          create: { answers: salesReviewPrefill(eventType.key, answers) as Prisma.InputJsonValue },
        },
        answers: answers as Prisma.InputJsonValue,
        proposedDate: promoted.proposedDate,
        durationDays: promoted.durationDays,
        city: promoted.city,
        region: promoted.region,
        format: promoted.format,
        productFocus: promoted.productFocus,
        motadataContribution: promoted.motadataContribution,
        partnerContribution: promoted.partnerContribution,
        mdfAllocation: promoted.mdfAllocation,
      },
    });

    if (seed.costLines.length) {
      await tx.costLineItem.createMany({
        data: seed.costLines.map((line, index) => ({
          eventId: event.id,
          description: String(line.description ?? "Cost line"),
          categoryId: line.categoryId ?? null,
          estimated: new Prisma.Decimal(Number(line.estimated ?? 0)),
          sortOrder: index,
        })),
      });
    }
    if (seed.tasks.length) {
      await tx.task.createMany({
        data: seed.tasks.map((task, index) => ({
          eventId: event.id,
          title: String(task.title ?? "Task"),
          notes: task.notes ?? null,
          sortOrder: index,
        })),
      });
    }

    await writeAudit(tx, {
      actorId: actor.id,
      action: "event.created",
      entityType: "Event",
      entityId: event.id,
      summary: `${actor.name} created ${event.code} "${event.title}"${template ? ` from template "${template.name}"` : ""}`,
      ipAddress: meta.ipAddress,
    });

    const withTotals = await recalculateTotals(tx, event.id);
    return withTotals;
  });
}

/** Recomputes estimated / approved / actual totals from the event's cost lines. */
export async function recalculateTotals(tx: Prisma.TransactionClient | PrismaClient, eventId: string) {
  const sums = await tx.costLineItem.aggregate({
    where: { eventId },
    _sum: { estimated: true, approved: true, actual: true },
  });
  return tx.event.update({
    where: { id: eventId },
    data: {
      estimatedCost: sums._sum.estimated ?? new Prisma.Decimal(0),
      approvedCost: sums._sum.approved,
      actualCost: sums._sum.actual ?? new Prisma.Decimal(0),
    },
  });
}

/** Saves answers for one section (or the whole form). Drafts may be incomplete. */
const POST_EVENT_KEYS_RE = /^post\./;
const EXECUTION_STAGES: LifecycleStatus[] = ["APPROVED", "IN_EXECUTION", "CLOSED"];

export async function saveAnswers(
  db: PrismaClient,
  actor: Actor,
  eventId: string,
  raw: Record<string, unknown>,
  meta: Meta = {},
) {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) throw new EventError("Event not found.");

  const submittedKeys = Object.keys(raw);
  const allPostEvent = submittedKeys.every((k) => POST_EVENT_KEYS_RE.test(k));
  const inExecution = EXECUTION_STAGES.includes(event.lifecycleStatus);

  // Post-event fields may be saved once the event is approved; all other fields require DRAFT/SCHEDULING.
  if (allPostEvent && inExecution) {
    // allowed — fall through
  } else {
    assertEditable(event.lifecycleStatus);
  }

  const { fields, options } = await resolveFieldsWithOptions(db, event.eventTypeId, event.partnerTier);
  // Only touch the keys that were submitted, so saving one section leaves the others intact.
  const submittedKeySet = new Set(submittedKeys);
  const sectionFields = fields.filter((f) => submittedKeySet.has(f.key));
  const result = validateAnswers(sectionFields, raw, { options });
  const errors = result.ok ? {} : result.errors;

  // A field with an error is left exactly as it was, but every *other* field in the section is
  // still saved. Rejecting the whole tab for one bad value used to throw away the rest of what
  // had been typed — someone fixing a mistyped duration would find the Objective they had just
  // written never saved, and then be told at submission that it was missing.
  const before: Answers = { ...((event.answers ?? {}) as Answers) };
  const merged: Answers = { ...before };
  for (const field of sectionFields) {
    if (field.key in errors) continue;
    if (field.key in result.answers) merged[field.key] = result.answers[field.key];
    else delete merged[field.key];
  }

  const changed = sectionFields.filter((f) => JSON.stringify(before[f.key]) !== JSON.stringify(merged[f.key]));
  const promoted = promotedColumns(merged);
  await db.event.update({
    where: { id: eventId },
    data: {
      answers: merged as Prisma.InputJsonValue,
      title: promoted.title,
      proposedDate: promoted.proposedDate,
      durationDays: promoted.durationDays,
      city: promoted.city,
      region: promoted.region,
      format: promoted.format,
      productFocus: promoted.productFocus,
      motadataContribution: promoted.motadataContribution,
      partnerContribution: promoted.partnerContribution,
      mdfAllocation: promoted.mdfAllocation,
    },
  });

  // Mirror post-event answers into the structured PostEventResult table for reporting queries.
  if (allPostEvent && Object.keys(raw).length > 0) {
    const toInt = (v: unknown) => (v !== null && v !== "" && !isNaN(Number(v)) ? Number(v) : null);
    const toStr = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    await db.postEventResult.upsert({
      where: { eventId },
      update: {
        actualAttendance: toInt(merged["post.actualAttendance"]),
        companiesEngaged: toInt(merged["post.companiesEngaged"]),
        newLeads: toInt(merged["post.newLeads"]),
        sqls: toInt(merged["post.sqls"]),
        opportunities: toInt(merged["post.opportunities"]),
        partnerParticipation: toStr(merged["post.partnerParticipation"]),
        meetingsConducted: toInt(merged["post.meetings"]),
        satisfactionScore: toStr(merged["post.satisfaction"]),
        followUpOwner: toStr(merged["post.followUpOwner"]),
        nextAction: toStr(merged["post.nextAction"]),
        actualRoi: toStr(merged["post.actualRoi"]),
        actualRoiJustification: toStr(merged["post.actualRoiJustification"]),
      },
      create: {
        eventId,
        actualAttendance: toInt(merged["post.actualAttendance"]),
        companiesEngaged: toInt(merged["post.companiesEngaged"]),
        newLeads: toInt(merged["post.newLeads"]),
        sqls: toInt(merged["post.sqls"]),
        opportunities: toInt(merged["post.opportunities"]),
        partnerParticipation: toStr(merged["post.partnerParticipation"]),
        meetingsConducted: toInt(merged["post.meetings"]),
        satisfactionScore: toStr(merged["post.satisfaction"]),
        followUpOwner: toStr(merged["post.followUpOwner"]),
        nextAction: toStr(merged["post.nextAction"]),
        actualRoi: toStr(merged["post.actualRoi"]),
        actualRoiJustification: toStr(merged["post.actualRoiJustification"]),
      },
    });
  }

  // One audit entry per save, naming the fields that actually changed (PRD §11 Auditability).
  if (changed.length) {
    await writeAudit(db, {
      actorId: actor.id,
      action: "event.answers_saved",
      entityType: "Event",
      entityId: eventId,
      summary: `${actor.name} updated ${changed.map((f) => f.label).join(", ")} on ${event.code}`,
      before: Object.fromEntries(changed.map((f) => [f.key, before[f.key] ?? null])) as Prisma.InputJsonObject,
      after: Object.fromEntries(changed.map((f) => [f.key, merged[f.key] ?? null])) as Prisma.InputJsonObject,
      ipAddress: meta.ipAddress,
    });
  }
  if (Object.keys(errors).length) return { ok: false as const, errors, savedOthers: true as const };
  return { ok: true as const };
}

/** Planning cannot start until Sales has said Go (events from before the gate are exempt). */
export function assertSalesCleared(status: string) {
  if (status === "PENDING") {
    throw new EventError("Waiting for Sales' go / no-go. Planning starts once Sales approves the business case.");
  }
  if (status === "NO_GO") throw new EventError("Sales decided not to run this event.");
}

function assertEditable(status: LifecycleStatus) {
  if (!EDITABLE_STAGES.includes(status)) {
    throw new EventError(
      status === "PENDING_APPROVAL"
        ? "This request is with approvers and cannot be edited."
        : "This event is locked and cannot be edited.",
    );
  }
}

/** Draft → Scheduling: the request has been raised and planning starts. */
export async function moveToScheduling(db: PrismaClient, actor: Actor, eventId: string, meta: Meta = {}) {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) throw new EventError("Event not found.");
  if (event.lifecycleStatus !== "DRAFT") throw new EventError("Only a draft can be moved to scheduling.");
  assertSalesCleared(event.salesReviewStatus);

  const updated = await db.event.update({ where: { id: eventId }, data: { lifecycleStatus: "SCHEDULING" } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.scheduling_started",
    entityType: "Event",
    entityId: eventId,
    summary: `${actor.name} moved ${event.code} to Scheduling`,
    before: { lifecycleStatus: "DRAFT" },
    after: { lifecycleStatus: "SCHEDULING" },
    ipAddress: meta.ipAddress,
  });
  return updated;
}

/** What is still missing before the request can go to approval. */
export async function checkCompleteness(db: PrismaClient, eventId: string) {
  const event = await db.event.findUnique({ where: { id: eventId }, include: { costLines: true } });
  if (!event) throw new EventError("Event not found.");
  const { fields, options } = await resolveFieldsWithOptions(db, event.eventTypeId, event.partnerTier);

  // Post-event answers are filled at closure, not at submission. System fields (owner, manager,
  // partner) live in their own columns and are checked below, not through the answers blob.
  const submissionFields = fields.filter((f) => f.section !== "POST_EVENT" && !f.system);
  const result = validateAnswers(submissionFields, (event.answers ?? {}) as Record<string, unknown>, {
    enforceRequired: true,
    options,
  });

  const fieldMeta = Object.fromEntries(fields.map((f) => [f.key, { label: f.label, section: f.section }]));
  const issues: Record<string, { message: string; section: string; tab: string }> = {};

  const SECTION_TAB: Record<string, string> = {
    BASIC_DETAILS: "details",
    STAKEHOLDERS: "stakeholders",
    BUDGET: "budget",
    PLANNING: "planning",
    POST_EVENT: "post-event",
  };

  for (const [key, msg] of Object.entries(result.ok ? {} : result.errors)) {
    const meta = fieldMeta[key];
    const section = meta?.section ?? "BASIC_DETAILS";
    issues[key] = { message: `${meta?.label ?? key} — ${msg}`, section, tab: SECTION_TAB[section] ?? "details" };
  }
  if (event.costLines.length === 0)
    issues["costLines"] = { message: "Add at least one expense line item", section: "BUDGET", tab: "budget" };
  if (!event.ownerId)
    issues["ownerId"] = { message: "Assign an event owner", section: "STAKEHOLDERS", tab: "stakeholders" };
  return { complete: Object.keys(issues).length === 0, issues, fields };
}

/** Cancels an event at any stage, keeping its history (PRD §3.1). */
export async function dropEvent(db: PrismaClient, actor: Actor, eventId: string, reason: string, meta: Meta = {}) {
  const clean = z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000).parse(reason);
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) throw new EventError("Event not found.");
  if (event.lifecycleStatus === "DROPPED") return event;
  if (event.lifecycleStatus === "CLOSED") throw new EventError("A closed event cannot be dropped.");

  const updated = await db.event.update({
    where: { id: eventId },
    data: { lifecycleStatus: "DROPPED", droppedReason: clean },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.dropped",
    entityType: "Event",
    entityId: eventId,
    summary: `${actor.name} dropped ${event.code}: ${clean}`,
    before: { lifecycleStatus: event.lifecycleStatus },
    after: { lifecycleStatus: "DROPPED" },
    ipAddress: meta.ipAddress,
  });
  return updated;
}

/** Moves an approved event into execution; only the event owner / manager / admin may do this. */
export async function moveToExecution(db: PrismaClient, actor: Actor, eventId: string, meta: Meta = {}) {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) throw new EventError("Event not found.");
  if (event.lifecycleStatus !== "APPROVED") throw new EventError("Only an Approved event can be moved to execution.");

  const updated = await db.event.update({
    where: { id: eventId },
    data: { lifecycleStatus: "IN_EXECUTION" },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.in_execution",
    entityType: "Event",
    entityId: eventId,
    summary: `${actor.name} moved ${event.code} to In Execution.`,
    before: { lifecycleStatus: "APPROVED" },
    after: { lifecycleStatus: "IN_EXECUTION" },
    ipAddress: meta.ipAddress,
  });
  return updated;
}

/** Closes an event; requires post-event key fields to be filled in. */
export async function closeEvent(db: PrismaClient, actor: Actor, eventId: string, meta: Meta = {}) {
  const event = await db.event.findUnique({ where: { id: eventId }, include: { postEventResult: true } });
  if (!event) throw new EventError("Event not found.");
  if (event.lifecycleStatus !== "IN_EXECUTION") throw new EventError("Only an In Execution event can be closed.");

  // Require at least actual attendance and actual ROI before closing.
  const per = event.postEventResult;
  const missing: string[] = [];
  if (!per?.actualAttendance) missing.push("Actual attendance");
  if (!per?.actualRoi) missing.push("Actual ROI");
  if (missing.length > 0)
    throw new EventError(`Complete Post-Event Performance before closing: ${missing.join(", ")}.`);

  const updated = await db.event.update({
    where: { id: eventId },
    data: { lifecycleStatus: "CLOSED" },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.closed",
    entityType: "Event",
    entityId: eventId,
    summary: `${actor.name} closed ${event.code}.`,
    before: { lifecycleStatus: "IN_EXECUTION" },
    after: { lifecycleStatus: "CLOSED" },
    ipAddress: meta.ipAddress,
  });
  return updated;
}

// ─── Queries ────────────────────────────────────────────────────────────────

export async function getEvent(db: PrismaClient = defaultDb, id: string) {
  return db.event.findUnique({
    where: { id },
    include: {
      eventType: true,
      subtype: true,
      requester: { select: { id: true, name: true, email: true } },
      owner: { select: { id: true, name: true, email: true } },
      manager: { select: { id: true, name: true } },
      partnerOrg: { include: { tier: true } },
      template: { select: { id: true, name: true } },
      stakeholders: { include: { user: { select: { id: true, name: true } } }, orderBy: { sortOrder: "asc" } },
      costLines: {
        include: { category: true, invoices: { select: { id: true, fileName: true }, orderBy: { createdAt: "asc" } } },
        orderBy: { sortOrder: "asc" },
      },
      tasks: {
        include: { owner: { select: { id: true, name: true } }, dependsOn: true },
        orderBy: { sortOrder: "asc" },
      },
      attachments: { include: { uploadedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      speakers: { orderBy: { sortOrder: "asc" } },
      postEventResult: true,
      salesReview: { include: { reviewedBy: { select: { name: true } } } },
    },
  });
}

export async function getEventByCode(db: PrismaClient, code: string) {
  const event = await db.event.findUnique({ where: { code }, select: { id: true } });
  return event ? getEvent(db, event.id) : null;
}

/**
 * Who may change an event: the people responsible for it, or an administrator.
 * Approvers act through the approval workflow (Phase 4), not by editing the request.
 */
export function canEditEvent(
  user: { id: string; roles: readonly string[]; department?: string | null },
  event: { requesterId: string; ownerId: string | null; managerId: string | null },
) {
  if (user.roles.includes("ADMIN")) return true;
  // Sales only reviews (Go / No-go); every other part of an event is view-only for them.
  if (user.department === "SALES") return false;
  return [event.requesterId, event.ownerId, event.managerId].includes(user.id);
}

export function assertCanEditEvent(
  user: { id: string; roles: readonly string[]; department?: string | null },
  event: { requesterId: string; ownerId: string | null; managerId: string | null },
) {
  if (!canEditEvent(user, event)) {
    throw new EventError("Only the requester, event owner, event manager or an administrator can change this event.");
  }
}

export const ownershipSchema = z.object({
  ownerId: z.string().trim().min(1, "Choose an event owner."),
  managerId: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null),
  partnerOrgId: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null),
  /** A PARTNER_TIER lookup value. Blank means "use the partner's own tier". */
  partnerTier: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null),
});

/**
 * Owner, manager, partner and tier — chosen from lists, never typed.
 *
 * These were set once at creation and could not be changed afterwards. They change only while the
 * plan is editable, like every other part of the plan, because the tier decides which form rules
 * apply and the partner is part of what gets approved.
 */
export async function updateOwnership(
  db: PrismaClient,
  actor: Actor & { roles: readonly string[] },
  eventId: string,
  input: z.input<typeof ownershipSchema>,
  meta: Meta = {},
) {
  const data = ownershipSchema.parse(input);
  const event = await db.event.findUnique({ where: { id: eventId }, include: { eventType: true } });
  if (!event) throw new EventError("Event not found.");
  assertCanEditEvent(actor, event);
  if (!EDITABLE_STAGES.includes(event.lifecycleStatus)) {
    throw new EventError("The plan is locked at this stage, so its owner and partner cannot change.");
  }

  const people = [data.ownerId, data.managerId].filter(Boolean) as string[];
  const found = await db.user.count({ where: { id: { in: people }, status: "ACTIVE" } });
  if (found !== new Set(people).size) throw new EventError("Choose active users.", "ownerId");

  let partnerTier: string | null = null;
  if (data.partnerOrgId) {
    if (!event.eventType.needsPartner) {
      throw new EventError("This event type does not involve a partner.", "partnerOrgId");
    }
    const org = await db.organization.findFirst({
      where: { id: data.partnerOrgId, status: "ACTIVE", type: { in: ["PARTNER", "DISTRIBUTOR"] } },
      include: { tier: true },
    });
    if (!org) throw new EventError("Choose a valid partner or distributor.", "partnerOrgId");
    partnerTier = org.tier?.value ?? null;
  }
  if (data.partnerTier) {
    const tier = await db.lookupItem.findFirst({
      where: { kind: "PARTNER_TIER", value: data.partnerTier, active: true },
    });
    if (!tier) throw new EventError("Choose a valid tier.", "partnerTier");
    partnerTier = tier.value;
  }

  const updated = await db.event.update({
    where: { id: eventId },
    data: { ownerId: data.ownerId, managerId: data.managerId, partnerOrgId: data.partnerOrgId, partnerTier },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.ownership_changed",
    entityType: "Event",
    entityId: eventId,
    summary: `${actor.name} changed the owner, manager or partner of ${event.code}`,
    before: {
      ownerId: event.ownerId,
      managerId: event.managerId,
      partnerOrgId: event.partnerOrgId,
      partnerTier: event.partnerTier,
    },
    after: { ownerId: updated.ownerId, managerId: updated.managerId, partnerOrgId: updated.partnerOrgId, partnerTier },
    ipAddress: meta.ipAddress,
  });
  return updated;
}
