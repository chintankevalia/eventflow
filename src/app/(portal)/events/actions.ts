"use server";

import { UPLOADABLE_KINDS } from "@/lib/attachments";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import type { AttachmentKind, TaskStatus } from "@prisma/client";
import { flattenErrors } from "@/lib/form-errors";
import { can } from "@/lib/permissions";
import { ForbiddenError, requirePermission, requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { attachFile, removeAttachment } from "@/server/events/attachments";
import {
  addCostLine,
  addSpeaker,
  addStakeholder,
  addTask,
  addTaskDependency,
  removeCostLine,
  removeSpeaker,
  removeStakeholder,
  removeTask,
  removeTaskDependency,
  savePostEventResult,
  updateCostLine,
  updateTask,
} from "@/server/events/parts";
import {
  assertCanEditEvent,
  canEditEvent,
  closeEvent,
  createEvent,
  dropEvent,
  EventError,
  moveToExecution,
  moveToScheduling,
  saveAnswers,
  type Actor,
  updateOwnership,
} from "@/server/events/service";
import { getRequestContext } from "@/server/request-context";
import { notifySalesReviewers, saveSalesReview, SalesReviewError, type SalesDecision } from "@/server/events/sales-review";
import { UploadError } from "@/server/storage";
import { queueEventEngagement } from "@/server/hubspot/sync";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; success?: string };
export type ActionResult = { ok: boolean; message?: string };

function toState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: flattenErrors(err) };
  if (err instanceof EventError)
    return err.field ? { fieldErrors: { [err.field]: err.message } } : { error: err.message };
  if (err instanceof UploadError) return { error: err.message };
  if (err instanceof ForbiddenError) return { error: err.message };
  console.error(err);
  return { error: "Something went wrong. Please try again." };
}

function toResult(err: unknown): ActionResult {
  const state = toState(err);
  return { ok: false, message: state.error ?? Object.values(state.fieldErrors ?? {})[0] ?? "Could not save." };
}

/** Loads the event and checks the signed-in user may change it. */
async function editable(eventId: string) {
  const user = await requireUser();
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, code: true, requesterId: true, ownerId: true, managerId: true },
  });
  if (!event) throw new EventError("Event not found.");
  assertCanEditEvent(user, event);
  const actor: Actor = { id: user.id, name: user.name, department: user.department };
  return { actor, event, meta: await getRequestContext() };
}

/**
 * Loads the event and checks the signed-in user may record actuals, invoices and payment on it.
 *
 * Deliberately not `editable()`: Finance is not one of the plan's own editors (requester, owner,
 * manager, admin) and must never gain their access to the plan fields — description, category,
 * vendor, estimated amount. The two populations are unioned here, but what either of them may
 * send through this path is the narrow actual/invoice/payment field set the calling actions
 * accept, never the plan ones; `updateCostLine` itself also only honours plan fields while the
 * event is still in a plan-editable stage (`src/server/events/parts.ts`).
 */
async function editableByFinance(eventId: string) {
  const user = await requireUser();
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, code: true, lifecycleStatus: true, requesterId: true, ownerId: true, managerId: true },
  });
  if (!event) throw new EventError("Event not found.");
  if (!can(user.roles, "finance.view") && !canEditEvent(user, event)) {
    throw new EventError("Only Finance, the event's owner or manager, or an administrator can record this.");
  }
  if (!["APPROVED", "IN_EXECUTION", "CLOSED"].includes(event.lifecycleStatus)) {
    throw new EventError("Actuals and invoices can be recorded once the event is approved.");
  }
  const actor: Actor = { id: user.id, name: user.name, department: user.department };
  return { actor, event, meta: await getRequestContext() };
}

