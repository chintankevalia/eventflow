/**
 * Sales' go / no-go on a new event (questions in src/lib/sales-review.ts).
 *
 * Every event created in the portal starts with `salesReviewStatus = PENDING`; nothing can move it
 * to Scheduling or approval until someone in the Sales department (or an administrator) answers
 * the business-case questions and decides. Go unlocks planning. No-go drops the event with Sales'
 * reason, so the history stays visible. Events that existed before this gate are NOT_REQUIRED.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  MAX_SCORE,
  missingForDecision,
  salesReviewAnswersSchema,
  totalScore,
  type SalesReviewAnswers,
} from "@/lib/sales-review";
import { writeAudit } from "@/server/audit";
import { sendAndLog } from "@/server/approvals/notifications";
import { appUrl, escapeHtml, renderEmail } from "@/server/mail/layout";
import type { Answers } from "./answers";

type Actor = { id: string; name: string };
type Meta = { ipAddress?: string | null };
type Reviewer = { id: string; roles: readonly string[]; department?: string | null };

export class SalesReviewError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Anyone in the Sales department, plus administrators, may answer and decide. */
export function canReviewForSales(user: Reviewer) {
  return user.department === "SALES" || user.roles.includes("ADMIN");
}

const KIND_BY_TYPE: Record<string, string> = {
  partner_meet: "partner",
  distributor_partner: "partner",
  end_customer_with_partner: "partner_led_customer",
  distributor: "partner_led_customer",
  customer: "end_customer",
};

/** What the requester already told us, so Sales starts from it rather than a blank form. */
export function salesReviewPrefill(eventTypeKey: string, answers: Answers): SalesReviewAnswers {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return {
    eventKind: KIND_BY_TYPE[eventTypeKey],
    city: text(answers["basic.city"]),
    date: text(answers["basic.proposedDate"]),
    format: text(answers["basic.format"]),
  };
}

function parseAnswers(raw: Record<string, unknown>) {
  const result = salesReviewAnswersSchema.safeParse(raw);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    throw new SalesReviewError("Some answers need attention.", fieldErrors);
  }
  // Drop undefined so the stored JSON only holds what was actually answered.
  return Object.fromEntries(Object.entries(result.data).filter(([, v]) => v !== undefined)) as SalesReviewAnswers;
}

export type SalesDecision = "SAVE" | "GO" | "NO_GO";

/**
 * Saves Sales' answers and, optionally, the decision. "SAVE" keeps the review open so it can be
 * finished later; "GO" needs every required answer and all five scores; "NO_GO" needs a reason.
 */
export async function saveSalesReview(
  db: PrismaClient,
  actor: Actor & Reviewer,
  eventId: string,
  input: { answers: Record<string, unknown>; decision: SalesDecision; comment?: string | null },
  meta: Meta = {},
) {
  if (!canReviewForSales(actor)) throw new SalesReviewError("Only the Sales team can review this event.");

  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) throw new SalesReviewError("Event not found.");
  if (event.salesReviewStatus !== "PENDING") {
    throw new SalesReviewError("Sales has already decided on this event.");
  }
  if (event.lifecycleStatus === "DROPPED") throw new SalesReviewError("This event has been dropped.");

  const answers = parseAnswers(input.answers);
  const total = totalScore(answers);
  const comment = input.comment?.trim() || null;

  if (input.decision === "GO") {
    const missing = missingForDecision(answers);
    if (missing.length) {
      throw new SalesReviewError(`Answer every question before saying Go. Still missing: ${missing.join(", ")}.`);
    }
  }
  if (input.decision === "NO_GO" && (!comment || comment.length < 5)) {
    throw new SalesReviewError("Give a reason (at least 5 characters) for the No-go.", {
      comment: "Say why this event isn't worth running.",
    });
  }

  const decided = input.decision !== "SAVE";
  const decision = input.decision === "SAVE" ? "PENDING" : input.decision;
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.salesReview.upsert({
      where: { eventId },
      create: {
        eventId,
        answers: answers as Prisma.InputJsonValue,
        totalScore: total,
        comment,
        decision,
        reviewedById: decided ? actor.id : null,
        reviewedAt: decided ? now : null,
      },
      update: {
        answers: answers as Prisma.InputJsonValue,
        totalScore: total,
        comment,
        decision,
        reviewedById: decided ? actor.id : null,
        reviewedAt: decided ? now : null,
      },
    });

    if (!decided) {
      await writeAudit(tx, {
        actorId: actor.id,
        action: "sales_review.saved",
        entityType: "Event",
        entityId: eventId,
        summary: `${actor.name} saved the Sales review of ${event.code}`,
        ipAddress: meta.ipAddress,
      });
      return;
    }

    const scoreText = total === null ? "" : ` (score ${total}/${MAX_SCORE})`;
    await tx.event.update({
      where: { id: eventId },
      data:
        input.decision === "GO"
          ? { salesReviewStatus: "GO" }
          : {
              salesReviewStatus: "NO_GO",
              lifecycleStatus: "DROPPED",
              droppedReason: `Sales No-go${scoreText}: ${comment}`,
            },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: input.decision === "GO" ? "sales_review.go" : "sales_review.no_go",
      entityType: "Event",
      entityId: eventId,
      summary: `${actor.name} gave ${event.code} a ${input.decision === "GO" ? "Go" : "No-go"}${scoreText}`,
      before: { salesReviewStatus: "PENDING", lifecycleStatus: event.lifecycleStatus },
      after: {
        salesReviewStatus: input.decision,
        lifecycleStatus: input.decision === "GO" ? event.lifecycleStatus : "DROPPED",
      },
      ipAddress: meta.ipAddress,
    });
  });

  if (decided) await notifyDecision(db, eventId, actor.name, input.decision as "GO" | "NO_GO", total, comment);
  return { decision: input.decision, total };
}

