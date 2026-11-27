"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DEPARTMENTS, DEPARTMENT_LABEL, ROLES, ROLE_META, type Department, type Role } from "@/lib/permissions";
import { useActionToast } from "@/lib/use-action-toast";
import type { UserFormState } from "./actions";

export type UserFormValues = {
  name: string;
  email: string;
  jobTitle: string | null;
  phone: string | null;
  department: Department | null;
  roles: Role[];
};

export function UserForm({
  action,
  initial,
  mode,
  lockAdminRole = false,
}: {
  action: (state: UserFormState, formData: FormData) => Promise<UserFormState>;
  initial?: UserFormValues;
  mode: "create" | "edit";
  /** Admins editing themselves cannot remove their own Administrator role. */
  lockAdminRole?: boolean;
}) {
  // Each result gets a sequence number; the form remounts with it so every field (including selects,
  // which React does not restore on reset) shows the values that were submitted.
  const [state, formAction] = useActionState<UserFormState & { seq?: number }, FormData>(
    async (prev, formData) => ({ ...(await action(prev, formData)), seq: (prev.seq ?? 0) + 1 }),
    {},
  );
  const errors = state.fieldErrors ?? {};
  const v = state.values ?? initial;

  useActionToast(state);

  return (
    <form key={state.seq ?? 0} action={formAction} noValidate className="space-y-6">
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}

      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-semibold">Profile</h2>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field id="name" label="Full name" required error={errors.name}>
            <Input name="name" defaultValue={v?.name} autoComplete="off" maxLength={120} required />
          </Field>
          <Field
            id="email"
            label="Work email"
            required
            error={errors.email}
            hint={mode === "create" ? "The invite is sent to this address." : "Changing it signs the user out."}
          >
            <Input name="email" type="email" defaultValue={v?.email} autoComplete="off" maxLength={254} required />
          </Field>
          <Field id="jobTitle" label="Job title" error={errors.jobTitle}>
            <Input name="jobTitle" defaultValue={v?.jobTitle ?? ""} maxLength={120} />
          </Field>
          <Field id="phone" label="Phone" error={errors.phone}>
            <Input name="phone" type="tel" defaultValue={v?.phone ?? ""} maxLength={30} />
          </Field>
          <Field
            id="department"
            label="Department"
            required
            error={errors.department}
            hint="Decides which events this person can see, not what they can do."
          >
            <Select name="department" defaultValue={v?.department ?? ""} required>
              <option value="" disabled>
                Choose a department
              </option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {DEPARTMENT_LABEL[d]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <fieldset aria-describedby={errors.roles ? "roles-error" : undefined}>
          <legend className="text-base font-semibold">Roles</legend>
          <p className="mt-1 text-sm text-muted-foreground">A user can have several roles. Choose at least one.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {ROLES.map((role) => {
              const locked = lockAdminRole && role === "ADMIN";
              return (
                <label
                  key={role}
                  className="flex cursor-pointer gap-3 rounded-md border border-border p-3 transition-colors hover:bg-accent has-[:checked]:border-primary/60 has-[:checked]:bg-primary-soft/50"
                >
                  <Checkbox
                    name="roles"
                    value={role}
                    defaultChecked={v?.roles?.includes(role)}
                    disabled={locked}
                    className="mt-0.5"
                  />
                  {/* Disabled inputs are not submitted, so keep a locked role explicitly. */}
                  {locked && <input type="hidden" name="roles" value={role} />}
                  <span>
                    <span className="block text-sm font-medium">{ROLE_META[role].label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {locked ? "You cannot remove your own Administrator role." : ROLE_META[role].description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {errors.roles && (
            <p id="roles-error" className="mt-3 text-xs font-medium text-destructive">
              {errors.roles}
            </p>
          )}
        </fieldset>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" asChild>
          <Link href="/settings/users">Cancel</Link>
        </Button>
        <SubmitButton pendingLabel={mode === "create" ? "Sending invite…" : "Saving…"}>
          {mode === "create" ? "Create user and send invite" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}
