"use client";

import { useActionState } from "react";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { forgotPasswordAction, type FormState } from "../actions";

export function ForgotPasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(forgotPasswordAction, {});

  if (state.success) {
    return (
      <div className="mt-8">
        <FormAlert tone="success">{state.success}</FormAlert>
      </div>
    );
  }

  return (
    <form action={action} className="mt-8 space-y-5" noValidate>
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
      <Field id="email" label="Work email" error={state.fieldErrors?.email}>
        <Input name="email" type="email" autoComplete="username" placeholder="name@motadata.com" required autoFocus />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingLabel="Sending…">
        Send reset link
      </SubmitButton>
    </form>
  );
}
