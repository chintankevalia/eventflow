import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { FORM_SECTIONS, type FormSection } from "@/lib/form-schema";
import { cn } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { listEventTypes } from "@/server/config/event-types";
import { listCustomFields, resolveFields } from "@/server/config/form-fields";
import { listLookup } from "@/server/config/lookups";
import { db } from "@/server/db";
import { CustomFieldsPanel, type CustomFieldRow } from "./custom-fields-panel";
import { FieldRulesEditor, type EditableField } from "./field-rules-editor";

export const metadata: Metadata = { title: "Form fields" };

export default async function FormFieldsPage({
  searchParams,
}: {
  searchParams: Promise<{ eventType?: string; tier?: string }>;
}) {
  await requirePagePermission("config.manage");
  const { eventType: eventTypeParam, tier: tierParam } = await searchParams;

  const eventTypes = await listEventTypes(db);
  if (eventTypes.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Form fields" />
        <Card className="px-6 py-12 text-center">
          <p className="font-medium">No event types yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add event types in{" "}
            <Link href="/settings/config" className="text-primary hover:underline">
              Event configuration
            </Link>{" "}
            first.
          </p>
        </Card>
      </div>
    );
  }

  const selected = eventTypes.find((t) => t.id === eventTypeParam) ?? eventTypes[0];
  const tiers = selected.needsPartner ? (await listLookup(db, "PARTNER_TIER")).filter((t) => t.active) : [];
  const tierValue = tiers.some((t) => t.value === tierParam) ? tierParam! : "";

  const [resolved, customFields, tierRules] = await Promise.all([
    resolveFields(db, selected.id, tierValue || null),
    listCustomFields(db),
    tierValue ? db.fieldRule.findMany({ where: { eventTypeId: selected.id, tierValue } }) : Promise.resolve([]),
  ]);
  const tierRuleKeys = new Set(tierRules.map((r) => r.fieldKey));

  const fields: EditableField[] = resolved.map((f) => ({
    key: f.key,
    section: f.section,
    label: f.label,
    type: f.type,
    state: !f.visible ? "hidden" : f.required ? "required" : "optional",
    custom: f.custom,
    system: f.system,
    partnerOnly: f.partnerOnly,
    help: f.help,
    inherited: Boolean(tierValue) && !tierRuleKeys.has(f.key),
  }));

  const customRows: CustomFieldRow[] = customFields.map((f) => ({
    id: f.id,
    key: f.key,
    section: f.section as FormSection,
    label: f.label,
    type: f.type,
    active: f.active,
  }));

  const hrefFor = (typeId: string, tier: string) => {
    const params = new URLSearchParams({ eventType: typeId });
    if (tier) params.set("tier", tier);
    return `/settings/form-fields?${params}`;
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
        <Link href="/settings" className="hover:text-foreground">
          Settings
        </Link>{" "}
        / <span className="text-foreground">Form fields</span>
      </nav>
      <PageHeader
        title="Form fields"
        description="Decide which fields an event request shows, and which are mandatory, for each event type."
      />

      <div
        className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border"
        role="tablist"
        aria-label="Event type"
      >
        {eventTypes.map((type) => {
          const active = type.id === selected.id;
          return (
            <Link
              key={type.id}
              role="tab"
              aria-selected={active}
              href={hrefFor(type.id, "")}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-brand-coral text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {type.name}
            </Link>
          );
        })}
      </div>

      {selected.needsPartner && tiers.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Partner tier:</span>
          <Link
            href={hrefFor(selected.id, "")}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              tierValue === ""
                ? "border-brand-coral bg-primary-soft text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            All tiers
          </Link>
          {tiers.map((tier) => (
            <Link
              key={tier.id}
              href={hrefFor(selected.id, tier.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                tierValue === tier.value
                  ? "border-brand-coral bg-primary-soft text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {tier.label}
            </Link>
          ))}
        </div>
      )}

      {tierValue && (
        <p className="mb-4 flex gap-2 rounded-md bg-info-soft px-3 py-2.5 text-sm text-info">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Changes here apply only to <strong>{tiers.find((t) => t.value === tierValue)?.label}</strong> partners.
            Fields marked “Inherited” still follow the All&nbsp;tiers setting until you change them.
          </span>
        </p>
      )}

      <div className="space-y-6">
        <FieldRulesEditor
          key={`${selected.id}:${tierValue}`}
          eventTypeId={selected.id}
          tierValue={tierValue}
          fields={fields}
          sections={FORM_SECTIONS as unknown as FormSection[]}
        />
        <CustomFieldsPanel fields={customRows} />
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Repeating groups (cost lines, tasks, speakers), file uploads and calculated totals are built into the event form
        and are not listed here.
      </p>
    </div>
  );
}
