"use client";

import { useOptimistic, useTransition } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FIELD_TYPE_LABEL, SECTION_META, type FieldType, type FormSection } from "@/lib/form-schema";
import { cn } from "@/lib/utils";
import { setFieldStateAction } from "./actions";

export type FieldState = "required" | "optional" | "hidden";
export type EditableField = {
  key: string;
  section: FormSection;
  label: string;
  type: FieldType;
  state: FieldState;
  custom: boolean;
  system: boolean;
  partnerOnly: boolean;
  help?: string;
  /** True when a tier is selected and this field has no tier-specific rule yet. */
  inherited?: boolean;
};

const OPTIONS: { value: FieldState; label: string }[] = [
  { value: "required", label: "Required" },
  { value: "optional", label: "Optional" },
  { value: "hidden", label: "Hidden" },
];

export function FieldRulesEditor({
  eventTypeId,
  tierValue,
  fields,
  sections,
}: {
  eventTypeId: string;
  tierValue: string;
  fields: EditableField[];
  sections: FormSection[];
}) {
  const [optimistic, apply] = useOptimistic(fields, (current, patch: { key: string; state: FieldState }) =>
    current.map((f) => (f.key === patch.key ? { ...f, state: patch.state, inherited: false } : f)),
  );
  const [, startTransition] = useTransition();

  const change = (key: string, state: FieldState) =>
    startTransition(async () => {
      apply({ key, state });
      const result = await setFieldStateAction({ eventTypeId, fieldKey: key, tierValue, state });
      if (!result.ok) toast.error(result.message ?? "Could not save.");
    });

  return (
    <div className="space-y-5">
      {sections.map((section) => {
        const sectionFields = optimistic.filter((f) => f.section === section);
        if (sectionFields.length === 0) return null;
        return (
          <Card key={section}>
            <CardHeader>
              <CardTitle>{SECTION_META[section].label}</CardTitle>
              <CardDescription>{SECTION_META[section].purpose}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {sectionFields.map((field) => (
                  <li
                    key={field.key}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{field.label}</span>
                        <Badge tone="neutral">{FIELD_TYPE_LABEL[field.type]}</Badge>
                        {field.custom && <Badge tone="info">Custom</Badge>}
                        {field.partnerOnly && <Badge tone="brand">Partner</Badge>}
                        {field.inherited && tierValue && <Badge tone="neutral">Inherited</Badge>}
                      </div>
                      {field.help && <p className="mt-0.5 text-xs text-muted-foreground">{field.help}</p>}
                    </div>
                    <div
                      role="radiogroup"
                      aria-label={`${field.label} requirement`}
                      className="flex shrink-0 rounded-md border border-border p-0.5"
                    >
                      {OPTIONS.map((option) => {
                        const disabled = field.system && option.value === "hidden";
                        const selected = field.state === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={disabled}
                            title={
                              disabled
                                ? "This field comes from elsewhere in the system and cannot be hidden."
                                : undefined
                            }
                            onClick={() => !selected && change(field.key, option.value)}
                            className={cn(
                              "flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                              selected
                                ? option.value === "required"
                                  ? "bg-primary-soft text-foreground"
                                  : option.value === "hidden"
                                    ? "bg-muted text-muted-foreground"
                                    : "bg-secondary text-foreground"
                                : "text-muted-foreground hover:text-foreground",
                              disabled && "cursor-not-allowed opacity-40",
                            )}
                          >
                            {disabled && <Lock className="size-3" aria-hidden />}
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
