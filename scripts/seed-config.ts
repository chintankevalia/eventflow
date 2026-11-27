/**
 * Seeds EventFlow's default configuration: event types, lookup lists, expense categories and
 * default form-field rules. Idempotent — safe to run on an existing install (it only adds what's missing).
 *
 *   npm run config:seed
 *
 * Event types, subtypes and regions are the ones the channel marketing team runs, taken from their
 * master sheet. Tiers, industries and collaboration models are still placeholders pending the
 * business; an admin edits them in Settings. Formats and product focus come straight from the PRD.
 */
import { PrismaClient, type FieldType, type FormSection, type LookupKind } from "@prisma/client";
import { BUILTIN_FIELDS } from "../src/lib/form-schema";
import { LEGACY_REGION_VALUES, REGIONS } from "../src/server/import/regions";

const db = new PrismaClient();

/**
 * The event types the channel marketing team actually runs, named as they name them.
 * `key` never changes, so field rules and existing events survive a rename. `seededName` is the
 * name an earlier version of this script wrote: a type is renamed only while it still carries
 * that name, so an administrator's own wording is never overwritten.
 */
const EVENT_TYPES = [
  { key: "customer", name: "Customer event", needsPartner: false, seededName: "Customer" },
  { key: "partner_meet", name: "Partner event", needsPartner: true, seededName: "Partner meet" },
  {
    key: "end_customer_with_partner",
    name: "Partner-led customer event",
    needsPartner: true,
    seededName: "End customer with partner",
  },
  { key: "distributor", name: "Distributor-led customer event", needsPartner: true, seededName: "Distributor" },
  { key: "distributor_partner", name: "Distributor-led partner event", needsPartner: true },
  // The channel marketing team's master sheet also tracks three activity classes that are not
  // "events" in the PRD's sense — no budget workflow, no approval — but the team still wants
  // every one of them recorded in one place, so they come in as event types of their own rather
  // than being left out or forced to fit the request/approval flow that events go through.
  { key: "blitz", name: "Blitz activity", needsPartner: false },
  { key: "webinar", name: "Webinar", needsPartner: false },
  { key: "weekly_pulse", name: "Weekly pulse", needsPartner: false },
];

/**
 * Every subtype is offered under every event type. The team asked for this: a customer event can
 * be an awards night as easily as a partner one, and a per-type list kept hiding valid choices.
 */
const ALL_SUBTYPES = [
  "Round table event",
  "Exhibitor event",
  "Awards",
  "Offsite event",
  "Bootcamp",
  "Technical session",
];
// The three activity classes (blitz, webinar, weekly pulse) get no subtypes — "exhibitor",
// "bootcamp" and the rest describe a physical gathering, which none of them are.
const ACTIVITY_TYPE_KEYS = new Set(["blitz", "webinar", "weekly_pulse"]);
const SUBTYPES: Record<string, string[]> = Object.fromEntries(
  EVENT_TYPES.filter((t) => !ACTIVITY_TYPE_KEYS.has(t.key)).map((t) => [t.key, ALL_SUBTYPES]),
);

/**
 * Regions the portal used before the team's nine (see src/server/import/regions.ts): the original
 * compass-point placeholders, and the first confirmed list of four, three of which each cover
 * several of the nine. Retired rather than deleted, and only once no event still refers to them —
 * `npm run regions:remap` moves events onto the new values first.
 */
const RETIRED_REGIONS = LEGACY_REGION_VALUES;

/** Fields the channel marketing sheet records that the built-in form has no home for. */
const CUSTOM_FIELDS: { key: string; section: FormSection; label: string; type: FieldType; helpText: string }[] = [
  {
    key: "custom.participants",
    section: "PLANNING",
    label: "Internal participants",
    type: "TEXTAREA",
    helpText: "Motadata people attending or running the event.",
  },
];

const LOOKUPS: Record<LookupKind, { value: string; label: string }[]> = {
  EVENT_FORMAT: [
    { value: "physical", label: "Physical" },
    { value: "virtual", label: "Virtual" },
    { value: "hybrid", label: "Hybrid" },
  ],
  PRODUCT_FOCUS: [
    { value: "observeops", label: "ObserveOps" },
    { value: "serviceops", label: "ServiceOps" },
    { value: "both", label: "Both" },
  ],
  // Placeholders below — confirm with the business, then edit in Settings.
  PARTNER_TIER: [
    { value: "gold", label: "Gold" },
    { value: "silver", label: "Silver" },
    { value: "bronze", label: "Bronze" },
  ],
  COLLABORATION_MODEL: [
    { value: "motadata_led", label: "Motadata-led" },
    { value: "partner_led", label: "Partner-led" },
    { value: "joint", label: "Joint" },
  ],
  // Confirmed 27-Oct-2026: the nine regions the team reports against.
  REGION: REGIONS,
  INDUSTRY: [
    { value: "bfsi", label: "BFSI" },
    { value: "it_ites", label: "IT / ITeS" },
    { value: "manufacturing", label: "Manufacturing" },
    { value: "government", label: "Government" },
    { value: "healthcare", label: "Healthcare" },
    { value: "other", label: "Other" },
    // Events aimed at several industries tick this instead of every box, or alongside a few.
    { value: "cross_industry", label: "Cross-industry (all)" },
  ],
};

const EXPENSE_CATEGORIES = ["Venue", "Food & Beverage", "Travel", "Branding", "Sponsorship", "Logistics", "Other"];

