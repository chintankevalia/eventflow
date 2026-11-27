"use client";

import { useActionState, useRef } from "react";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { changePasswordAction, type PasswordFormState } from "./actions";
import { useActionToast } from "@/lib/use-action-toast";

export function ChangePasswordForm({ email }: { email: string }) {
  const [state, action] = useActionState<PasswordFormState, FormData>(changePasswordAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useActionToast(state, () => {
    formRef.current?.reset();
  });

  return (
    <form ref={formRef} action={action} noValidate className="space-y-5">
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
      <Field id="currentPassword" label="Current password" error={state.fieldErrors?.currentPassword}>
        <PasswordInput name="currentPassword" autoComplete="current-password" required />
      </Field>
      <Field
        id="newPassword"
        label="New password"
        error={state.fieldErrors?.newPassword}
        hint="At least 12 characters. A short sentence works well."
      >
        <PasswordInput name="newPassword" autoComplete="new-password" required />
      </Field>
      <Field id="confirm" label="Confirm new password" error={state.fieldErrors?.confirm}>
        <PasswordInput name="confirm" autoComplete="new-password" required />
      </Field>
      <SubmitButton pendingLabel="Saving…">Change password</SubmitButton>
    </form>
  );
}
