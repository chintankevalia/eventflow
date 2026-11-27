"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import type { DecisionType } from "@prisma/client";
import { flattenErrors } from "@/lib/form-errors";
import { ForbiddenError, requirePermission, requireUser } from "@/server/auth/session";
import { ApprovalError, recordDecision, reopenForChanges, submitForApproval } from "@/server/approvals/engine";
import { db } from "@/server/db";
import { EVENTS_PAGE_SIZE } from "@/server/events/queries";
import { assertCanEditEvent, EventError } from "@/server/events/service";
import { getRequestContext } from "@/server/request-context";

export type ActionResult = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

function toResult(err: unknown): ActionResult {
  if (err instanceof ZodError) {
    const fieldErrors = flattenErrors(err);
    return { ok: false, message: Object.values(fieldErrors)[0], fieldErrors };
  }
  if (err instanceof ApprovalError || err instanceof EventError) return { ok: false, message: err.message };
  if (err instanceof ForbiddenError) return { ok: false, message: err.message };
  console.error(err);
  return { ok: false, message: "Something went wrong. Please try again." };
}

/** Sends a request into the approval chain. */
export async function submitForApprovalAction(eventId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const event = await db.event.findUnique({
      where: { id: eventId },
      select: { requesterId: true, ownerId: true, managerId: true },
    });
    if (!event) return { ok: false, message: "Event not found." };
    assertCanEditEvent(user, event);

    await submitForApproval(
      db,
      { id: user.id, name: user.name, department: user.department },
      eventId,
      await getRequestContext(),
    );
    revalidatePath(`/events/${eventId}`);
    revalidatePath("/events");
    revalidatePath("/approvals");
    return { ok: true, message: "Submitted for approval. The approvers have been emailed." };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Submits several requests from the register's selection bar.
 *
 * Every id is re-checked on the server — the client's selection is a request,
 * not a grant — and each event is submitted independently so one failure (an
 * incomplete form, a wrong stage) does not block the rest. Capped at one page
 * of the register so a crafted request cannot fire an unbounded run of emails.
 */
export async function submitManyForApprovalAction(
  eventIds: string[],
): Promise<ActionResult & { submitted?: number; failures?: { code: string; message: string }[] }> {
  try {
    const user = await requireUser();
    const ids = [...new Set(eventIds)].slice(0, EVENTS_PAGE_SIZE);
    if (ids.length === 0) return { ok: false, message: "Nothing selected." };

    const events = await db.event.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, requesterId: true, ownerId: true, managerId: true },
    });

    const context = await getRequestContext();
    const actor = { id: user.id, name: user.name, department: user.department };
    const failures: { code: string; message: string }[] = [];
    let submitted = 0;

    for (const event of events) {
      try {
        assertCanEditEvent(user, event);
        await submitForApproval(db, actor, event.id, context);
        revalidatePath(`/events/${event.id}`);
        submitted += 1;
      } catch (err) {
        failures.push({ code: event.code, message: toResult(err).message ?? "Could not submit." });
      }
    }

    revalidatePath("/events");
    revalidatePath("/approvals");

    const missing = ids.length - events.length;
    if (missing > 0) failures.push({ code: `${missing} event${missing === 1 ? "" : "s"}`, message: "No longer exists." });

    return {
      ok: submitted > 0,
      submitted,
      failures,
      message:
        submitted === 0
          ? "Nothing could be submitted."
          : `Submitted ${submitted} event${submitted === 1 ? "" : "s"} for approval.`,
    };
  } catch (err) {
    return toResult(err);
  }
}

/** Approve, reject or request changes from inside the portal. */
export async function decideAction(roundId: string, decision: DecisionType, comment: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("approvals.view");
    const result = await recordDecision(
      db,
      { roundId, approverId: user.id, decision, comment: comment || null, channel: "PORTAL" },
      await getRequestContext(),
    );
    revalidatePath("/approvals");
    revalidatePath("/events");

    const messages: Record<string, string> = {
      APPROVED: "Approved. The event is now locked and everyone has been notified.",
      REJECTED: "Rejected. The requester has been notified.",
      CHANGES_REQUESTED: "Sent back for changes. The requester has been notified.",
      STAGE_ADVANCED: `Approved. It has moved on to ${"nextStageName" in result ? result.nextStageName : "the next stage"}.`,
      STAGE_PENDING:
        "waitingFor" in result && result.waitingFor === 1
          ? "Approved. One more approver still needs to decide."
          : `Approved. ${"waitingFor" in result ? result.waitingFor : "Other"} approvers still need to decide.`,
    };
    return { ok: true, message: messages[result.outcome] ?? "Decision recorded." };
  } catch (err) {
    return toResult(err);
  }
}

/** Reopens an approved event so it can be changed; it will need approving again. */
export async function reopenForChangesAction(eventId: string, reason: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const event = await db.event.findUnique({
      where: { id: eventId },
      select: { requesterId: true, ownerId: true, managerId: true },
    });
    if (!event) return { ok: false, message: "Event not found." };
    assertCanEditEvent(user, event);

    await reopenForChanges(
      db,
      { id: user.id, name: user.name, department: user.department },
      eventId,
      reason,
      await getRequestContext(),
    );
    revalidatePath(`/events/${eventId}`);
    revalidatePath("/events");
    return { ok: true, message: "Reopened for changes. It will need approving again." };
  } catch (err) {
    return toResult(err);
  }
}
