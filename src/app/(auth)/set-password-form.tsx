"use client";

import { useActionState } from "react";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { setPasswordAction, type FormState } from "./actions";

/** Shared by the invite and reset-password pages. */
export function SetPasswordForm({
  token,
  kind,
  email,
  submitLabel,
}: {
  token: string;
  kind: "INVITE" | "PASSWORD_RESET";
  email: string;
  submitLabel: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(setPasswordAction, {});

  return (
    <form action={action} className="mt-8 space-y-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="kind" value={kind} />
      {/* Lets password managers save the right account. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
      <Field
        id="password"
        label="New password"
        error={state.fieldErrors?.password}
        hint="At least 12 characters. A short sentence works well, e.g. three or four unrelated words."
      >
        <PasswordInput name="password" autoComplete="new-password" required autoFocus />
      </Field>
      <Field id="confirm" label="Confirm password" error={state.fieldErrors?.confirm}>
        <PasswordInput name="confirm" autoComplete="new-password" required />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingLabel="Saving…">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
