import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { ConfigError, type Actor } from "./lookups";

type Meta = { ipAddress?: string | null };

const keyFrom = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50) || "type";

export const eventTypeInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(80),
  needsPartner: z.coerce.boolean().default(false),
});
export type EventTypeInput = z.infer<typeof eventTypeInputSchema>;

export async function listEventTypes(db: PrismaClient) {
  return db.eventType.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      subtypes: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      _count: { select: { fieldRules: true } },
    },
  });
}

export async function createEventType(db: PrismaClient, actor: Actor, input: EventTypeInput, meta: Meta = {}) {
  const data = eventTypeInputSchema.parse(input);
  const max = await db.eventType.aggregate({ _max: { sortOrder: true } });
  let key = keyFrom(data.name);
  if (await db.eventType.findUnique({ where: { key } })) key = `${key}_${Date.now().toString(36).slice(-4)}`;
  const type = await db.eventType.create({
    data: { key, name: data.name, needsPartner: data.needsPartner, sortOrder: (max._max.sortOrder ?? -1) + 1 },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "config.event_type_created",
    entityType: "EventType",
    entityId: type.id,
    summary: `${actor.name} added event type "${type.name}"`,
    ipAddress: meta.ipAddress,
  });
  return type;
}

export async function updateEventType(
  db: PrismaClient,
  actor: Actor,
  id: string,
  patch: Partial<EventTypeInput> & { active?: boolean },
  meta: Meta = {},
) {
  const existing = await db.eventType.findUnique({ where: { id } });
  if (!existing) throw new ConfigError("Event type not found.");
  const data: Prisma.EventTypeUpdateInput = {};
  if (patch.name !== undefined) data.name = eventTypeInputSchema.shape.name.parse(patch.name);
  if (patch.needsPartner !== undefined) data.needsPartner = Boolean(patch.needsPartner);
  if (patch.active !== undefined) data.active = patch.active;
  const type = await db.eventType.update({ where: { id }, data });
  await writeAudit(db, {
    actorId: actor.id,
    action: "config.event_type_updated",
    entityType: "EventType",
    entityId: id,
    summary: `${actor.name} updated event type "${type.name}"`,
    ipAddress: meta.ipAddress,
  });
  return type;
}

export async function addSubtype(db: PrismaClient, actor: Actor, eventTypeId: string, name: string, meta: Meta = {}) {
  const clean = z.string().trim().min(2, "Enter a name.").max(80).parse(name);
  const max = await db.eventSubtype.aggregate({ where: { eventTypeId }, _max: { sortOrder: true } });
  try {
    const subtype = await db.eventSubtype.create({
      data: { eventTypeId, name: clean, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
    await writeAudit(db, {
      actorId: actor.id,
      action: "config.subtype_created",
      entityType: "EventSubtype",
      entityId: subtype.id,
      summary: `${actor.name} added subtype "${clean}"`,
      ipAddress: meta.ipAddress,
    });
    return subtype;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConfigError("This subtype already exists for this event type.");
    }
    throw err;
  }
}

export async function setSubtypeActive(db: PrismaClient, actor: Actor, id: string, active: boolean, meta: Meta = {}) {
  const subtype = await db.eventSubtype.update({ where: { id }, data: { active } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "config.subtype_updated",
    entityType: "EventSubtype",
    entityId: id,
    summary: `${actor.name} ${active ? "enabled" : "disabled"} subtype "${subtype.name}"`,
    ipAddress: meta.ipAddress,
  });
  return subtype;
}

// ─── Expense categories ──────────────────────────────────────────────────────

export const expenseCategorySchema = z.object({ name: z.string().trim().min(2, "Enter a name.").max(60) });

export async function listExpenseCategories(db: PrismaClient) {
  return db.expenseCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createExpenseCategory(db: PrismaClient, actor: Actor, name: string, meta: Meta = {}) {
  const clean = expenseCategorySchema.shape.name.parse(name);
  const max = await db.expenseCategory.aggregate({ _max: { sortOrder: true } });
  try {
    const category = await db.expenseCategory.create({
      data: { name: clean, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
    await writeAudit(db, {
      actorId: actor.id,
      action: "config.expense_category_created",
      entityType: "ExpenseCategory",
      entityId: category.id,
      summary: `${actor.name} added expense category "${clean}"`,
      ipAddress: meta.ipAddress,
    });
    return category;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConfigError("This expense category already exists.");
    }
    throw err;
  }
}

export async function setExpenseCategoryActive(
  db: PrismaClient,
  actor: Actor,
  id: string,
  active: boolean,
  meta: Meta = {},
) {
  const category = await db.expenseCategory.update({ where: { id }, data: { active } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "config.expense_category_updated",
    entityType: "ExpenseCategory",
    entityId: id,
    summary: `${actor.name} ${active ? "enabled" : "disabled"} expense category "${category.name}"`,
    ipAddress: meta.ipAddress,
  });
  return category;
}
