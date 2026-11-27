"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ORG_TYPE_META, type ORG_TYPES } from "@/server/organizations/service";
import type { FormState } from "./actions";
import { useActionToast } from "@/lib/use-action-toast";

type OrgType = (typeof ORG_TYPES)[number];
export type OrgFormValues = {
  type: OrgType;
  name: string;
  tierId: string | null;
  website: string | null;
  city: string | null;
  notes: string | null;
};

export function OrgForm({
  action,
  type,
  tiers,
  initial,
  mode,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  type: OrgType;
  tiers: { id: string; label: string }[];
  initial?: OrgFormValues;
  mode: "create" | "edit";
}) {
  const [state, formAction] = useActionState(action, {});
  const errors = state.fieldErrors ?? {};
  const meta = ORG_TYPE_META[type];

  useActionToast(state);

  return (
    <form action={formAction} noValidate className="space-y-6">
      <input type="hidden" name="type" value={type} />
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
      <Card className="p-5 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="name" label={`${meta.label} name`} required error={errors.name} className="sm:col-span-2">
            <Input name="name" defaultValue={initial?.name} maxLength={160} required autoFocus />
          </Field>
          {meta.hasTier && (
            <Field id="tierId" label="Tier" error={errors.tierId} hint="Drives tier-based form fields.">
              <Select name="tierId" defaultValue={initial?.tierId ?? ""}>
                <option value="">Not set</option>
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field id="city" label="City" error={errors.city}>
            <Input name="city" defaultValue={initial?.city ?? ""} maxLength={80} />
          </Field>
          <Field id="website" label="Website" error={errors.website} className={meta.hasTier ? "" : "sm:col-span-2"}>
            <Input name="website" defaultValue={initial?.website ?? ""} placeholder="example.com" maxLength={200} />
          </Field>
          <Field id="notes" label="Notes" error={errors.notes} className="sm:col-span-2">
            <textarea
              id="notes"
              name="notes"
              defaultValue={initial?.notes ?? ""}
              rows={3}
              maxLength={2000}
              className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40"
            />
          </Field>
        </div>
      </Card>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" asChild>
          <Link href={`/settings/master-data?type=${type}`}>Cancel</Link>
        </Button>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? `Add ${meta.label.toLowerCase()}` : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}
