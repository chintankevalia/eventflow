"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { flattenErrors } from "@/lib/form-errors";
import { ForbiddenError, requirePermission } from "@/server/auth/session";
import { ConfigError } from "@/server/config/lookups";
import { db } from "@/server/db";
import { getRequestContext } from "@/server/request-context";
import {
  addContact,
  createOrganization,
  removeContact,
  setOrganizationStatus,
  updateContact,
  updateOrganization,
  type ContactInput,
  type OrganizationInput,
} from "@/server/organizations/service";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; success?: string };

function toState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: flattenErrors(err) };
  if (err instanceof ConfigError)
    return err.field ? { fieldErrors: { [err.field]: err.message } } : { error: err.message };
  if (err instanceof ForbiddenError) return { error: err.message };
  console.error(err);
  return { error: "Something went wrong. Please try again." };
}

function readOrg(formData: FormData): OrganizationInput {
  return {
    type: formData.get("type") as OrganizationInput["type"],
    name: String(formData.get("name") ?? ""),
    tierId: String(formData.get("tierId") ?? ""),
    website: String(formData.get("website") ?? ""),
    city: String(formData.get("city") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

export async function createOrgAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission("masterdata.manage");
  let org;
  try {
    org = await createOrganization(db, actor, readOrg(formData), await getRequestContext());
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/settings/master-data");
  redirect(`/settings/master-data/${org.id}`);
}

export async function updateOrgAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission("masterdata.manage");
  try {
    await updateOrganization(db, actor, id, readOrg(formData), await getRequestContext());
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/settings/master-data");
  revalidatePath(`/settings/master-data/${id}`);
  return { success: "Changes saved." };
}

export async function setOrgStatusAction(id: string, status: "ACTIVE" | "ARCHIVED") {
  const actor = await requirePermission("masterdata.manage");
  try {
    await setOrganizationStatus(db, actor, id, status, await getRequestContext());
    revalidatePath("/settings/master-data");
    revalidatePath(`/settings/master-data/${id}`);
    return { ok: true, message: status === "ARCHIVED" ? "Organization archived." : "Organization restored." };
  } catch (err) {
    const s = toState(err);
    return { ok: false, message: s.error ?? "Could not update." };
  }
}

function readContact(formData: FormData): ContactInput {
  return {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    jobTitle: String(formData.get("jobTitle") ?? ""),
    isPrimary: formData.get("isPrimary") === "on" || formData.get("isPrimary") === "true",
  };
}

export async function addContactAction(orgId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission("masterdata.manage");
  try {
    await addContact(db, actor, orgId, readContact(formData), await getRequestContext());
  } catch (err) {
    return toState(err);
  }
  revalidatePath(`/settings/master-data/${orgId}`);
  return { success: "Contact added." };
}

export async function updateContactAction(
  contactId: string,
  orgId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requirePermission("masterdata.manage");
  try {
    await updateContact(db, actor, contactId, readContact(formData), await getRequestContext());
  } catch (err) {
    return toState(err);
  }
  revalidatePath(`/settings/master-data/${orgId}`);
  return { success: "Contact updated." };
}

export async function removeContactAction(contactId: string, orgId: string) {
  const actor = await requirePermission("masterdata.manage");
  try {
    await removeContact(db, actor, contactId, await getRequestContext());
    revalidatePath(`/settings/master-data/${orgId}`);
    return { ok: true, message: "Contact removed." };
  } catch (err) {
    const s = toState(err);
    return { ok: false, message: s.error ?? "Could not remove contact." };
  }
}
