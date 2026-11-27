"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { flattenErrors } from "@/lib/form-errors";
import { ForbiddenError, requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { EventError } from "@/server/events/service";
import { getRequestContext } from "@/server/request-context";
import {
  createTemplate,
  duplicateTemplate,
  setTemplateActive,
  updateTemplate,
  type TemplateInput,
} from "@/server/templates/service";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; success?: string };
export type ActionResult = { ok: boolean; message?: string };

function toState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: flattenErrors(err) };
  if (err instanceof EventError)
    return err.field ? { fieldErrors: { [err.field]: err.message } } : { error: err.message };
  if (err instanceof ForbiddenError) return { error: err.message };
  console.error(err);
  return { error: "Something went wrong. Please try again." };
}

export async function saveTemplateAction(
  templateId: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requirePermission("templates.manage");
  const meta = await getRequestContext();

  let input: TemplateInput;
  try {
    // The repeatable parts and prefilled answers travel as JSON from the editor.
    input = {
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      eventTypeId: String(formData.get("eventTypeId") ?? ""),
      subtypeId: String(formData.get("subtypeId") ?? ""),
      answers: JSON.parse(String(formData.get("answers") || "{}")),
      costLines: JSON.parse(String(formData.get("costLines") || "[]")),
      tasks: JSON.parse(String(formData.get("tasks") || "[]")),
    };
  } catch {
    return { error: "The form could not be read. Please try again." };
  }

  let saved;
  try {
    saved = templateId
      ? await updateTemplate(db, actor, templateId, input, meta)
      : await createTemplate(db, actor, input, meta);
  } catch (err) {
    return toState(err);
  }

  revalidatePath("/templates");
  if (!templateId) redirect(`/templates/${saved.id}?created=1`);
  revalidatePath(`/templates/${templateId}`);
  return { success: "Template saved." };
}

export async function duplicateTemplateAction(id: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission("templates.manage");
    const copy = await duplicateTemplate(db, actor, id, await getRequestContext());
    revalidatePath("/templates");
    return { ok: true, message: `Copied as "${copy.name}".` };
  } catch (err) {
    const state = toState(err);
    return { ok: false, message: state.error ?? "Could not duplicate." };
  }
}

export async function setTemplateActiveAction(id: string, active: boolean): Promise<ActionResult> {
  try {
    const actor = await requirePermission("templates.manage");
    await setTemplateActive(db, actor, id, active, await getRequestContext());
    revalidatePath("/templates");
    revalidatePath(`/templates/${id}`);
    return { ok: true, message: active ? "Template restored." : "Template archived." };
  } catch (err) {
    const state = toState(err);
    return { ok: false, message: state.error ?? "Could not update." };
  }
}
