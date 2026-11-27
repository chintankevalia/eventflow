"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  FIELD_TYPES,
  FIELD_TYPE_LABEL,
  FORM_SECTIONS,
  SECTION_META,
  type FieldType,
  type FormSection,
} from "@/lib/form-schema";
import { cn } from "@/lib/utils";
import { addCustomFieldAction, toggleCustomFieldAction } from "./actions";

export type CustomFieldRow = {
  id: string;
  key: string;
  section: FormSection;
  label: string;
  type: FieldType;
  active: boolean;
};

export function CustomFieldsPanel({ fields }: { fields: CustomFieldRow[] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FieldType>("TEXT");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const needsOptions = type === "SELECT" || type === "MULTISELECT";

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Custom fields</CardTitle>
          <CardDescription>
            Extra fields beyond the built-in ones. They appear in the chosen section and can be set required or hidden
            per event type, like any other field.
          </CardDescription>
        </div>
        {!open && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setOpen(true)}>
            <Plus /> Add field
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {open && (
          <form
            className="space-y-4 rounded-md border border-border bg-background p-4"
            action={(formData) =>
              startTransition(async () => {
                const result = await addCustomFieldAction({
                  section: formData.get("section") as FormSection,
                  label: String(formData.get("label") ?? ""),
                  type: formData.get("type") as FieldType,
                  helpText: String(formData.get("helpText") ?? ""),
                  options: String(formData.get("options") ?? ""),
                });
                if (result.ok) {
                  setOpen(false);
                  setErrors({});
                  toast.success(result.message ?? "Added.");
                } else setErrors(result.fieldErrors ?? { label: result.message ?? "Could not add." });
              })
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="cf-label" label="Field label" required error={errors.label}>
                <Input name="label" maxLength={80} required autoFocus />
              </Field>
              <Field id="cf-section" label="Section" error={errors.section}>
                <Select name="section" defaultValue="BASIC_DETAILS">
                  {FORM_SECTIONS.map((s) => (
                    <option key={s} value={s}>
                      {SECTION_META[s].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="cf-type" label="Field type" error={errors.type}>
                <Select name="type" value={type} onChange={(e) => setType(e.target.value as FieldType)}>
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FIELD_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="cf-help" label="Help text" error={errors.helpText}>
                <Input name="helpText" maxLength={200} placeholder="Shown under the field" />
              </Field>
              {needsOptions && (
                <Field
                  id="cf-options"
                  label="Options"
                  required
                  error={errors.options}
                  hint="One per line."
                  className="sm:col-span-2"
                >
                  <textarea
                    id="cf-options"
                    name="options"
                    rows={4}
                    className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40"
                  />
                </Field>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setErrors({});
                }}
              >
                <X /> Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                Add field
              </Button>
            </div>
          </form>
        )}

        {fields.length === 0 && !open ? (
          <p className="py-2 text-sm text-muted-foreground">No custom fields yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {fields.map((field) => (
              <li
                key={field.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2",
                  !field.active && "opacity-60",
                )}
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <span className="truncate font-medium">{field.label}</span>
                  <Badge tone="neutral">{SECTION_META[field.section].label}</Badge>
                  <Badge tone="neutral">{FIELD_TYPE_LABEL[field.type]}</Badge>
                  {!field.active && <Badge tone="warning">Disabled</Badge>}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await toggleCustomFieldAction(field.id, !field.active);
                      if (!result.ok) toast.error(result.message ?? "Could not update.");
                    })
                  }
                >
                  {field.active ? "Disable" : "Enable"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
