"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { flattenErrors } from "@/lib/form-errors";
import { ForbiddenError, requirePermission } from "@/server/auth/session";
import { ConfigError } from "@/server/config/lookups";
import {
  createCustomField,
  setCustomFieldActive,
  setFieldRule,
  type CustomFieldInput,
} from "@/server/config/form-fields";
import { db } from "@/server/db";
import { getRequestContext } from "@/server/request-context";

export type ActionResult = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

function toResult(err: unknown): ActionResult {
  if (err instanceof ZodError) return { ok: false, fieldErrors: flattenErrors(err) };
  if (err instanceof ConfigError)
    return { ok: false, message: err.message, fieldErrors: err.field ? { [err.field]: err.message } : undefined };
  if (err instanceof ForbiddenError) return { ok: false, message: err.message };
  console.error(err);
  return { ok: false, message: "Something went wrong. Please try again." };
}

/** One field's state for an event type (and optionally a specific partner tier). */
export async function setFieldStateAction(input: {
  eventTypeId: string;
  fieldKey: string;
  tierValue: string;
  state: "required" | "optional" | "hidden";
}): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    await setFieldRule(
      db,
      actor,
      {
        eventTypeId: input.eventTypeId,
        fieldKey: input.fieldKey,
        tierValue: input.tierValue,
        required: input.state === "required",
        visible: input.state !== "hidden",
      },
      await getRequestContext(),
    );
    revalidatePath("/settings/form-fields");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function addCustomFieldAction(input: CustomFieldInput): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    await createCustomField(db, actor, input, await getRequestContext());
    revalidatePath("/settings/form-fields");
    return { ok: true, message: "Custom field added." };
  } catch (err) {
    return toResult(err);
  }
}

export async function toggleCustomFieldAction(id: string, active: boolean): Promise<ActionResult> {
  try {
    const actor = await requirePermission("config.manage");
    await setCustomFieldActive(db, actor, id, active, await getRequestContext());
    revalidatePath("/settings/form-fields");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}
