"use server";

import { z } from "zod";
import { flattenErrors } from "@/lib/form-errors";
import { changeOwnPassword } from "@/server/auth/service";
import { getCurrentSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { getRequestContext } from "@/server/request-context";

export type PasswordFormState = { error?: string; fieldErrors?: Record<string, string>; success?: string };

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(256),
    newPassword: z.string().max(256),
    confirm: z.string().max(256),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "Passwords do not match." });

export async function changePasswordAction(_prev: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const session = await getCurrentSession();
  if (!session) return { error: "Your session has ended. Sign in again." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };

  const result = await changeOwnPassword(
    db,
    session.user.id,
    parsed.data.currentPassword,
    parsed.data.newPassword,
    session.sessionId,
    await getRequestContext(),
  );
  if (!result.ok) return result.field ? { fieldErrors: { [result.field]: result.error } } : { error: result.error };
  return { success: "Password changed. Other devices have been signed out." };
}