const refresh = (eventId: string) => {
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
};

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requirePermission("events.create");
  let event;
  try {
    event = await createEvent(
      db,
      { id: user.id, name: user.name, department: user.department },
      {
        eventTypeId: String(formData.get("eventTypeId") ?? ""),
        subtypeId: String(formData.get("subtypeId") ?? ""),
        title: String(formData.get("title") ?? ""),
        department: (formData.get("department") as never) ?? user.department ?? "OTHER",
        partnerOrgId: String(formData.get("partnerOrgId") ?? ""),
        templateId: String(formData.get("templateId") ?? ""),
      },
      await getRequestContext(),
    );
  } catch (err) {
    return toState(err);
  }
  // Best effort: a mail failure is logged (NotificationLog) and must not lose the new event.
  await notifySalesReviewers(db, event.id).catch((err) => console.error("[sales-review] notify failed", err));
  revalidatePath("/events");
  redirect(`/events/${event.id}?created=1`);
}

// ─── Sales review ────────────────────────────────────────────────────────────

export async function salesReviewAction(eventId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const decision = String(formData.get("decision") ?? "SAVE") as SalesDecision;
  if (!["SAVE", "GO", "NO_GO"].includes(decision)) return { error: "Choose Save, Go or No-go." };
  const answers = Object.fromEntries(
    [...formData.entries()].filter(([k]) => !["decision", "comment"].includes(k) && !k.startsWith("$")),
  );
  try {
    await saveSalesReview(
      db,
      { id: user.id, name: user.name, roles: user.roles, department: user.department },
      eventId,
      { answers, decision, comment: String(formData.get("comment") ?? "") },
      await getRequestContext(),
    );
  } catch (err) {
    if (err instanceof SalesReviewError) return { error: err.message, fieldErrors: err.fieldErrors };
    return toState(err);
  }
  refresh(eventId);
  revalidatePath("/sales-review");
  return {
    success:
      decision === "GO" ? "Go recorded. The requester can start planning." : decision === "NO_GO" ? "No-go recorded; the event was dropped." : "Saved.",
  };
}

// ─── Sections ────────────────────────────────────────────────────────────────

export async function saveSectionAction(eventId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { actor, meta } = await editable(eventId);
    const raw: Record<string, unknown> = {};
    // Field keys are sent in a hidden input so unchecked checkboxes and cleared values are still handled.
    for (const key of String(formData.get("__fields") ?? "")
      .split(",")
      .filter(Boolean)) {
      const values = formData.getAll(key);
      raw[key] = values.length > 1 ? values.map(String) : (values[0] ?? "");
    }
    const result = await saveAnswers(db, actor, eventId, raw, meta);
    if (!result.ok) {
      refresh(eventId); // the other fields on the tab were saved — show them as saved
      return { fieldErrors: result.errors, error: "Some fields need attention. Everything else on this tab was saved." };
    }
  } catch (err) {
    return toState(err);
  }
  refresh(eventId);
  return { success: "Saved." };
}

export async function moveToSchedulingAction(eventId: string): Promise<ActionResult> {
  try {
    const { actor, meta } = await editable(eventId);
    await moveToScheduling(db, actor, eventId, meta);
    refresh(eventId);
    return { ok: true, message: "Moved to Scheduling." };
  } catch (err) {
    return toResult(err);
  }
}

export async function dropEventAction(eventId: string, reason: string): Promise<ActionResult> {
  try {
    const { actor, meta } = await editable(eventId);
    await dropEvent(db, actor, eventId, reason, meta);
    refresh(eventId);
    return { ok: true, message: "Event dropped." };
  } catch (err) {
    return toResult(err);
  }
}

export async function moveToExecutionAction(eventId: string): Promise<ActionResult> {
  try {
    const { actor, meta } = await editable(eventId);
    await moveToExecution(db, actor, eventId, meta);
    refresh(eventId);
    return { ok: true, message: "Moved to In Execution." };
  } catch (err) {
    return toResult(err);
  }
}

export async function closeEventAction(eventId: string): Promise<ActionResult> {
  try {
    const { actor, meta } = await editable(eventId);
    await closeEvent(db, actor, eventId, meta);
    // Queue a HubSpot engagement push (no-op if integration is disabled).
    await queueEventEngagement(eventId, db).catch(() => undefined);
    refresh(eventId);
    return { ok: true, message: "Event closed." };
  } catch (err) {
    return toResult(err);
  }
}

