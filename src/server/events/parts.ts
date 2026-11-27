import { Prisma, type PrismaClient, type TaskStatus } from "@prisma/client";
import { z } from "zod";
import { startOfIstDay } from "@/lib/date-range";
import { writeAudit } from "@/server/audit";
import { EventError, recalculateTotals, type Actor } from "./service";

type Meta = { ipAddress?: string | null };

/** Planning (cost estimates, tasks, stakeholders) can be changed while the request is being prepared. */
const PLAN_EDITABLE = ["DRAFT", "SCHEDULING"];
/**
 * Actual spend, invoices and payment status are recorded while the event runs, and usually for a
 * while after it closes — payment is typically settled post-event, not on the day.
 */
const EXECUTION_EDITABLE = ["APPROVED", "IN_EXECUTION", "CLOSED"];

async function loadEvent(db: PrismaClient, eventId: string) {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) throw new EventError("Event not found.");
  return event;
}

function assertPlanEditable(status: string) {
  if (!PLAN_EDITABLE.includes(status)) throw new EventError("The plan is locked at this stage.");
}

// ─── Cost lines (FR-21) ──────────────────────────────────────────────────────

const money = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  })
  .refine((n) => n === null || (!Number.isNaN(n) && n >= 0), "Enter an amount of zero or more.");

export const costLineSchema = z.object({
  description: z.string().trim().min(2, "Describe the cost.").max(200),
  categoryId: z
    .string()
    .optional()
    .transform((v) => v || null),
  estimated: money,
  vendor: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => v || null),
});
export type CostLineInput = z.input<typeof costLineSchema>;

export async function addCostLine(
  db: PrismaClient,
  actor: Actor,
  eventId: string,
  input: CostLineInput,
  meta: Meta = {},
) {
  const data = costLineSchema.parse(input);
  const event = await loadEvent(db, eventId);
  assertPlanEditable(event.lifecycleStatus);
  if (data.categoryId) {
    const category = await db.expenseCategory.findFirst({ where: { id: data.categoryId, active: true } });
    if (!category) throw new EventError("Choose a valid expense category.", "categoryId");
  }

  const max = await db.costLineItem.aggregate({ where: { eventId }, _max: { sortOrder: true } });
  const line = await db.costLineItem.create({
    data: {
      eventId,
      description: data.description,
      categoryId: data.categoryId,
      vendor: data.vendor,
      estimated: new Prisma.Decimal(data.estimated ?? 0),
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
  await recalculateTotals(db, eventId);
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.cost_line_added",
    entityType: "Event",
    entityId: eventId,
    summary: `${actor.name} added cost line "${line.description}" to ${event.code}`,
    ipAddress: meta.ipAddress,
  });
  return line;
}

export const costLineUpdateSchema = costLineSchema.partial().extend({
  actual: money,
  invoiceRef: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  invoiceStatus: z.enum(["NOT_RAISED", "RECEIVED", "PAID"]).optional(),
  paymentStatus: z.enum(["PENDING", "PAID"]).nullable().optional(),
});

export async function updateCostLine(
  db: PrismaClient,
  actor: Actor,
  lineId: string,
  input: z.input<typeof costLineUpdateSchema>,
  meta: Meta = {},
) {
  const data = costLineUpdateSchema.parse(input);
  const existing = await db.costLineItem.findUnique({ where: { id: lineId }, include: { event: true } });
  if (!existing) throw new EventError("Cost line not found.");

  const planStage = PLAN_EDITABLE.includes(existing.event.lifecycleStatus);
  const executionStage = EXECUTION_EDITABLE.includes(existing.event.lifecycleStatus);
  if (!planStage && !executionStage) throw new EventError("This event's costs are locked.");

  const patch: Prisma.CostLineItemUpdateInput = {};
  if (planStage) {
    if (data.description !== undefined) patch.description = data.description;
    if (data.categoryId !== undefined)
      patch.category = data.categoryId ? { connect: { id: data.categoryId } } : { disconnect: true };
    if (data.vendor !== undefined) patch.vendor = data.vendor;
    if (data.estimated !== undefined && data.estimated !== null) patch.estimated = new Prisma.Decimal(data.estimated);
  }
  // Actuals and invoices are recorded once the event is approved and running.
  if (data.actual !== undefined && data.actual !== null) patch.actual = new Prisma.Decimal(data.actual);
  if (data.invoiceRef !== undefined) patch.invoiceRef = data.invoiceRef;
  if (data.invoiceStatus !== undefined) patch.invoiceStatus = data.invoiceStatus;
  if (data.paymentStatus !== undefined) patch.paymentStatus = data.paymentStatus;

  const line = await db.costLineItem.update({ where: { id: lineId }, data: patch });
  await recalculateTotals(db, existing.eventId);
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.cost_line_updated",
    entityType: "Event",
    entityId: existing.eventId,
    summary: `${actor.name} updated cost line "${line.description}" on ${existing.event.code}`,
    ipAddress: meta.ipAddress,
  });
  return line;
}

