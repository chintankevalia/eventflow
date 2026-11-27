import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { validateAnswers } from "@/server/events/answers";
import { resolveFieldsWithOptions } from "@/server/events/fields";
import { EventError, type Actor } from "@/server/events/service";

type Meta = { ipAddress?: string | null };

/**
 * Event templates: a reusable starting point holding prefilled answers, standard cost lines and a
 * task checklist whose due dates are relative to the event date.
 */

export const templateCostLineSchema = z.object({
  description: z.string().trim().min(2).max(200),
  categoryId: z
    .string()
    .optional()
    .transform((v) => v || null),
  estimated: z.coerce.number().min(0).max(1_000_000_000).default(0),
});

export const templateTaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  /** Days relative to the event date; negative means before it. */
  offsetDays: z.coerce.number().int().min(-365).max(365).default(-14),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
});

export const templateSchema = z.object({
  name: z.string().trim().min(3, "Name the template.").max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
  eventTypeId: z.string().min(1, "Choose an event type."),
  subtypeId: z
    .string()
    .optional()
    .transform((v) => v || null),
  answers: z.record(z.string(), z.unknown()).default({}),
  costLines: z.array(templateCostLineSchema).max(50).default([]),
  tasks: z.array(templateTaskSchema).max(100).default([]),
});
export type TemplateInput = z.input<typeof templateSchema>;

async function cleanAnswers(db: PrismaClient, eventTypeId: string, raw: Record<string, unknown>) {
  // Templates have no partner tier of their own, so they use the all-tiers configuration.
  const { fields, options } = await resolveFieldsWithOptions(db, eventTypeId, null);
  const result = validateAnswers(fields, raw, { options });
  if (!result.ok) throw new EventError(Object.values(result.errors)[0] ?? "Check the prefilled values.");
  return result.answers;
}

export async function createTemplate(db: PrismaClient, actor: Actor, input: TemplateInput, meta: Meta = {}) {
  const data = templateSchema.parse(input);
  const eventType = await db.eventType.findFirst({ where: { id: data.eventTypeId, active: true } });
  if (!eventType) throw new EventError("Choose a valid event type.", "eventTypeId");

  const answers = await cleanAnswers(db, eventType.id, data.answers);
  const template = await db.eventTemplate.create({
    data: {
      name: data.name,
      description: data.description,
      eventTypeId: eventType.id,
      subtypeId: data.subtypeId,
      answers: answers as Prisma.InputJsonValue,
      costLines: data.costLines as Prisma.InputJsonValue,
      tasks: data.tasks as Prisma.InputJsonValue,
      createdById: actor.id,
    },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "template.created",
    entityType: "EventTemplate",
    entityId: template.id,
    summary: `${actor.name} created template "${template.name}"`,
    ipAddress: meta.ipAddress,
  });
  return template;
}

export async function updateTemplate(
  db: PrismaClient,
  actor: Actor,
  id: string,
  input: TemplateInput,
  meta: Meta = {},
) {
  const data = templateSchema.parse(input);
  const existing = await db.eventTemplate.findUnique({ where: { id } });
  if (!existing) throw new EventError("Template not found.");
  const answers = await cleanAnswers(db, data.eventTypeId, data.answers);

  const template = await db.eventTemplate.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      eventTypeId: data.eventTypeId,
      subtypeId: data.subtypeId,
      answers: answers as Prisma.InputJsonValue,
      costLines: data.costLines as Prisma.InputJsonValue,
      tasks: data.tasks as Prisma.InputJsonValue,
    },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "template.updated",
    entityType: "EventTemplate",
    entityId: id,
    summary: `${actor.name} updated template "${template.name}"`,
    ipAddress: meta.ipAddress,
  });
  return template;
}

export async function duplicateTemplate(db: PrismaClient, actor: Actor, id: string, meta: Meta = {}) {
  const source = await db.eventTemplate.findUnique({ where: { id } });
  if (!source) throw new EventError("Template not found.");
  const copy = await db.eventTemplate.create({
    data: {
      name: `${source.name} (copy)`.slice(0, 120),
      description: source.description,
      eventTypeId: source.eventTypeId,
      subtypeId: source.subtypeId,
      answers: source.answers as Prisma.InputJsonValue,
      costLines: source.costLines as Prisma.InputJsonValue,
      tasks: source.tasks as Prisma.InputJsonValue,
      createdById: actor.id,
    },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "template.duplicated",
    entityType: "EventTemplate",
    entityId: copy.id,
    summary: `${actor.name} duplicated template "${source.name}"`,
    ipAddress: meta.ipAddress,
  });
  return copy;
}

export async function setTemplateActive(db: PrismaClient, actor: Actor, id: string, active: boolean, meta: Meta = {}) {
  const template = await db.eventTemplate.update({ where: { id }, data: { active } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "template.updated",
    entityType: "EventTemplate",
    entityId: id,
    summary: `${actor.name} ${active ? "restored" : "archived"} template "${template.name}"`,
    ipAddress: meta.ipAddress,
  });
  return template;
}

export async function listTemplates(db: PrismaClient, { includeArchived = false } = {}) {
  return db.eventTemplate.findMany({
    where: includeArchived ? {} : { active: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      eventType: { select: { id: true, name: true, needsPartner: true } },
      subtype: { select: { name: true } },
      _count: { select: { events: true } },
    },
  });
}

export async function getTemplate(db: PrismaClient, id: string) {
  return db.eventTemplate.findUnique({
    where: { id },
    include: { eventType: true, subtype: true, createdBy: { select: { name: true } } },
  });
}
