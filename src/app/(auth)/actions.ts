"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { flattenErrors } from "@/lib/form-errors";
import { safeNextPath } from "@/lib/safe-redirect";
import { authenticate, requestPasswordReset, setPasswordWithToken } from "@/server/auth/service";
import { endSession, startSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { getRequestContext } from "@/server/request-context";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; success?: string; email?: string };

const LOGIN_MESSAGES = {
  invalid: "Email or password is incorrect.",
  locked: "Too many failed attempts. Wait 15 minutes, or reset your password.",
  rate_limited: "Too many sign-in attempts from this network. Try again in a few minutes.",
} as const;

const loginSchema = z.object({
  email: z.string().trim().email("Enter your work email."),
  password: z.string().min(1, "Enter your password.").max(256),
  next: z.string().optional(),
});

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: flattenErrors(parsed.error), email: String(formData.get("email") ?? "") };
  }
  const meta = await getRequestContext();
  const result = await authenticate(db, parsed.data.email, parsed.data.password, meta);
  if (!result.ok) return { error: LOGIN_MESSAGES[result.reason], email: parsed.data.email };

  await startSession(result.userId, meta);
  redirect(safeNextPath(parsed.data.next));
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ email: z.string().trim().email("Enter your work email.") })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };

  const result = await requestPasswordReset(db, parsed.data.email, await getRequestContext());
  if (!result.ok) return { error: "Too many requests from this network. Try again in a few minutes." };
  return {
    success: "If an active account uses this email, a reset link is on its way. It expires in 60 minutes.",
  };
}

const setPasswordSchema = z
  .object({
    token: z.string().min(20).max(200),
    kind: z.enum(["INVITE", "PASSWORD_RESET"]),
    password: z.string().max(256),
    confirm: z.string().max(256),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match." });

export async function setPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = setPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };

  const { token, kind, password } = parsed.data;
  const meta = await getRequestContext();
  const result = await setPasswordWithToken(db, kind, token, password, meta);
  if (!result.ok) return { fieldErrors: { password: result.error } };

  await startSession(result.userId, meta);
  redirect("/dashboard?welcome=1");
}
