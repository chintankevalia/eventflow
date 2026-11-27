import { Prisma, type LookupKind, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { writeAudit } from "@/server/audit";

/** Admin-managed lookup lists (partner tiers, regions, industries, …) used across the event form. */

export const LOOKUP_KINDS = [
  "PARTNER_TIER",
  "COLLABORATION_MODEL",
  "REGION",
  "INDUSTRY",
  "PRODUCT_FOCUS",
  "EVENT_FORMAT",
] as const satisfies readonly LookupKind[];

export const LOOKUP_META: Record<LookupKind, { label: string; description: string }> = {
  PARTNER_TIER: {
    label: "Partner tiers",
    description: "Ranking for partners and distributors (e.g. Gold, Silver). Can drive form fields.",
  },
  COLLABORATION_MODEL: {
    label: "Collaboration models",
    description: "How the event is run with customers or partners.",
  },
  REGION: { label: "Regions", description: "Geographic regions for events." },
  INDUSTRY: { label: "Industries", description: "Target industry of the audience." },
  PRODUCT_FOCUS: { label: "Product focus", description: "ObserveOps, ServiceOps, or both." },
  EVENT_FORMAT: { label: "Event formats", description: "Physical, virtual or hybrid." },
};

export class ConfigError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export type Actor = { id: string; name: string };
type Meta = { ipAddress?: string | null };

const slugify = (label: string) =>
  label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50) || "item";

export const lookupInputSchema = z.object({
  label: z.string().trim().min(1, "Enter a label.").max(80),
  value: z
    .string()
    .trim()
    .max(50)
    .regex(/^[a-z0-9_]*$/i, "Use letters, numbers and underscores only.")
    .optional(),
});
export type LookupInput = z.infer<typeof lookupInputSchema>;

export async function listLookup(db: PrismaClient, kind: LookupKind) {
  return db.lookupItem.findMany({ where: { kind }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
}

export async function createLookupItem(
  db: PrismaClient,
  actor: Actor,
  kind: LookupKind,
  input: LookupInput,
  meta: Meta = {},
) {
  const data = lookupInputSchema.parse(input);
  const value = (data.value || slugify(data.label)).toLowerCase();
  const max = await db.lookupItem.aggregate({ where: { kind }, _max: { sortOrder: true } });
  try {
    const item = await db.lookupItem.create({
      data: { kind, value, label: data.label, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
    await writeAudit(db, {
      actorId: actor.id,
      action: "config.lookup_created",
      entityType: "LookupItem",
      entityId: item.id,
      summary: `${actor.name} added "${item.label}" to ${LOOKUP_META[kind].label}`,
      ipAddress: meta.ipAddress,
    });
    return item;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConfigError("An item with this value already exists in this list.", "value");
    }
    throw err;
  }
}

export async function updateLookupItem(
  db: PrismaClient,
  actor: Actor,
  id: string,
  patch: { label?: string; active?: boolean },
  meta: Meta = {},
) {
  const existing = await db.lookupItem.findUnique({ where: { id } });
  if (!existing) throw new ConfigError("Item not found.");
  const data: Prisma.LookupItemUpdateInput = {};
  if (patch.label !== undefined) data.label = lookupInputSchema.shape.label.parse(patch.label);
  if (patch.active !== undefined) data.active = patch.active;
  const item = await db.lookupItem.update({ where: { id }, data });
  await writeAudit(db, {
    actorId: actor.id,
    action: "config.lookup_updated",
    entityType: "LookupItem",
    entityId: id,
    summary: `${actor.name} updated "${item.label}" in ${LOOKUP_META[existing.kind].label}`,
    ipAddress: meta.ipAddress,
  });
  return item;
}

export async function reorderLookup(db: PrismaClient, kind: LookupKind, orderedIds: string[]) {
  await db.$transaction(
    orderedIds.map((id, index) => db.lookupItem.update({ where: { id }, data: { sortOrder: index } })),
  );
}