async function main() {
  // Event types
  let renamed = 0;
  for (const [index, t] of EVENT_TYPES.entries()) {
    const existing = await db.eventType.findUnique({ where: { key: t.key } });
    if (!existing) {
      await db.eventType.create({
        data: { key: t.key, name: t.name, needsPartner: t.needsPartner, sortOrder: index },
      });
      continue;
    }
    if (t.seededName && existing.name === t.seededName) {
      await db.eventType.update({ where: { key: t.key }, data: { name: t.name, sortOrder: index } });
      renamed++;
    }
  }

  // Subtypes
  const typeIdByKey = new Map((await db.eventType.findMany()).map((t) => [t.key, t.id]));
  let subtypeCount = 0;
  for (const [key, names] of Object.entries(SUBTYPES)) {
    const eventTypeId = typeIdByKey.get(key);
    if (!eventTypeId) continue;
    for (const [index, name] of names.entries()) {
      await db.eventSubtype.upsert({
        where: { eventTypeId_name: { eventTypeId, name } },
        update: {},
        create: { eventTypeId, name, sortOrder: index },
      });
      subtypeCount++;
    }
  }

  // Lookups
  for (const [kind, items] of Object.entries(LOOKUPS) as [LookupKind, { value: string; label: string }[]][]) {
    for (const [index, item] of items.entries()) {
      await db.lookupItem.upsert({
        where: { kind_value: { kind, value: item.value } },
        // Regions are the one list whose order and wording are fixed by the business, so they are
        // re-asserted on every run; every other list keeps whatever an administrator has done to it.
        update: kind === "REGION" ? { label: item.label, sortOrder: index, active: true } : {},
        create: { kind, value: item.value, label: item.label, sortOrder: index },
      });
    }
  }

  // Retire the placeholder regions, but never one an event still uses.
  const regionsKept: string[] = [];
  for (const value of RETIRED_REGIONS) {
    const inUse = await db.event.count({ where: { region: value } });
    if (inUse > 0) {
      regionsKept.push(`${value} (${inUse} event${inUse === 1 ? "" : "s"})`);
      continue;
    }
    await db.lookupItem.updateMany({ where: { kind: "REGION", value }, data: { active: false } });
  }

  // Venue became a built-in field (Basic Details); drop the custom field that used to carry it, or
  // the form would show it twice. Existing answers are stored under the same key and are untouched.
  await db.formField.deleteMany({ where: { key: "custom.venue" } });

  // Custom fields
  for (const [index, field] of CUSTOM_FIELDS.entries()) {
    await db.formField.upsert({
      where: { key: field.key },
      update: {},
      create: { ...field, sortOrder: index },
    });
  }

  // Expense categories
  for (const [index, name] of EXPENSE_CATEGORIES.entries()) {
    await db.expenseCategory.upsert({ where: { name }, update: {}, create: { name, sortOrder: index } });
  }

  // Default field rules: apply each built-in field's default required state to every event type (any tier).
  const types = await db.eventType.findMany();
  let ruleCount = 0;
  for (const type of types) {
    for (const field of BUILTIN_FIELDS) {
      if (field.partnerOnly && !type.needsPartner) continue;
      await db.fieldRule.upsert({
        where: { eventTypeId_fieldKey_tierValue: { eventTypeId: type.id, fieldKey: field.key, tierValue: "" } },
        update: {},
        create: {
          eventTypeId: type.id,
          fieldKey: field.key,
          tierValue: "",
          required: Boolean(field.defaultRequired),
          visible: true,
        },
      });
      ruleCount++;
    }
  }

  // Approval workflow: Channel reviews first, then Akshay and Mitul together, then the CEO's
  // budget approval. `update: {}` means this only ever *creates* a missing stage — an
  // administrator's rename or re-ordering is never overwritten. A database seeded before this
  // three-stage flow existed needs scripts/migrate-approval-stages.ts run once first, which
  // renumbers the old two stages in place so this upsert then only has the new stage 1 to add.
  let workflow = await db.approvalWorkflow.findFirst({ where: { active: true } });
  if (!workflow) {
    workflow = await db.approvalWorkflow.create({ data: { name: "Standard event approval" } });
  }
  for (const stage of [
    { sequence: 1, name: "Channel review", mode: "ANY" as const, reminderHours: 24, escalationHours: 48 },
    { sequence: 2, name: "Event approval", mode: "ALL" as const, reminderHours: 24, escalationHours: 48 },
    { sequence: 3, name: "Budget approval", mode: "ALL" as const, reminderHours: 24, escalationHours: 48 },
  ]) {
    await db.approvalStage.upsert({
      where: { workflowId_sequence: { workflowId: workflow.id, sequence: stage.sequence } },
      update: {},
      create: { ...stage, workflowId: workflow.id },
    });
  }

  console.log(
    `Config seeded: ${EVENT_TYPES.length} event types (${renamed} renamed), ${subtypeCount} subtypes, ` +
      `${Object.values(LOOKUPS).flat().length} lookup items, ${CUSTOM_FIELDS.length} custom fields, ` +
      `${EXPENSE_CATEGORIES.length} expense categories, ${ruleCount} field rules, 3 approval stages.`,
  );
  if (regionsKept.length) {
    console.log(`\n⚠ Kept the old region(s) ${regionsKept.join(", ")} — events still refer to them.`);
  }
  const unassigned = await db.approvalStage.count({ where: { workflowId: workflow.id, approvers: { none: {} } } });
  if (unassigned > 0) {
    console.log(
      `\n⚠ ${unassigned} approval stage(s) have no approvers yet — assign them in Settings → Approval workflow.`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
