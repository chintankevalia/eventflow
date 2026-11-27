import "server-only";
import type { FormFieldSpec } from "@/components/events/dynamic-field";
import { db } from "@/server/db";
import { resolveFieldsWithOptions } from "@/server/events/fields";

/** Everything the template editor needs: event types, categories and the prefillable fields per type. */
export async function loadEditorData() {
  const [eventTypes, categories] = await Promise.all([
    db.eventType.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: {
        subtypes: { where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } },
      },
    }),
    db.expenseCategory.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const fieldsByType: Record<string, FormFieldSpec[]> = {};
  for (const type of eventTypes) {
    const { fields, options } = await resolveFieldsWithOptions(db, type.id, null);
    fieldsByType[type.id] = fields
      // Post-event results and system-filled fields are never part of a template.
      .filter((f) => f.visible && !f.system && f.section !== "POST_EVENT")
      .map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: false,
        help: f.help,
        options: options[f.key],
      }));
  }

  return {
    eventTypes: eventTypes.map((t) => ({ id: t.id, name: t.name, subtypes: t.subtypes })),
    categories,
    fieldsByType,
  };
}