/** Emails everyone in Sales that a new event needs their go / no-go. Best effort. */
export async function notifySalesReviewers(db: PrismaClient, eventId: string) {
  const [event, reviewers] = await Promise.all([
    db.event.findUnique({
      where: { id: eventId },
      select: { code: true, title: true, city: true, requester: { select: { name: true } }, eventType: { select: { name: true } } },
    }),
    db.user.findMany({ where: { status: "ACTIVE", department: "SALES" }, select: { email: true } }),
  ]);
  if (!event || !reviewers.length) return;

  const url = appUrl(`/events/${eventId}?tab=sales-review`);
  await sendAndLog(
    db,
    {
      to: reviewers.map((r) => r.email),
      subject: `Sales review needed: ${event.code} ${event.title}`,
      html: renderEmail({
        preheader: `${event.requester.name} raised a new event. Is it worth running?`,
        heading: "A new event needs Sales' go / no-go",
        paragraphs: [
          `${escapeHtml(event.requester.name)} raised <strong>${escapeHtml(event.code)} — ${escapeHtml(event.title)}</strong> (${escapeHtml(event.eventType.name)}${event.city ? `, ${escapeHtml(event.city)}` : ""}).`,
          "Before any planning starts, Sales answers eleven questions about the business case — audience, leads, pipeline, revenue and cost — scores it, and decides whether it goes ahead.",
        ],
        action: { label: "Review the event", url },
      }),
      text: `${event.requester.name} raised ${event.code} — ${event.title}. Sales needs to review the business case and decide Go or No-go: ${url}`,
    },
    { kind: "sales_review.request", eventId },
  );
}

async function notifyDecision(
  db: PrismaClient,
  eventId: string,
  reviewer: string,
  decision: "GO" | "NO_GO",
  total: number | null,
  comment: string | null,
) {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { code: true, title: true, requester: { select: { email: true } }, owner: { select: { email: true } } },
  });
  if (!event) return;
  const to = [...new Set([event.requester.email, event.owner?.email].filter(Boolean) as string[])];
  const go = decision === "GO";
  const url = appUrl(`/events/${eventId}`);
  const score = total === null ? "" : ` with a score of ${total}/${MAX_SCORE}`;
  await sendAndLog(
    db,
    {
      to,
      subject: `${go ? "Go" : "No-go"} from Sales: ${event.code} ${event.title}`,
      html: renderEmail({
        preheader: go ? "You can start planning." : "Sales decided not to run this event.",
        heading: go ? "Sales says Go — start planning" : "Sales decided not to run this event",
        paragraphs: [
          `${escapeHtml(reviewer)} reviewed <strong>${escapeHtml(event.code)} — ${escapeHtml(event.title)}</strong>${score}.`,
          go
            ? "The event can now move to Scheduling: plan the dates, budget and tasks, then submit it for approval."
            : `The event has been dropped. Reason: ${escapeHtml(comment ?? "")}`,
        ],
        action: { label: "Open the event", url },
      }),
      text: `${reviewer} gave ${event.code} a ${go ? "Go" : "No-go"}${score}. ${go ? "" : `Reason: ${comment}`} ${url}`,
    },
    { kind: go ? "sales_review.go" : "sales_review.no_go", eventId },
  );
}

