import { Prisma, type OrganizationType, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { ConfigError, type Actor } from "@/server/config/lookups";

type Meta = { ipAddress?: string | null };

export const ORG_TYPES = ["CUSTOMER", "PARTNER", "DISTRIBUTOR"] as const satisfies readonly OrganizationType[];

export const ORG_TYPE_META: Record<OrganizationType, { label: string; plural: string; hasTier: boolean }> = {
  CUSTOMER: { label: "Customer", plural: "Customers", hasTier: false },
  PARTNER: { label: "Partner", plural: "Partners", hasTier: true },
  DISTRIBUTOR: { label: "Distributor", plural: "Distributors", hasTier: true },
};

export const organizationInputSchema = z.object({
  type: z.enum(ORG_TYPES),
  name: z.string().trim().min(2, "Enter the organization name.").max(160),
  tierId: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null),
  website: z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine((v) => !v || /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(v), "Enter a valid website.")
    .transform((v) => v || null),
  city: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => v || null),
});
export type OrganizationInput = z.input<typeof organizationInputSchema>;

export const contactInputSchema = z.object({
  name: z.string().trim().min(2, "Enter the contact's name.").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email.")
    .max(254)
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => v || null),
  jobTitle: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => v || null),
  isPrimary: z.coerce.boolean().optional().default(false),
});
export type ContactInput = z.input<typeof contactInputSchema>;

async function validateTier(db: PrismaClient, type: OrganizationType, tierId: string | null) {
  if (!tierId) return null;
  if (!ORG_TYPE_META[type].hasTier) return null; // customers have no tier
  const tier = await db.lookupItem.findFirst({ where: { id: tierId, kind: "PARTNER_TIER" } });
  if (!tier) throw new ConfigError("Choose a valid tier.", "tierId");
  return tier.id;
}

export async function createOrganization(db: PrismaClient, actor: Actor, input: OrganizationInput, meta: Meta = {}) {
  const data = organizationInputSchema.parse(input);
  const tierId = await validateTier(db, data.type, data.tierId);
  const org = await db.organization.create({ data: { ...data, tierId, createdById: actor.id } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "org.created",
    entityType: "Organization",
    entityId: org.id,
    summary: `${actor.name} added ${ORG_TYPE_META[org.type].label.toLowerCase()} "${org.name}"`,
    ipAddress: meta.ipAddress,
  });
  return org;
}

export async function updateOrganization(
  db: PrismaClient,
  actor: Actor,
  id: string,
  input: OrganizationInput,
  meta: Meta = {},
) {
  const data = organizationInputSchema.parse(input);
  const existing = await db.organization.findUnique({ where: { id } });
  if (!existing) throw new ConfigError("Organization not found.");
  const tierId = await validateTier(db, data.type, data.tierId);
  const org = await db.organization.update({ where: { id }, data: { ...data, tierId } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "org.updated",
    entityType: "Organization",
    entityId: id,
    summary: `${actor.name} updated "${org.name}"`,
    ipAddress: meta.ipAddress,
  });
  return org;
}

export async function setOrganizationStatus(
  db: PrismaClient,
  actor: Actor,
  id: string,
  status: "ACTIVE" | "ARCHIVED",
  meta: Meta = {},
) {
  const org = await db.organization.update({ where: { id }, data: { status } });
  await writeAudit(db, {
    actorId: actor.id,
    action: status === "ARCHIVED" ? "org.archived" : "org.restored",
    entityType: "Organization",
    entityId: id,
    summary: `${actor.name} ${status === "ARCHIVED" ? "archived" : "restored"} "${org.name}"`,
    ipAddress: meta.ipAddress,
  });
  return org;
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export async function addContact(
  db: PrismaClient,
  actor: Actor,
  organizationId: string,
  input: ContactInput,
  meta: Meta = {},
) {
  const data = contactInputSchema.parse(input);
  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new ConfigError("Organization not found.");
  const contact = await db.$transaction(async (tx) => {
    if (data.isPrimary) await tx.contact.updateMany({ where: { organizationId }, data: { isPrimary: false } });
    return tx.contact.create({ data: { ...data, organizationId } });
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "contact.created",
    entityType: "Contact",
    entityId: contact.id,
    summary: `${actor.name} added contact "${contact.name}" to "${org.name}"`,
    ipAddress: meta.ipAddress,
  });
  return contact;
}

export async function updateContact(db: PrismaClient, actor: Actor, id: string, input: ContactInput, meta: Meta = {}) {
  const data = contactInputSchema.parse(input);
  const existing = await db.contact.findUnique({ where: { id } });
  if (!existing) throw new ConfigError("Contact not found.");
  const contact = await db.$transaction(async (tx) => {
    if (data.isPrimary) {
      await tx.contact.updateMany({
        where: { organizationId: existing.organizationId, id: { not: id } },
        data: { isPrimary: false },
      });
    }
    return tx.contact.update({ where: { id }, data });
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "contact.updated",
    entityType: "Contact",
    entityId: id,
    summary: `${actor.name} updated contact "${contact.name}"`,
    ipAddress: meta.ipAddress,
  });
  return contact;
}

export async function removeContact(db: PrismaClient, actor: Actor, id: string, meta: Meta = {}) {
  const contact = await db.contact.findUnique({ where: { id }, include: { organization: true } });
  if (!contact) return;
  await db.contact.delete({ where: { id } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "contact.deleted",
    entityType: "Contact",
    entityId: id,
    summary: `${actor.name} removed contact "${contact.name}" from "${contact.organization.name}"`,
    ipAddress: meta.ipAddress,
  });
}

// ─── Queries ────────────────────────────────────────────────────────────────

export const orgListFiltersSchema = z.object({
  type: z.enum(ORG_TYPES).catch("CUSTOMER"),
  q: z.string().trim().max(100).optional().catch(undefined),
  tierId: z.string().trim().optional().catch(undefined),
  status: z.enum(["ACTIVE", "ARCHIVED"]).catch("ACTIVE"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type OrgListFilters = z.infer<typeof orgListFiltersSchema>;
export const ORGS_PAGE_SIZE = 20;

export async function listOrganizations(db: PrismaClient, filters: OrgListFilters) {
  const where: Prisma.OrganizationWhereInput = {
    type: filters.type,
    status: filters.status,
    ...(filters.tierId ? { tierId: filters.tierId } : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" } },
            { city: { contains: filters.q, mode: "insensitive" } },
            { contacts: { some: { name: { contains: filters.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const [total, organizations, typeCounts] = await Promise.all([
    db.organization.count({ where }),
    db.organization.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (filters.page - 1) * ORGS_PAGE_SIZE,
      take: ORGS_PAGE_SIZE,
      include: { tier: true, _count: { select: { contacts: { where: { status: "ACTIVE" } } } } },
    }),
    db.organization.groupBy({ by: ["type"], where: { status: "ACTIVE" }, _count: true }),
  ]);
  const counts = Object.fromEntries(typeCounts.map((c) => [c.type, c._count])) as Partial<
    Record<OrganizationType, number>
  >;
  return { total, organizations, counts, pageCount: Math.max(1, Math.ceil(total / ORGS_PAGE_SIZE)) };
}

export async function getOrganization(db: PrismaClient, id: string) {
  return db.organization.findUnique({
    where: { id },
    include: {
      tier: true,
      createdBy: { select: { name: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
    },
  });
}