export async function savePostEventResultAction(
  eventId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor, meta } = await editable(eventId);
    const raw: Record<string, unknown> = {};
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("__")) raw[key] = value === "" ? null : value;
    }
    await savePostEventResult(db, actor, eventId, raw, meta);
  } catch (err) {
    return toState(err);
  }
  refresh(eventId);
  return { success: "Post-event results saved." };
}

// ─── Cost lines ──────────────────────────────────────────────────────────────

export async function addCostLineAction(eventId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { actor, meta } = await editable(eventId);
    await addCostLine(
      db,
      actor,
      eventId,
      {
        description: String(formData.get("description") ?? ""),
        categoryId: String(formData.get("categoryId") ?? ""),
        estimated: String(formData.get("estimated") ?? ""),
        vendor: String(formData.get("vendor") ?? ""),
      },
      meta,
    );
  } catch (err) {
    return toState(err);
  }
  refresh(eventId);
  return { success: "Cost line added." };
}

export async function updateCostLineAction(
  eventId: string,
  lineId: string,
  patch: {
    estimated?: string;
    actual?: string;
    invoiceRef?: string;
    invoiceStatus?: "NOT_RAISED" | "RECEIVED" | "PAID";
    paymentStatus?: "PENDING" | "PAID" | null;
  },
): Promise<ActionResult> {
  try {
    const { actor, meta } = await editable(eventId);
    await updateCostLine(db, actor, lineId, patch, meta);
    refresh(eventId);
    return { ok: true, message: "Updated." };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeCostLineAction(eventId: string, lineId: string): Promise<ActionResult> {
  try {
    const { actor, meta } = await editable(eventId);
    await removeCostLine(db, actor, lineId, meta);
    refresh(eventId);
    return { ok: true, message: "Cost line removed." };
  } catch (err) {
    return toResult(err);
  }
}

// ─── Finance: actuals, invoices and payment ──────────────────────────────────

/**
 * Records what was actually spent, the invoice reference, and payment status on one budget line.
 * Open to Finance (any approved/running/closed event) and to the plan's own editors — see
 * `editableByFinance`. Never accepts the plan fields (description, category, vendor, estimate).
 */
export async function recordCostLineActualsAction(
  eventId: string,
  lineId: string,
  patch: {
    actual?: string;
    invoiceRef?: string;
    invoiceStatus?: "NOT_RAISED" | "RECEIVED" | "PAID";
    paymentStatus?: "PENDING" | "PAID" | null;
  },
): Promise<ActionResult> {
  try {
    const { actor, meta } = await editableByFinance(eventId);
    await updateCostLine(db, actor, lineId, patch, meta);
    refresh(eventId);
    return { ok: true, message: "Saved." };
  } catch (err) {
    return toResult(err);
  }
}

/** Uploads an invoice against one specific budget line. The kind is always INVOICE — never the client's choice. */
export async function uploadCostLineInvoiceAction(
  eventId: string,
  lineId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor, meta } = await editableByFinance(eventId);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { fieldErrors: { file: "Choose a file to upload." } };
    const bytes = Buffer.from(await file.arrayBuffer());
    await attachFile(db, actor, eventId, { name: file.name, type: file.type, bytes }, "INVOICE", meta, lineId);
  } catch (err) {
    return toState(err);
  }
  refresh(eventId);
  return { success: "Invoice uploaded." };
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function addTaskAction(eventId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { actor, meta } = await editable(eventId);
    await addTask(
      db,
      actor,
      eventId,
      {
        title: String(formData.get("title") ?? ""),
        ownerId: String(formData.get("ownerId") ?? ""),
        dueDate: String(formData.get("dueDate") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      },
      meta,
    );
  } catch (err) {
    return toState(err);
  }
  refresh(eventId);
  return { success: "Task added." };
}

export async function setTaskStatusAction(eventId: string, taskId: string, status: TaskStatus): Promise<ActionResult> {
  try {
    const { actor, meta } = await editable(eventId);
    await updateTask(db, actor, taskId, { status }, meta);
    refresh(eventId);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeTaskAction(eventId: string, taskId: string): Promise<ActionResult> {
  try {
    const { actor, meta } = await editable(eventId);
    await removeTask(db, actor, taskId, meta);
    refresh(eventId);
    return { ok: true, message: "Task removed." };
  } catch (err) {
    return toResult(err);
  }
}

export async function setTaskDependencyAction(
  eventId: string,
  taskId: string,
  dependsOnTaskId: string,
  add: boolean,
): Promise<ActionResult> {
  try {
    await editable(eventId);
    if (add) await addTaskDependency(db, taskId, dependsOnTaskId);
    else await removeTaskDependency(db, taskId, dependsOnTaskId);
    refresh(eventId);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

// ─── Stakeholders & speakers ─────────────────────────────────────────────────

export async function addStakeholderAction(eventId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { actor, meta } = await editable(eventId);
    await addStakeholder(
      db,
      actor,
      eventId,
      {
        userId: String(formData.get("userId") ?? ""),
        externalName: String(formData.get("externalName") ?? ""),
        role: String(formData.get("role") ?? ""),
        responsibility: String(formData.get("responsibility") ?? ""),
      },
      meta,
    );
  } catch (err) {
    return toState(err);
  }
  refresh(eventId);
  return { success: "Stakeholder added." };
}

export async function removeStakeholderAction(eventId: string, id: string): Promise<ActionResult> {
  try {
    const { actor, meta } = await editable(eventId);
    await removeStakeholder(db, actor, id, meta);
    refresh(eventId);
    return { ok: true, message: "Removed." };
  } catch (err) {
    return toResult(err);
  }
}

export async function addSpeakerAction(eventId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { actor, meta } = await editable(eventId);
    await addSpeaker(
      db,
      actor,
      eventId,
      {
        name: String(formData.get("name") ?? ""),
        organization: String(formData.get("organization") ?? ""),
        topic: String(formData.get("topic") ?? ""),
      },
      meta,
    );
  } catch (err) {
    return toState(err);
  }
  refresh(eventId);
  return { success: "Speaker added." };
}

export async function removeSpeakerAction(eventId: string, id: string): Promise<ActionResult> {
  try {
    const { actor, meta } = await editable(eventId);
    await removeSpeaker(db, actor, id, meta);
    refresh(eventId);
    return { ok: true, message: "Removed." };
  } catch (err) {
    return toResult(err);
  }
}

// ─── Attachments ─────────────────────────────────────────────────────────────

export async function uploadAttachmentAction(
  eventId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor, meta } = await editable(eventId);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { fieldErrors: { file: "Choose a file to upload." } };
    // The kind comes from the browser, so it is checked against the list the Files tab offers
    // rather than cast — a crafted request must not be able to file a document as anything else.
    const kind = String(formData.get("kind") ?? "");
    if (!(UPLOADABLE_KINDS as readonly string[]).includes(kind)) {
      return { fieldErrors: { kind: "Choose what kind of document this is." } };
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    await attachFile(
      db,
      actor,
      eventId,
      { name: file.name, type: file.type, bytes },
      kind as AttachmentKind,
      meta,
    );
  } catch (err) {
    return toState(err);
  }
  refresh(eventId);
  return { success: "File uploaded." };
}

export async function removeAttachmentAction(eventId: string, id: string): Promise<ActionResult> {
  try {
    const { actor, meta } = await editable(eventId);
    await removeAttachment(db, actor, id, meta);
    refresh(eventId);
    return { ok: true, message: "File removed." };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateOwnershipAction(eventId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireUser();
    await updateOwnership(
      db,
      { id: user.id, name: user.name, department: user.department, roles: user.roles },
      eventId,
      {
        ownerId: String(formData.get("ownerId") ?? ""),
        managerId: String(formData.get("managerId") ?? ""),
        partnerOrgId: String(formData.get("partnerOrgId") ?? ""),
        partnerTier: String(formData.get("partnerTier") ?? ""),
      },
      await getRequestContext(),
    );
  } catch (err) {
    return toState(err);
  }
  refresh(eventId);
  return { success: "Owner and partner saved." };
}
