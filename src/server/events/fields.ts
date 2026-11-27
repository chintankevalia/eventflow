import type { PrismaClient } from "@prisma/client";
import { resolveFields, type ResolvedField } from "@/server/config/form-fields";
import type { OptionSets } from "./answers";

/**
 * The fields an event form should show, together with the choices for every dropdown
 * (managed lookup lists for built-in fields, stored options for custom ones).
 */
export async function resolveFieldsWithOptions(
  db: PrismaClient,
  eventTypeId: string,
  partnerTier: string | null,
): Promise<{ fields: ResolvedField[]; options: OptionSets }> {
  const fields = await resolveFields(db, eventTypeId, partnerTier);

  const lookupKinds = [...new Set(fields.map((f) => f.lookup).filter(Boolean))] as string[];
  const [lookupItems, customFields] = await Promise.all([
    lookupKinds.length
      ? db.lookupItem.findMany({
          where: { kind: { in: lookupKinds as never[] }, active: true },
          orderBy: [{ sortOrder: "asc" }],
        })
      : Promise.resolve([]),
    db.formField.findMany({ where: { active: true, type: { in: ["SELECT", "MULTISELECT"] } } }),
  ]);

  const options: OptionSets = {};
  for (const field of fields) {
    if (field.lookup) {
      options[field.key] = lookupItems
        .filter((i) => i.kind === field.lookup)
        .map((i) => ({ value: i.value, label: i.label }));
    } else if (field.custom) {
      const stored = customFields.find((f) => f.key === field.key)?.options;
      if (Array.isArray(stored)) options[field.key] = stored as { value: string; label: string }[];
    }
  }
  return { fields, options };
}
