import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, makeActor, meta, sentMail, uid, salesGo } from "../../../tests/integration/helpers";
import { createEventType } from "../config/event-types";
import type { Actor } from "../config/lookups";
import { addCostLine } from "../events/parts";
import { createEvent, saveAnswers } from "../events/service";
import {
  ApprovalError,
  getApprovalHistory,
  pendingForApprover,
  recordDecision,
  reopenForChanges,
  submitForApproval,
} from "./engine";
import { runApprovalReminders } from "./reminders";
import { decideWithToken, inspectApprovalToken } from "./tokens";

let requester: Actor;
let akshay: Actor;
let mitul: Actor;
let amit: Actor;
let outsider: Actor;
let eventTypeId: string;
let workflowId: string;
let stageOneId: string;
let stageTwoId: string;

beforeAll(async () => {
  [requester, akshay, mitul, amit, outsider] = await Promise.all([
    makeActor("Riya Requester"),
    makeActor("Akshay"),
    makeActor("Mitul"),
    makeActor("Amit"),
    makeActor("Outsider"),
  ]);

  for (const value of ["physical", "both"]) {
    await db.lookupItem.upsert({
      where: { kind_value: { kind: value === "physical" ? "EVENT_FORMAT" : "PRODUCT_FOCUS", value } },
      update: { active: true },
      create: { kind: value === "physical" ? "EVENT_FORMAT" : "PRODUCT_FOCUS", value, label: value },
    });
  }

  eventTypeId = (await createEventType(db, akshay, { name: `Approval type ${uid()}`, needsPartner: false }, meta())).id;

  // Only one workflow may be active, so retire any left by another suite.
  await db.approvalWorkflow.updateMany({ where: { active: true }, data: { active: false } });
  const workflow = await db.approvalWorkflow.create({
    data: {
      name: `Test workflow ${uid()}`,
      stages: {
        create: [
          { sequence: 1, name: "Department approval", mode: "ALL", reminderHours: 24, escalationHours: 48 },
          { sequence: 2, name: "Final approval", mode: "ALL", reminderHours: 24, escalationHours: 48 },
        ],
      },
    },
    include: { stages: { orderBy: { sequence: "asc" } } },
  });
  workflowId = workflow.id;
  stageOneId = workflow.stages[0].id;
  stageTwoId = workflow.stages[1].id;

  await db.approvalStageApprover.createMany({
    data: [
      { stageId: stageOneId, userId: akshay.id, sortOrder: 0 },
      { stageId: stageOneId, userId: mitul.id, sortOrder: 1 },
      { stageId: stageTwoId, userId: amit.id, sortOrder: 0 },
    ],
  });
});

afterAll(async () => {
  await db.approvalWorkflow.updateMany({ where: { id: workflowId }, data: { active: false } });
  await db.$disconnect();
});

/** A complete request, ready to submit. */
async function submittableEvent() {
  const event = await salesGo(
    await createEvent(db, requester, { eventTypeId, title: `Approval test ${uid()}`, department: "MARKETING" }, meta()),
  );
  const saved = await saveAnswers(
    db,
    requester,
    event.id,
    {
      "basic.objective": "Build pipeline",
      "basic.proposedDate": "2026-12-15",
      "basic.format": "physical",
      "basic.productFocus": "both",
      "budget.expectedRoi": "5 opportunities",
    },
    meta(),
  );
  expect(saved).toEqual({ ok: true });
  await addCostLine(db, requester, event.id, { description: "Venue", estimated: "100000" }, meta());
  await db.event.update({ where: { id: event.id }, data: { lifecycleStatus: "SCHEDULING" } });
  return event;
}

const tokenFor = async (roundId: string, approverId: string) => {
  // The raw token only exists in the email; read it back from the captured message.
  const approver = await db.user.findUniqueOrThrow({ where: { id: approverId }, select: { email: true } });
  const message = [...sentMail].reverse().find((m) => [m.to].flat().includes(approver.email));
  const match = message?.text.match(/\/approve\/([A-Za-z0-9_-]{20,})/);
  if (!match) throw new Error(`No approval link emailed to ${approver.email}`);
  void roundId;
  return match[1];
};

beforeEach(() => {
  sentMail.length = 0;
});