export async function removeCostLine(db: PrismaClient, actor: Actor, lineId: string, meta: Meta = {}) {
  const existing = await db.costLineItem.findUnique({ where: { id: lineId }, include: { event: true } });
  if (!existing) return;
  assertPlanEditable(existing.event.lifecycleStatus);
  await db.costLineItem.delete({ where: { id: lineId } });
  await recalculateTotals(db, existing.eventId);
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.cost_line_removed",
    entityType: "Event",
    entityId: existing.eventId,
    summary: `${actor.name} removed cost line "${existing.description}" from ${existing.event.code}`,
    ipAddress: meta.ipAddress,
  });
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const taskSchema = z.object({
  title: z.string().trim().min(2, "Describe the task.").max(200),
  ownerId: z
    .string()
    .optional()
    .transform((v) => v || null),
  dueDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? startOfIstDay(v) : null))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), "Enter a valid date."),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => v || null),
});
export type TaskInput = z.input<typeof taskSchema>;

export async function addTask(db: PrismaClient, actor: Actor, eventId: string, input: TaskInput, meta: Meta = {}) {
  const data = taskSchema.parse(input);
  const event = await loadEvent(db, eventId);
  if (event.lifecycleStatus === "CLOSED" || event.lifecycleStatus === "DROPPED") {
    throw new EventError("This event is closed.");
  }
  const max = await db.task.aggregate({ where: { eventId }, _max: { sortOrder: true } });
  const task = await db.task.create({ data: { ...data, eventId, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.task_added",
    entityType: "Event",
    entityId: eventId,
    summary: `${actor.name} added task "${task.title}" to ${event.code}`,
    ipAddress: meta.ipAddress,
  });
  return task;
}

export async function updateTask(
  db: PrismaClient,
  actor: Actor,
  taskId: string,
  input: Partial<TaskInput> & { status?: TaskStatus },
  meta: Meta = {},
) {
  const existing = await db.task.findUnique({
    where: { id: taskId },
    include: { event: true, dependsOn: { include: { dependsOn: true } } },
  });
  if (!existing) throw new EventError("Task not found.");

  const data = taskSchema.partial().parse(input);
  const patch: Prisma.TaskUpdateInput = { ...data };

  if (input.status && input.status !== existing.status) {
    // A task cannot start or finish while something it depends on is still open.
    if (input.status === "IN_PROGRESS" || input.status === "DONE") {
      const blocking = existing.dependsOn.filter((d) => d.dependsOn.status !== "DONE").map((d) => d.dependsOn.title);
      if (blocking.length) {
        throw new EventError(`Finish these first: ${blocking.join(", ")}.`, "status");
      }
    }
    patch.status = input.status;
  }

  const task = await db.task.update({ where: { id: taskId }, data: patch });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.task_updated",
    entityType: "Event",
    entityId: existing.eventId,
    summary: `${actor.name} updated task "${task.title}" on ${existing.event.code}${input.status ? ` (${input.status.toLowerCase().replace("_", " ")})` : ""}`,
    ipAddress: meta.ipAddress,
  });
  return task;
}

export async function removeTask(db: PrismaClient, actor: Actor, taskId: string, meta: Meta = {}) {
  const existing = await db.task.findUnique({ where: { id: taskId }, include: { event: true } });
  if (!existing) return;
  await db.task.delete({ where: { id: taskId } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.task_removed",
    entityType: "Event",
    entityId: existing.eventId,
    summary: `${actor.name} removed task "${existing.title}" from ${existing.event.code}`,
    ipAddress: meta.ipAddress,
  });
}

/** Adds "task cannot start until dependsOn is done", refusing anything that would create a loop. */
export async function addTaskDependency(db: PrismaClient, taskId: string, dependsOnTaskId: string) {
  if (taskId === dependsOnTaskId) throw new EventError("A task cannot depend on itself.");
  const [task, dependency] = await Promise.all([
    db.task.findUnique({ where: { id: taskId } }),
    db.task.findUnique({ where: { id: dependsOnTaskId } }),
  ]);
  if (!task || !dependency) throw new EventError("Task not found.");
  if (task.eventId !== dependency.eventId) throw new EventError("Tasks must belong to the same event.");

  // Walk the existing graph: if dependsOn already (indirectly) waits on task, this would loop.
  const edges = await db.taskDependency.findMany({ where: { task: { eventId: task.eventId } } });
  const waitsOn = new Map<string, string[]>();
  for (const edge of edges) {
    waitsOn.set(edge.taskId, [...(waitsOn.get(edge.taskId) ?? []), edge.dependsOnTaskId]);
  }
  const seen = new Set<string>();
  const stack = [dependsOnTaskId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === taskId) throw new EventError("That would create a circular dependency.");
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(waitsOn.get(current) ?? []));
  }

  return db.taskDependency.upsert({
    where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
    create: { taskId, dependsOnTaskId },
    update: {},
  });
}

export async function removeTaskDependency(db: PrismaClient, taskId: string, dependsOnTaskId: string) {
  await db.taskDependency.deleteMany({ where: { taskId, dependsOnTaskId } });
}

