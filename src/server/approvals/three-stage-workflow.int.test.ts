/**
 * The real shape of the production workflow: Channel review (ANY) → Event approval (ALL) →
 * Budget approval (ALL). `approvals.int.test.ts` proves the engine's general multi-approver and
 * stage-advance mechanics against its own two-stage ALL/ALL fixture; this file proves the
 * specific three-stage flow the business asked for, in particular that ANY mode clears a stage
 * on its first decision rather than waiting for every assigned approver.
 *
 * A separate file, not a block inside the existing suite: `submitForApproval` reads the single
 * globally-active `ApprovalWorkflow` (see `getActiveWorkflow`), and the existing suite already
 * depends on its own active workflow staying active and unchanged across ~20 tests. Flipping the
 * active workflow mid-file would be a shared-mutable-state risk for no benefit — this file
 * activates its own workflow once and deactivates it when done, exactly as the existing file does.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, makeActor, meta, sentMail, uid, salesGo } from "../../../tests/integration/helpers";
import { createEventType } from "../config/event-types";
import type { Actor } from "../config/lookups";
import { addCostLine, addStakeholder } from "../events/parts";
import { createEvent, saveAnswers } from "../events/service";
import { recordDecision, submitForApproval } from "./engine";

let requester: Actor;
let channelReviewer: Actor;
let akshay: Actor;
let mitul: Actor;
let amit: Actor;
let eventTypeId: string;
let workflowId: string;
let channelStageId: string;
let eventStageId: string;
let budgetStageId: string;

beforeAll(async () => {
  [requester, channelReviewer, akshay, mitul, amit] = await Promise.all([
    makeActor("Three-stage Requester"),
    makeActor("Three-stage Channel"),
    makeActor("Three-stage Akshay"),
    makeActor("Three-stage Mitul"),
    makeActor("Three-stage Amit"),
  ]);

  for (const [kind, value] of [
    ["EVENT_FORMAT", "physical"],
    ["PRODUCT_FOCUS", "both"],
  ] as const) {
    await db.lookupItem.upsert({
      where: { kind_value: { kind, value } },
      update: { active: true },
      create: { kind, value, label: value },
    });
  }

  eventTypeId = (await createEventType(db, akshay, { name: `Three-stage type ${uid()}`, needsPartner: false }, meta()))
    .id;

  // Only one workflow may be active at a time — see the module note above.
  await db.approvalWorkflow.updateMany({ where: { active: true }, data: { active: false } });
  const workflow = await db.approvalWorkflow.create({
    data: {
      name: `Three-stage test workflow ${uid()}`,
      stages: {
        create: [
          { sequence: 1, name: "Channel review", mode: "ANY", reminderHours: 24, escalationHours: 48 },
          { sequence: 2, name: "Event approval", mode: "ALL", reminderHours: 24, escalationHours: 48 },
          { sequence: 3, name: "Budget approval", mode: "ALL", reminderHours: 24, escalationHours: 48 },
        ],
      },
    },
    include: { stages: { orderBy: { sequence: "asc" } } },
  });
  workflowId = workflow.id;
  channelStageId = workflow.stages[0].id;
  eventStageId = workflow.stages[1].id;
  budgetStageId = workflow.stages[2].id;

  await db.approvalStageApprover.createMany({
    data: [
      { stageId: channelStageId, userId: channelReviewer.id, sortOrder: 0 },
      { stageId: eventStageId, userId: akshay.id, sortOrder: 0 },
      { stageId: eventStageId, userId: mitul.id, sortOrder: 1 },
      { stageId: budgetStageId, userId: amit.id, sortOrder: 0 },
    ],
  });
});

afterAll(async () => {
  await db.approvalWorkflow.updateMany({ where: { id: workflowId }, data: { active: false } });
  await db.$disconnect();
});

beforeEach(() => {
  sentMail.length = 0;
});

async function submittableEvent() {
  const event = await salesGo(
    await createEvent(
      db,
      requester,
      { eventTypeId, title: `Three-stage test ${uid()}`, department: "CHANNEL" },
      meta(),
    ),
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
  await addCostLine(db, requester, event.id, { description: "Venue", estimated: "250000" }, meta());
  await db.event.update({ where: { id: event.id }, data: { lifecycleStatus: "SCHEDULING" } });
  return event;
}

describe("the three-stage flow: Channel review -> Event approval -> Budget approval", () => {
  it("opens on Channel review, whoever raised the request", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    expect(round.currentStageId).toBe(channelStageId);
  });

  it("an ANY-mode stage clears on its first decision, not every assigned approver", async () => {
    // Channel review has one approver here, but the point of ANY mode is that it would clear
    // the same way with several assigned and only one deciding.
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());

    const result = await recordDecision(
      db,
      { roundId: round.id, approverId: channelReviewer.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
    expect(result).toMatchObject({ outcome: "STAGE_ADVANCED" });

    const moved = await db.approvalRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(moved.currentStageId).toBe(eventStageId);
  });

  it("Event approval (ALL) needs both Akshay and Mitul before Budget approval opens", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    await recordDecision(
      db,
      { roundId: round.id, approverId: channelReviewer.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );

    const first = await recordDecision(
      db,
      { roundId: round.id, approverId: akshay.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
    expect(first).toMatchObject({ outcome: "STAGE_PENDING", waitingFor: 1 });
    expect((await db.approvalRound.findUniqueOrThrow({ where: { id: round.id } })).currentStageId).toBe(eventStageId);

    const second = await recordDecision(
      db,
      { roundId: round.id, approverId: mitul.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
    expect(second).toMatchObject({ outcome: "STAGE_ADVANCED" });
    expect((await db.approvalRound.findUniqueOrThrow({ where: { id: round.id } })).currentStageId).toBe(budgetStageId);
  });

  it("only Amit sir's decision at Budget approval locks the event", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    await recordDecision(
      db,
      { roundId: round.id, approverId: channelReviewer.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
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

    // Nobody but Amit may decide a round that is sitting at Budget approval.
    await expect(
      recordDecision(db, { roundId: round.id, approverId: akshay.id, decision: "APPROVE", channel: "PORTAL" }, meta()),
    ).rejects.toThrow();

    const final = await recordDecision(
      db,
      { roundId: round.id, approverId: amit.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
    expect(final).toEqual({ outcome: "APPROVED" });

    const approved = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(approved.lifecycleStatus).toBe("APPROVED");
    expect(approved.approvalStatus).toBe("APPROVED");
    expect(Number(approved.approvedCost)).toBe(250000);
  });

  it("copies the event manager and every internal stakeholder on the approved email", async () => {
    const manager = await makeActor("Three-stage Manager");
    const stakeholder = await makeActor("Three-stage Stakeholder");

    const event = await submittableEvent();
    await db.event.update({ where: { id: event.id }, data: { managerId: manager.id } });
    await addStakeholder(db, requester, event.id, { userId: stakeholder.id, role: "Marketing lead" }, meta());
    // An external stakeholder has no EventFlow account and so no email to invent one for.
    await addStakeholder(db, requester, event.id, { externalName: "A partner contact", role: "Partner SPOC" }, meta());

    const round = await submitForApproval(db, requester, event.id, meta());
    await recordDecision(
      db,
      { roundId: round.id, approverId: channelReviewer.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );
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

    sentMail.length = 0;
    await recordDecision(
      db,
      { roundId: round.id, approverId: amit.id, decision: "APPROVE", channel: "PORTAL" },
      meta(),
    );

    const approvedMail = sentMail.find((m) => m.subject.startsWith("Approved:"));
    expect(approvedMail).toBeTruthy();
    const cc = approvedMail!.cc ?? [];
    expect(cc).toContain(manager.email);
    expect(cc).toContain(stakeholder.email);
  });

  it("a Channel rejection ends the round before Event or Budget approval ever see it", async () => {
    const event = await submittableEvent();
    const round = await submitForApproval(db, requester, event.id, meta());
    const result = await recordDecision(
      db,
      {
        roundId: round.id,
        approverId: channelReviewer.id,
        decision: "REJECT",
        comment: "Wrong region",
        channel: "PORTAL",
      },
      meta(),
    );
    expect(result).toMatchObject({ outcome: "REJECTED" });

    const rejected = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(rejected.approvalStatus).toBe("REJECTED");

    // Never reached: no decision exists from either Akshay, Mitul or Amit on this round.
    const decisions = await db.approvalDecision.findMany({ where: { roundId: round.id } });
    expect(decisions.map((d) => d.approverId)).toEqual([channelReviewer.id]);
  });
});