describe("submitting", () => {
  it("snapshots the request, opens stage 1 and emails both approvers", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());

    expect(round.status).toBe("PENDING");
    expect(round.currentStageId).toBe(stageOneId);

    const after = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.lifecycleStatus).toBe("PENDING_APPROVAL");
    expect(after.approvalStatus).toBe("PENDING");

    const version = await db.eventVersion.findFirstOrThrow({ where: { eventId: event.id } });
    expect(version.versionNo).toBe(1);
    expect((version.snapshot as { estimatedCost: string }).estimatedCost).toBe("100000");

    const recipients = sentMail.flatMap((m) => [m.to].flat());
    expect(recipients).toContain((await db.user.findUniqueOrThrow({ where: { id: akshay.id } })).email);
    expect(recipients).toContain((await db.user.findUniqueOrThrow({ where: { id: mitul.id } })).email);
    // Stage 1 asks each approver privately; the wide CC is for the final email.
    expect(sentMail.every((m) => !m.cc?.length)).toBe(true);
  });

  it("refuses an incomplete request", async () => {
    const event = await salesGo(
      await createEvent(db, requester, { eventTypeId, title: `Bare ${uid()}`, department: "SALES" }, meta()),
    );
    await expect(submitForApproval(db, requester, event.id, meta())).rejects.toThrow(/still missing/i);
  });

  it("refuses a request that is already with approvers", async () => {
    const event = await submittableEvent();
    await submitForApproval(db, requester, event.id, meta());
    await expect(submitForApproval(db, requester, event.id, meta())).rejects.toThrow(/already with approvers/i);
  });
});

