import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  BUILTIN_BY_KEY,
  BUILTIN_FIELDS,
  FIELD_TYPES,
  FORM_SECTIONS,
  type FieldType,
  type FormSection,
} from "@/lib/form-schema";
import { writeAudit } from "@/server/audit";
import { ConfigError, type Actor } from "./lookups";

type Meta = { ipAddress?: string | null };

/** A field as it appears in the form for a given event type + tier, after rules are applied. */
export type ResolvedField = {
  key: string;
  section: FormSection;
  label: string;
  type: FieldType;
  required: boolean;
  visible: boolean;
  custom: boolean;
  system: boolean;
  partnerOnly: boolean;
  lookup?: string;
  help?: string;
};

/**
 * Effective fields for an event type (and optional partner tier), used by the event form in Phase 3.
 * Precedence: a rule matching the tier wins over the "any tier" rule, which wins over the built-in default.
 */
export async function resolveFields(
  db: PrismaClient,
  eventTypeId: string,
  tierValue: string | null,
): Promise<ResolvedField[]> {
  const [eventType, customFields, rules] = await Promise.all([
    db.eventType.findUnique({ where: { id: eventTypeId } }),
    db.formField.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }] }),
    db.fieldRule.findMany({ where: { eventTypeId } }),
  ]);
  if (!eventType) throw new ConfigError("Event type not found.");

  const ruleFor = (key: string) => {
    const tierRule = tierValue ? rules.find((r) => r.fieldKey === key && r.tierValue === tierValue) : undefined;
    return tierRule ?? rules.find((r) => r.fieldKey === key && r.tierValue === "");
  };

  const out: ResolvedField[] = [];
  for (const f of BUILTIN_FIELDS) {
    if (f.partnerOnly && !eventType.needsPartner) continue;
    const rule = ruleFor(f.key);
    out.push({
      key: f.key,
      section: f.section,
      label: f.label,
      type: f.type,
      required: rule?.required ?? Boolean(f.defaultRequired),
      visible: rule?.visible ?? true,
      custom: false,
      system: Boolean(f.system),
      partnerOnly: Boolean(f.partnerOnly),
      lookup: f.lookup,
      help: f.help,
    });
  }
  for (const f of customFields) {
    const rule = ruleFor(f.key);
    out.push({
      key: f.key,
      section: f.section as FormSection,
      label: f.label,
      type: f.type as FieldType,
      required: rule?.required ?? false,
      visible: rule?.visible ?? true,
      custom: true,
      system: false,
      partnerOnly: false,
      help: f.helpText ?? undefined,
    });
  }
  return out;
}

const ruleSchema = z.object({
  eventTypeId: z.string().min(1),
  fieldKey: z.string().min(1),
  tierValue: z.string().default(""),
  required: z.boolean(),
  visible: z.boolean(),
});
export type RuleInput = z.infer<typeof ruleSchema>;

/** Upsert the required/visible rule for one field, event type and tier. */
export async function setFieldRule(db: PrismaClient, actor: Actor, input: RuleInput, meta: Meta = {}) {
  const data = ruleSchema.parse(input);
  const builtin = BUILTIN_BY_KEY[data.fieldKey];
  // A required field must stay visible, and a system field's requirement can change but not its visibility.
  const visible = builtin?.system ? true : data.visible;
  const required = visible ? data.required : false;

  await db.fieldRule.upsert({
    where: {
      eventTypeId_fieldKey_tierValue: {
        eventTypeId: data.eventTypeId,
        fieldKey: data.fieldKey,
        tierValue: data.tierValue,
      },
    },
    create: { ...data, required, visible },
    update: { required, visible },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "config.field_rule_set",
    entityType: "FieldRule",
    entityId: `${data.eventTypeId}:${data.fieldKey}:${data.tierValue || "any"}`,
    summary: `${actor.name} set "${builtin?.label ?? data.fieldKey}" to ${required ? "required" : visible ? "optional" : "hidden"}${data.tierValue ? ` (tier ${data.tierValue})` : ""}`,
    ipAddress: meta.ipAddress,
  });
}

// ─── Custom fields ───────────────────────────────────────────────────────────

export const customFieldSchema = z.object({
  section: z.enum(FORM_SECTIONS),
  label: z.string().trim().min(2, "Enter a label.").max(80),
  type: z.enum(FIELD_TYPES),
  helpText: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),
  options: z
    .string()
    .trim()
    .optional()
    .transform((v) =>
      v
        ? v
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((label) => ({
              value: label
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_+|_+$/g, ""),
              label,
            }))
        : [],
    ),
});
export type CustomFieldInput = z.input<typeof customFieldSchema>;

export async function listCustomFields(db: PrismaClient) {
  return db.formField.findMany({ orderBy: [{ section: "asc" }, { sortOrder: "asc" }] });
}

export async function createCustomField(db: PrismaClient, actor: Actor, input: CustomFieldInput, meta: Meta = {}) {
  const data = customFieldSchema.parse(input);
  if ((data.type === "SELECT" || data.type === "MULTISELECT") && data.options.length === 0) {
    throw new ConfigError("Add at least one option for a dropdown field.", "options");
  }
  const base =
    data.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field";
  let key = `custom.${base}`;
  if (await db.formField.findUnique({ where: { key } })) key = `${key}_${Date.now().toString(36).slice(-4)}`;
  const max = await db.formField.aggregate({ where: { section: data.section }, _max: { sortOrder: true } });

  const field = await db.formField.create({
    data: {
      section: data.section,
      key,
      label: data.label,
      type: data.type,
      helpText: data.helpText,
      options: data.options.length ? data.options : Prisma.JsonNull,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
  await writeAudit(db, {
    actorId: actor.id,
    action: "config.custom_field_created",
    entityType: "FormField",
    entityId: field.id,
    summary: `${actor.name} added custom field "${field.label}"`,
    ipAddress: meta.ipAddress,
  });
  return field;
}

export async function setCustomFieldActive(
  db: PrismaClient,
  actor: Actor,
  id: string,
  active: boolean,
  meta: Meta = {},
) {
  const field = await db.formField.update({ where: { id }, data: { active } });
  await writeAudit(db, {
    actorId: actor.id,
    action: "config.custom_field_updated",
    entityType: "FormField",
    entityId: id,
    summary: `${actor.name} ${active ? "enabled" : "disabled"} custom field "${field.label}"`,
    ipAddress: meta.ipAddress,
  });
  return field;
}