// ─── Stakeholders & speakers ─────────────────────────────────────────────────

export const stakeholderSchema = z
  .object({
    userId: z
      .string()
      .optional()
      .transform((v) => v || null),
    externalName: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((v) => v || null),
    role: z.string().trim().min(2, "Enter a role.").max(80),
    responsibility: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => v || null),
  })
  .refine((v) => v.userId || v.externalName, { path: ["userId"], message: "Choose a person or enter a name." });

export async function addStakeholder(
  db: PrismaClient,
  actor: Actor,
  eventId: string,
  input: z.input<typeof stakeholderSchema>,
  meta: Meta = {},
) {
  const data = stakeholderSchema.parse(input);
  const event = await loadEvent(db, eventId);
  assertPlanEditable(event.lifecycleStatus);
  const max = await db.eventStakeholder.aggregate({ where: { eventId }, _max: { sortOrder: true } });
  const stakeholder = await db.eventStakeholder.create({
    data: { ...data, eventId, sortOrder: (max._max.sortOrder ?? -1) + 1 },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.stakeholder_added",
    entityType: "Event",
    entityId: eventId,
    summary: `${actor.name} added ${data.role} to ${event.code}`,
    ipAddress: meta.ipAddress,
  });
  return stakeholder;
}

export async function removeStakeholder(db: PrismaClient, actor: Actor, id: string, meta: Meta = {}) {
  const existing = await db.eventStakeholder.findUnique({ where: { id }, include: { event: true } });
  if (!existing) return;
  assertPlanEditable(existing.event.lifecycleStatus);
  await db.eventStakeholder.delete({ where: { id } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.stakeholder_removed",
    entityType: "Event",
    entityId: existing.eventId,
    summary: `${actor.name} removed ${existing.role} from ${existing.event.code}`,
    ipAddress: meta.ipAddress,
  });
}

export const speakerSchema = z.object({
  name: z.string().trim().min(2, "Enter the speaker's name.").max(120),
  organization: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => v || null),
  topic: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),
});

export async function addSpeaker(
  db: PrismaClient,
  actor: Actor,
  eventId: string,
  input: z.input<typeof speakerSchema>,
  meta: Meta = {},
) {
  const data = speakerSchema.parse(input);
  const event = await loadEvent(db, eventId);
  if (event.lifecycleStatus === "DROPPED") throw new EventError("This event was dropped.");
  const max = await db.speaker.aggregate({ where: { eventId }, _max: { sortOrder: true } });
  const speaker = await db.speaker.create({ data: { ...data, eventId, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.speaker_added",
    entityType: "Event",
    entityId: eventId,
    summary: `${actor.name} added speaker "${speaker.name}" to ${event.code}`,
    ipAddress: meta.ipAddress,
  });
  return speaker;
}

export async function removeSpeaker(db: PrismaClient, actor: Actor, id: string, meta: Meta = {}) {
  const existing = await db.speaker.findUnique({ where: { id }, include: { event: true } });
  if (!existing) return;
  await db.speaker.delete({ where: { id } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.speaker_removed",
    entityType: "Event",
    entityId: existing.eventId,
    summary: `${actor.name} removed speaker "${existing.name}" from ${existing.event.code}`,
    ipAddress: meta.ipAddress,
  });
}

const postEventSchema = z.object({
  actualAttendance: z.coerce.number().int().min(0).nullable().optional(),
  companiesEngaged: z.coerce.number().int().min(0).nullable().optional(),
  newLeads: z.coerce.number().int().min(0).nullable().optional(),
  sqls: z.coerce.number().int().min(0).nullable().optional(),
  opportunities: z.coerce.number().int().min(0).nullable().optional(),
  partnerParticipation: z.string().trim().max(500).nullable().optional().transform((v) => v || null),
  meetingsConducted: z.coerce.number().int().min(0).nullable().optional(),
  satisfactionScore: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  followUpOwner: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  nextAction: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
  actualRoi: z.string().trim().max(500).nullable().optional().transform((v) => v || null),
  actualRoiJustification: z.string().trim().max(2000).nullable().optional().transform((v) => v || null),
  notes: z.string().trim().max(2000).nullable().optional().transform((v) => v || null),
});

export async function savePostEventResult(
  db: PrismaClient,
  actor: Actor,
  eventId: string,
  input: z.input<typeof postEventSchema>,
  meta: Meta = {},
) {
  const data = postEventSchema.parse(input);
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) throw new EventError("Event not found.");
  if (!["APPROVED", "IN_EXECUTION", "CLOSED"].includes(event.lifecycleStatus))
    throw new EventError("Post-event results can only be recorded after the event is approved.");

  const result = await db.postEventResult.upsert({
    where: { eventId },
    update: { ...data },
    create: { eventId, ...data },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "event.post_event_saved",
    entityType: "Event",
    entityId: eventId,
    summary: `${actor.name} updated post-event results for ${event.code}`,
    ipAddress: meta.ipAddress,
  });
  return result;
}