describe("stage 1 needs both approvers", () => {
  it("does not advance on one approval, and advances on the second", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());

    const first = await recordDecision(
      db,
      { roundId: round.id, approverId: akshay.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
    expect(first).toMatchObject({ outcome: "STAGE_PENDING", waitingFor: 1 });
    expect((await db.approvalRound.findUniqueOrThrow({ where: { id: round.id } })).currentStageId).toBe(stageOneId);

    sentMail.length = 0;
    const second = await recordDecision(
      db,
      { roundId: round.id, approverId: mitul.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
    expect(second).toMatchObject({ outcome: "STAGE_ADVANCED" });

    const moved = await db.approvalRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(moved.currentStageId).toBe(stageTwoId);

    // The detailed final email goes to Amit with everyone copied.
    const amitEmail = (await db.user.findUniqueOrThrow({ where: { id: amit.id } })).email;
    const finalMail = sentMail.find((m) => [m.to].flat().includes(amitEmail));
    expect(finalMail?.subject).toMatch(/Final approval needed/);
    expect(finalMail?.cc?.length).toBeGreaterThan(0);
    expect(finalMail?.html).toContain("Costing");
  });

  it("locks the event and its costing once the final approver approves", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    await recordDecision(
      db,
      { roundId: round.id, approverId: akshay.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
    await recordDecision(
      db,
      { roundId: round.id, approverId: mitul.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
    const final = await recordDecision(
      db,
      { roundId: round.id, approverId: amit.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );

    expect(final).toEqual({ outcome: "APPROVED" });
    const approved = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(approved.lifecycleStatus).toBe("APPROVED");
    expect(approved.approvalStatus).toBe("APPROVED");
    expect(Number(approved.approvedCost)).toBe(100000);
    expect(approved.approvedAt).not.toBeNull();

    const lines = await db.costLineItem.findMany({ where: { eventId: event.id } });
    expect(lines.every((l) => Number(l.approved) === Number(l.estimated))).toBe(true);

    // The plan is locked: no more edits.
    await expect(saveAnswers(db, requester, event.id, { "basic.city": "Pune" }, meta())).rejects.toThrow(/locked/i);
  });
});

describe("rejection and change requests", () => {
  it("a rejection ends the round and sends the request back", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    sentMail.length = 0;

    const result = await recordDecision(
      db,
      {
        roundId: round.id,
        approverId: akshay.id,
        decision: "REJECT",
        comment: "Budget is too high this quarter",
        channel: "PORTAL",
      },
      meta(),
    );
    expect(result).toEqual({ outcome: "REJECTED" });

    const after = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.lifecycleStatus).toBe("SCHEDULING");
    expect(after.approvalStatus).toBe("REJECTED");
    expect(sentMail.some((m) => m.subject.startsWith("Rejected:"))).toBe(true);

    // Mitul can no longer act on a closed round.
    await expect(
      recordDecision(db, { roundId: round.id, approverId: mitul.id, decision: "APPROVE", channel: "PORTAL" }, meta()),
    ).rejects.toBeInstanceOf(ApprovalError);
  });

  it("a change request sends it back and the next submission starts a new version", async () => {
    const event = await submittableEvent();
    const first = await submitForApproval(db, requester, event.id, meta());
    await recordDecision(
      db,
      {
        roundId: first.id,
        approverId: mitul.id,
        decision: "REQUEST_CHANGES",
        comment: "Add the agenda please",
        channel: "PORTAL",
      },
      meta(),
    );

    const after = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.lifecycleStatus).toBe("SCHEDULING");
    expect(after.approvalStatus).toBe("CHANGES_REQUESTED");

    // Editing is allowed again, and resubmitting starts version 2 from scratch.
    expect(await saveAnswers(db, requester, event.id, { "basic.city": "Pune" }, meta())).toEqual({ ok: true });
    const second = await submitForApproval(db, requester, event.id, meta());
    const version = await db.eventVersion.findUniqueOrThrow({ where: { id: second.versionId } });
    expect(version.versionNo).toBe(2);
    expect(second.currentStageId).toBe(stageOneId);
  });

  it("insists on a comment when rejecting or asking for changes", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    await expect(
      recordDecision(
        db,
        { roundId: round.id, approverId: akshay.id, decision: "REJECT", comment: "no", channel: "PORTAL" },
        meta(),
      ),
    ).rejects.toThrow();
    // Approving needs no comment.
    await expect(
      recordDecision(db, { roundId: round.id, approverId: akshay.id, decision: "APPROVE", channel: "PORTAL" }, meta()),
    ).resolves.toBeTruthy();
  });
});

describe("who may decide", () => {
  it("refuses people who are not approvers of the current stage", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    await expect(
      recordDecision(
        db,
        { roundId: round.id, approverId: outsider.id, decision: "APPROVE", channel: "PORTAL" },
        meta(),
      ),
    ).rejects.toThrow(/not an approver/i);
    // Amit approves at stage 2, so he cannot jump in at stage 1.
    await expect(
      recordDecision(db, { roundId: round.id, approverId: amit.id, decision: "APPROVE", channel: "PORTAL" }, meta()),
    ).rejects.toThrow(/not an approver/i);
  });

  it("refuses a second decision from the same approver", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    await recordDecision(
      db,
      { roundId: round.id, approverId: akshay.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
    await expect(
      recordDecision(db, { roundId: round.id, approverId: akshay.id, decision: "APPROVE", channel: "PORTAL" }, meta()),
    ).rejects.toThrow(/already decided/i);
  });

  it("refuses self-approval", async () => {
    // Akshay raises the request himself, then tries to approve it.
    const event = await salesGo(
      await createEvent(db, akshay, { eventTypeId, title: `Self ${uid()}`, department: "SALES" }, meta()),
    );
    await saveAnswers(
      db,
      akshay,
      event.id,
      {
        "basic.objective": "x",
        "basic.proposedDate": "2026-12-15",
        "basic.format": "physical",
        "basic.productFocus": "both",
        "budget.expectedRoi": "y",
      },
      meta(),
    );
    await addCostLine(db, akshay, event.id, { description: "Venue", estimated: "1000" }, meta());
    const round = await submitForApproval(db, akshay, event.id, meta());

    await expect(
      recordDecision(db, { roundId: round.id, approverId: akshay.id, decision: "APPROVE", channel: "PORTAL" }, meta()),
    ).rejects.toThrow(/your own request/i);
  });
});

describe("deciding from an email link", () => {
  it("accepts a valid link once and records the channel", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    const token = await tokenFor(round.id, akshay.id);

    expect(await inspectApprovalToken(db, token)).toMatchObject({ ok: true, approverId: akshay.id });
    const result = await decideWithToken(db, token, "APPROVE", null, meta());
    expect(result).toMatchObject({ outcome: "STAGE_PENDING" });

    const decision = await db.approvalDecision.findFirstOrThrow({
      where: { roundId: round.id, approverId: akshay.id },
    });
    expect(decision.channel).toBe("EMAIL");

    // Second use is refused.
    await expect(decideWithToken(db, token, "APPROVE", null, meta())).rejects.toThrow(/already been used/i);
  });

  it("refuses unknown, expired and stale links", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    const token = await tokenFor(round.id, akshay.id);

    expect(await inspectApprovalToken(db, "not-a-real-token")).toEqual({ ok: false, reason: "invalid" });

    await db.approvalToken.updateMany({
      where: { roundId: round.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await inspectApprovalToken(db, token)).toEqual({ ok: false, reason: "expired" });
  });

  it("invalidates the old links when the request is resubmitted", async () => {
    const event = await submittableEvent();
    const first = await submitForApproval(db, requester, event.id, meta());
    const oldToken = await tokenFor(first.id, akshay.id);

    await recordDecision(
      db,
      {
        roundId: first.id,
        approverId: mitul.id,
        decision: "REQUEST_CHANGES",
        comment: "Please revise",
        channel: "PORTAL",
      },
      meta(),
    );
    await submitForApproval(db, requester, event.id, meta());

    expect(await inspectApprovalToken(db, oldToken)).toMatchObject({ ok: false });
    await expect(decideWithToken(db, oldToken, "APPROVE", null, meta())).rejects.toThrow();
  });

  it("stops working once the stage has moved on", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    const mitulToken = await tokenFor(round.id, mitul.id);

    await recordDecision(
      db,
      { roundId: round.id, approverId: akshay.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
    await recordDecision(
      db,
      { roundId: round.id, approverId: mitul.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );

    expect(await inspectApprovalToken(db, mitulToken)).toMatchObject({ ok: false });
  });
});

describe("reminders and escalation", () => {
  it("stays quiet before the reminder window", async () => {
    const event = await submittableEvent();
    await submitForApproval(db, requester, event.id, meta());
    sentMail.length = 0;
    const result = await runApprovalReminders(db);
    expect(result.reminded).toBe(0);
    expect(sentMail).toHaveLength(0);
  });

  it("reminds after 24 hours, escalates with the team copied after 48, then waits a day", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());

    // 25 hours of silence.
    await db.approvalRound.update({
      where: { id: round.id },
      data: { stageEnteredAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    sentMail.length = 0;
    expect((await runApprovalReminders(db)).reminded).toBeGreaterThanOrEqual(1);
    expect(sentMail.filter((m) => m.subject.startsWith("Reminder")).length).toBe(2);
    expect(sentMail.every((m) => !m.cc?.length)).toBe(true);

    // Running again straight away must not nag.
    sentMail.length = 0;
    await runApprovalReminders(db);
    expect(sentMail).toHaveLength(0);

    // 49 hours: escalate, and copy the wider team.
    await db.approvalRound.update({
      where: { id: round.id },
      data: {
        stageEnteredAt: new Date(Date.now() - 49 * 3_600_000),
        lastReminderAt: new Date(Date.now() - 25 * 3_600_000),
      },
    });
    sentMail.length = 0;
    expect((await runApprovalReminders(db)).escalated).toBeGreaterThanOrEqual(1);
    const escalations = sentMail.filter((m) => m.subject.startsWith("Overdue"));
    expect(escalations.length).toBe(2);
    expect(escalations.every((m) => (m.cc?.length ?? 0) > 0)).toBe(true);
  });

  it("only chases approvers who have not decided", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    await recordDecision(
      db,
      { roundId: round.id, approverId: akshay.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
    await db.approvalRound.update({
      where: { id: round.id },
      data: { stageEnteredAt: new Date(Date.now() - 25 * 3_600_000) },
    });

    sentMail.length = 0;
    await runApprovalReminders(db);
    const mitulEmail = (await db.user.findUniqueOrThrow({ where: { id: mitul.id } })).email;
    const akshayEmail = (await db.user.findUniqueOrThrow({ where: { id: akshay.id } })).email;
    const recipients = sentMail.flatMap((m) => [m.to].flat());
    expect(recipients).toContain(mitulEmail);
    expect(recipients).not.toContain(akshayEmail);
  });
});

describe("the approval queue and history", () => {
  it("lists only what is waiting on that approver", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());

    const forAkshay = await pendingForApprover(db, akshay.id);
    expect(forAkshay.some((r) => r.id === round.id)).toBe(true);
    // Amit is a stage 2 approver, so it is not his turn yet.
    expect((await pendingForApprover(db, amit.id)).some((r) => r.id === round.id)).toBe(false);

    await recordDecision(
      db,
      { roundId: round.id, approverId: akshay.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
    // Having decided, it leaves his queue.
    expect((await pendingForApprover(db, akshay.id)).some((r) => r.id === round.id)).toBe(false);
    expect((await pendingForApprover(db, mitul.id)).some((r) => r.id === round.id)).toBe(true);
  });

  it("keeps every decision in the history, with who, when and why", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    await recordDecision(
      db,
      { roundId: round.id, approverId: akshay.id, decision: "REJECT", comment: "Not this quarter", channel: "EMAIL" },
      meta(),
    );

    const history = await getApprovalHistory(db, event.id);
    expect(history).toHaveLength(1);
    expect(history[0].decisions[0]).toMatchObject({
      decision: "REJECT",
      comment: "Not this quarter",
      channel: "EMAIL",
    });

    const audit = await db.auditLog.findFirst({ where: { entityId: event.id, action: "approval.reject" } });
    expect(audit?.summary).toContain("Not this quarter");
  });
});

describe("reopening an approved event", () => {
  it("sends it back to scheduling and requires approval again", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    for (const approver of [akshay, mitul, amit]) {
      await recordDecision(
        db,
        { roundId: round.id, approverId: approver.id, decision: "APPROVE", channel: "PORTAL" },
        meta(),
      );
    }

    await reopenForChanges(db, requester, event.id, "Venue changed, costs need revising", meta());
    const reopened = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(reopened.lifecycleStatus).toBe("SCHEDULING");
    expect(reopened.approvalStatus).toBe("CHANGES_REQUESTED");

    // Editable again, and a resubmission creates a second round.
    expect(await saveAnswers(db, requester, event.id, { "basic.city": "Surat" }, meta())).toEqual({ ok: true });
    await submitForApproval(db, requester, event.id, meta());
    expect(await db.approvalRound.count({ where: { eventId: event.id } })).toBe(2);
  });
});
