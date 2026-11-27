"use client";

import { startNavigation } from "@/components/layout/navigation-progress";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import { formatDate, formatINR } from "@/lib/format";
import { useActionToast } from "@/lib/use-action-toast";
import type { FormState } from "@/app/(portal)/events/actions";
import { DynamicField, type FormFieldSpec } from "./dynamic-field";

/** Renders the configurable fields of one form section and saves them together. */
export function SectionForm({
  title,
  description,
  fields,
  values,
  action,
  readOnly,
  readOnlyNote,
  next,
}: {
  title: string;
  description?: string;
  fields: FormFieldSpec[];
  values: Record<string, unknown>;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  readOnly?: boolean;
  readOnlyNote?: string;
  /** The following section. When set, the form offers "Save & continue". */
  next?: { href: string; label: string };
}) {
  const router = useRouter();
  // React resets a form once its action finishes, which would snap every control back to the
  // defaults of the first render. Counting results and keying the form on that count remounts it,
  // so the inputs re-read the values the server just saved.
  // Which button submitted travels in the form data (React includes the submitter). Moving on is
  // decided only after the save, and only if it succeeded — a failed save keeps you on the page
  // with its errors rather than losing them behind a navigation.
  const [state, formAction] = useActionState<FormState & { seq?: number; advance?: boolean }, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData);
      const ok = !result.error && !result.fieldErrors;
      return { ...result, seq: (prev.seq ?? 0) + 1, advance: ok && formData.get("__intent") === "next" };
    },
    {},
  );

  useEffect(() => {
    if (state.advance && next) {
      startNavigation();
      router.push(next.href);
    }
  }, [state, next, router]);

  useActionToast(state);

  if (fields.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No fields are switched on for this section. An administrator can change that in Settings → Form fields.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {readOnly ? (
          <>
            {readOnlyNote && (
              <div className="mb-4">
                <FormAlert tone="info">{readOnlyNote}</FormAlert>
              </div>
            )}
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {fields.map((field) => (
                <div key={field.key}>
                  <dt className="text-xs text-muted-foreground">{field.label}</dt>
                  <dd className="mt-0.5 text-sm">{displayValue(field, values[field.key])}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <form key={state.seq ?? 0} action={formAction} noValidate className="space-y-5">
            <input type="hidden" name="__fields" value={fields.map((f) => f.key).join(",")} />
            {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
            <div className="grid gap-5 sm:grid-cols-2">
              {fields.map((field) => (
                <DynamicField
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  error={state.fieldErrors?.[field.key]}
                />
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <SubmitButton variant={next ? "outline" : "default"} pendingLabel="Saving…">
                Save
              </SubmitButton>
              {next && (
                <SubmitButton name="__intent" value="next" pendingLabel="Saving…">
                  Save &amp; continue to {next.label} →
                </SubmitButton>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function displayValue(field: FormFieldSpec, value: unknown) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
  if (field.type === "CHECKBOX") return value ? "Yes" : "No";
  if (field.type === "SELECT") return field.options?.find((o) => o.value === value)?.label ?? String(value);
  if (field.type === "MULTISELECT" && Array.isArray(value)) {
    return value.map((v) => field.options?.find((o) => o.value === v)?.label ?? v).join(", ") || "—";
  }
  if (field.type === "DATE") return formatDate(String(value));
  if (field.type === "CURRENCY" && typeof value === "number") return formatINR(value);
  return String(value);
}
