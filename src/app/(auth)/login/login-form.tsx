"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { loginAction, type FormState } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});

  return (
    <form action={action} className="mt-8 space-y-5" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
      <Field id="email" label="Work email" error={state.fieldErrors?.email}>
        <Input
          name="email"
          type="email"
          autoComplete="username"
          placeholder="name@motadata.com"
          defaultValue={state.email}
          required
          autoFocus
        />
      </Field>
      <Field
        id="password"
        label="Password"
        error={state.fieldErrors?.password}
        labelAside={
          <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        }
      >
        {/* Company policy: the sign-in password must be typed. Paste and drag-drop are both refused,
            since dropping text is the other way in. Only on sign-in, not on set-password screens. */}
        <PasswordInput
          name="password"
          autoComplete="current-password"
          required
          onPaste={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
        />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
