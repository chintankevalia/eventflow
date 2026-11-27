"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { flattenErrors } from "@/lib/form-errors";
import { ForbiddenError, requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getRequestContext } from "@/server/request-context";
import {
  deactivateUser,
  forceSignOut,
  inviteUser,
  reactivateUser,
  resendInvite,
  sendResetLink,
  updateUser,
  UserServiceError,
  type UserInput,
} from "@/server/users/service";

export type UserFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: string;
  /** Echo of what was submitted, so the form keeps its values after React resets it. */
  values?: UserInput;
};

function readUserForm(formData: FormData): UserInput {
  return {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    jobTitle: String(formData.get("jobTitle") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    // Left as whatever was submitted — including "" for nothing chosen — so the zod schema is
    // the one place that decides whether no department is acceptable, and its error message
    // reaches the field instead of being swallowed by a cast to null here.
    department: String(formData.get("department") ?? "") as UserInput["department"],
    roles: formData.getAll("roles").map(String) as UserInput["roles"],
  };
}

function toFormState(err: unknown): UserFormState {
  if (err instanceof ZodError) return { fieldErrors: flattenErrors(err) };
  if (err instanceof UserServiceError) {
    return err.field ? { fieldErrors: { [err.field]: err.message } } : { error: err.message };
  }
  if (err instanceof ForbiddenError) return { error: err.message };
  console.error(err);
  return { error: "Something went wrong. Please try again." };
}

export async function createUserAction(_prev: UserFormState, formData: FormData): Promise<UserFormState> {
  const actor = await requirePermission("users.manage");
  const values = readUserForm(formData);
  let result;
  try {
    result = await inviteUser(db, actor, values, await getRequestContext());
  } catch (err) {
    return { ...toFormState(err), values };
  }
  revalidatePath("/settings/users");
  redirect(`/settings/users/${result.user.id}?invited=${result.emailSent ? "sent" : "failed"}`);
}

export async function updateUserAction(
  userId: string,
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const actor = await requirePermission("users.manage");
  const values = readUserForm(formData);
  try {
    await updateUser(db, actor, userId, values, await getRequestContext());
  } catch (err) {
    return { ...toFormState(err), values };
  }
  revalidatePath("/settings/users");
  revalidatePath(`/settings/users/${userId}`);
  return { success: "Changes saved.", values };
}

export type UserOperation = "deactivate" | "reactivate" | "resend-invite" | "send-reset" | "sign-out";
export type OperationResult = { ok: boolean; message: string };

export async function userOperationAction(userId: string, operation: UserOperation): Promise<OperationResult> {
  const actor = await requirePermission("users.manage");
  const meta = await getRequestContext();
  try {
    let message: string;
    switch (operation) {
      case "deactivate":
        await deactivateUser(db, actor, userId, meta);
        message = "User deactivated and signed out everywhere.";
        break;
      case "reactivate": {
        const r = await reactivateUser(db, actor, userId, meta);
        message =
          r.status === "INVITED"
            ? r.emailSent
              ? "User reactivated. A new invite email was sent."
              : "User reactivated, but the invite email could not be sent. Try “Resend invite”."
            : "User reactivated. They can sign in again.";
        break;
      }
      case "resend-invite": {
        const r = await resendInvite(db, actor, userId, meta);
        message = r.emailSent ? "Invite email sent again." : "The invite email could not be sent. Check mail settings.";
        break;
      }
      case "send-reset": {
        const r = await sendResetLink(db, actor, userId, meta);
        message = r.emailSent ? "Password reset link sent." : "The reset email could not be sent. Check mail settings.";
        break;
      }
      case "sign-out": {
        const r = await forceSignOut(db, actor, userId, meta);
        message = `Signed out of ${r.count} session${r.count === 1 ? "" : "s"}.`;
        break;
      }
    }
    revalidatePath("/settings/users");
    revalidatePath(`/settings/users/${userId}`);
    return { ok: true, message };
  } catch (err) {
    if (err instanceof UserServiceError || err instanceof ForbiddenError) return { ok: false, message: err.message };
    console.error(err);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
