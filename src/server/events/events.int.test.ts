import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, makeActor, meta, salesGo, uid } from "../../../tests/integration/helpers";
import { createEventType } from "../config/event-types";
import { createLookupItem, type Actor } from "../config/lookups";
import { setFieldRule } from "../config/form-fields";
import { createOrganization } from "../organizations/service";
import { createTemplate } from "../templates/service";
import { nextEventCode } from "./codes";
import { attachFile } from "./attachments";
import { addCostLine, addTask, addTaskDependency, removeCostLine, updateCostLine, updateTask } from "./parts";
import {
  checkCompleteness,
  closeEvent,
  createEvent,
  dropEvent,
  EventError,
  getEvent,
  moveToExecution,
  moveToScheduling,
  saveAnswers,
} from "./service";

let actor: Actor;
let customerTypeId: string;
let partnerTypeId: string;
let goldOrgId: string;
let categoryId: string;

beforeAll(async () => {
  actor = await makeActor();
  customerTypeId = (await createEventType(db, actor, { name: `Customer ${uid()}`, needsPartner: false }, meta())).id;
  partnerTypeId = (await createEventType(db, actor, { name: `Partner meet ${uid()}`, needsPartner: true }, meta())).id;

  // Dropdowns can only accept values that exist in their lookup list.
  await db.lookupItem.upsert({
    where: { kind_value: { kind: "EVENT_FORMAT", value: "physical" } },
    update: { active: true },
    create: { kind: "EVENT_FORMAT", value: "physical", label: "Physical" },
  });
  await db.lookupItem.upsert({
    where: { kind_value: { kind: "PRODUCT_FOCUS", value: "both" } },
    update: { active: true },
    create: { kind: "PRODUCT_FOCUS", value: "both", label: "Both" },
  });

  const tier = await createLookupItem(db, actor, "PARTNER_TIER", { label: `Gold ${uid()}` }, meta());
  const org = await createOrganization(
    db,
    actor,
    { type: "PARTNER", name: `Partner ${uid()}`, tierId: tier.id },
    meta(),
  );
  goldOrgId = org.id;
  categoryId = (await db.expenseCategory.create({ data: { name: `Venue ${uid()}` } })).id;
});

afterAll(() => db.$disconnect());

/** A draft Sales has already cleared, for tests about what comes after the Sales gate. */
const newEvent = async (over: Record<string, unknown> = {}) =>
  salesGo(
    await createEvent(
      db,
      actor,
      { eventTypeId: customerTypeId, title: `Test event ${uid()}`, department: "MARKETING", ...over },
      meta(),
    ),
  );

describe("event codes", () => {
  it("are sequential and unique, even when generated at the same moment", async () => {
    const codes = await Promise.all(Array.from({ length: 10 }, () => nextEventCode(db)));
    expect(new Set(codes).size).toBe(10);
    const year = new Date().getFullYear();
    for (const code of codes) expect(code).toMatch(new RegExp(`^EF-${year}-\\d{4}$`));

    const serials = codes.map((c) => Number(c.split("-")[2])).sort((a, b) => a - b);
    expect(serials[serials.length - 1] - serials[0]).toBe(9);
  });
});

describe("creating an event", () => {
  it("starts as a draft with a code and the creator as owner", async () => {
    const event = await newEvent();
    expect(event.code).toMatch(/^EF-\d{4}-\d{4}$/);
    expect(event.lifecycleStatus).toBe("DRAFT");
    expect(event.approvalStatus).toBe("NOT_SUBMITTED");
    expect(event.ownerId).toBe(actor.id);
    expect(event.requesterId).toBe(actor.id);
    expect(await db.auditLog.findFirst({ where: { entityId: event.id, action: "event.created" } })).not.toBeNull();
  });

  it("captures the partner's tier at the time of selection", async () => {
    const event = await newEvent({ eventTypeId: partnerTypeId, partnerOrgId: goldOrgId });
    expect(event.partnerTier).toMatch(/^gold_/);
  });

  it("refuses a partner on an event type that involves none", async () => {
    await expect(newEvent({ partnerOrgId: goldOrgId })).rejects.toBeInstanceOf(EventError);
  });

  it("refuses an unknown event type and a too-short name", async () => {
    await expect(newEvent({ eventTypeId: "nope" })).rejects.toBeInstanceOf(EventError);
    await expect(newEvent({ title: "ab" })).rejects.toThrow();
  });

  it("seeds answers, cost lines and tasks from a template", async () => {
    const template = await createTemplate(
      db,
      actor,
      {
        name: `Seeded ${uid()}`,
        eventTypeId: customerTypeId,
        answers: { "basic.city": "Pune", "basic.targetAudience": "CIOs" },
        costLines: [{ description: "Venue hire", categoryId, estimated: 50000 }],
        tasks: [{ title: "Book the venue", offsetDays: -30 }],
      },
      meta(),
    );

    const event = await newEvent({ templateId: template.id });
    const full = await getEvent(db, event.id);
    expect((full!.answers as Record<string, unknown>)["basic.city"]).toBe("Pune");
    expect(full!.city).toBe("Pune");
    expect(full!.costLines.map((l) => l.description)).toEqual(["Venue hire"]);
    expect(full!.tasks.map((t) => t.title)).toEqual(["Book the venue"]);
    expect(Number(full!.estimatedCost)).toBe(50000);
    expect(full!.templateId).toBe(template.id);
  });

  it("refuses a template belonging to a different event type", async () => {
    const template = await createTemplate(db, actor, { name: `Other ${uid()}`, eventTypeId: partnerTypeId }, meta());
    await expect(newEvent({ templateId: template.id })).rejects.toBeInstanceOf(EventError);
  });
});

describe("saving answers", () => {
  it("saves one section without clearing the others", async () => {
    const event = await newEvent();
    await saveAnswers(db, actor, event.id, { "basic.city": "Mumbai" }, meta());
    await saveAnswers(db, actor, event.id, { "budget.expectedRoi": "3 new logos" }, meta());

    const after = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    const answers = after.answers as Record<string, unknown>;
    expect(answers["basic.city"]).toBe("Mumbai");
    expect(answers["budget.expectedRoi"]).toBe("3 new logos");
    expect(after.city).toBe("Mumbai");
  });

  it("clears a value when the field is submitted empty", async () => {
    const event = await newEvent();
    await saveAnswers(db, actor, event.id, { "basic.city": "Delhi" }, meta());
    await saveAnswers(db, actor, event.id, { "basic.city": "" }, meta());
    const after = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.city).toBeNull();
  });

  it("returns field errors instead of saving bad values", async () => {
    const event = await newEvent();
    const result = await saveAnswers(db, actor, event.id, { "basic.proposedDate": "20-11-2026" }, meta());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["basic.proposedDate"]).toMatch(/valid date/i);
  });

  it("records what changed in the audit log", async () => {
    const event = await newEvent();
    await saveAnswers(db, actor, event.id, { "basic.city": "Chennai" }, meta());
    const audit = await db.auditLog.findFirst({
      where: { entityId: event.id, action: "event.answers_saved" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.summary).toContain("City");
    expect((audit?.after as Record<string, unknown>)["basic.city"]).toBe("Chennai");
  });

  it("refuses edits once the event is locked", async () => {
    const event = await newEvent();
    await db.event.update({ where: { id: event.id }, data: { lifecycleStatus: "PENDING_APPROVAL" } });
    await expect(saveAnswers(db, actor, event.id, { "basic.city": "X" }, meta())).rejects.toThrow(/with approvers/i);
  });

  it("allows post-event section to be saved in IN_EXECUTION and mirrors to PostEventResult", async () => {
    const event = await newEvent();
    await db.event.update({ where: { id: event.id }, data: { lifecycleStatus: "IN_EXECUTION" } });
    const result = await saveAnswers(
      db,
      actor,
      event.id,
      { "post.actualAttendance": "80", "post.actualRoi": "2x revenue", "post.sqls": "5" },
      meta(),
    );
    expect(result.ok).toBe(true);
    const per = await db.postEventResult.findUnique({ where: { eventId: event.id } });
    expect(per?.actualAttendance).toBe(80);
    expect(per?.actualRoi).toBe("2x revenue");
    expect(per?.sqls).toBe(5);
  });
});

describe("lifecycle", () => {
  it("moves a draft to scheduling once only", async () => {
    const event = await newEvent();
    expect((await moveToScheduling(db, actor, event.id, meta())).lifecycleStatus).toBe("SCHEDULING");
    await expect(moveToScheduling(db, actor, event.id, meta())).rejects.toBeInstanceOf(EventError);
  });

  it("drops an event with a reason and keeps its history", async () => {
    const event = await newEvent();
    const dropped = await dropEvent(db, actor, event.id, "Budget pulled for the quarter", meta());
    expect(dropped.lifecycleStatus).toBe("DROPPED");
    expect(dropped.droppedReason).toBe("Budget pulled for the quarter");
    expect(await db.event.findUnique({ where: { id: event.id } })).not.toBeNull();
    await expect(dropEvent(db, actor, event.id, "x", meta())).rejects.toThrow();
  });

  it("refuses to move to execution unless the event is APPROVED", async () => {
    const event = await newEvent();
    await expect(moveToExecution(db, actor, event.id, meta())).rejects.toThrow(/Approved/);
    await moveToScheduling(db, actor, event.id, meta());
    await expect(moveToExecution(db, actor, event.id, meta())).rejects.toThrow(/Approved/);
  });

  it("moves an APPROVED event to IN_EXECUTION", async () => {
    const event = await newEvent();
    // Force to APPROVED directly (bypass full approval engine).
    await db.event.update({ where: { id: event.id }, data: { lifecycleStatus: "APPROVED" } });
    const exec = await moveToExecution(db, actor, event.id, meta());
    expect(exec.lifecycleStatus).toBe("IN_EXECUTION");
  });

  it("refuses to close an event that is not IN_EXECUTION", async () => {
    const event = await newEvent();
    await expect(closeEvent(db, actor, event.id, meta())).rejects.toThrow(/In Execution/);
  });

  it("refuses to close if post-event results are incomplete", async () => {
    const event = await newEvent();
    await db.event.update({ where: { id: event.id }, data: { lifecycleStatus: "IN_EXECUTION" } });
    await expect(closeEvent(db, actor, event.id, meta())).rejects.toThrow(/Actual attendance/);
  });

  it("closes an IN_EXECUTION event once post-event results are present", async () => {
    const event = await newEvent();
    await db.event.update({ where: { id: event.id }, data: { lifecycleStatus: "IN_EXECUTION" } });
    await db.postEventResult.create({ data: { eventId: event.id, actualAttendance: 50, actualRoi: "3x" } });
    const closed = await closeEvent(db, actor, event.id, meta());
    expect(closed.lifecycleStatus).toBe("CLOSED");
  });

  it("does not allow dropping a closed event", async () => {
    const event = await newEvent();
    await db.event.update({ where: { id: event.id }, data: { lifecycleStatus: "CLOSED" } });
    await expect(dropEvent(db, actor, event.id, "Reason", meta())).rejects.toThrow(/closed/i);
  });
});

describe("completeness before approval", () => {
  it("reports what is missing, and clears once filled in", async () => {
    const event = await newEvent();
    const first = await checkCompleteness(db, event.id);
    expect(first.complete).toBe(false);
    // An issue carries where to fix it as well as what is wrong, so the submission checklist can
    // group them by section and link straight to the right tab.
    expect(first.issues["costLines"]).toMatchObject({
      message: expect.stringMatching(/expense line/i),
      section: "BUDGET",
      tab: "budget",
    });
    expect(Object.keys(first.issues)).toContain("basic.proposedDate");

    const saved = await saveAnswers(
      db,
      actor,
      event.id,
      {
        "basic.name": "Complete event",
        "basic.objective": "Generate pipeline",
        "basic.proposedDate": "2026-12-01",
        "basic.format": "physical",
        "basic.productFocus": "both",
        "budget.expectedRoi": "5 opportunities",
      },
      meta(),
    );
    expect(saved).toEqual({ ok: true });
    await addCostLine(db, actor, event.id, { description: "Venue", estimated: "25000" }, meta());

    const second = await checkCompleteness(db, event.id);
    expect(second.issues).toEqual({});
    expect(second.complete).toBe(true);
  });

  it("does not ask for post-event answers at submission time", async () => {
    const event = await newEvent();
    await setFieldRule(
      db,
      actor,
      { eventTypeId: customerTypeId, fieldKey: "post.newLeads", tierValue: "", required: true, visible: true },
      meta(),
    );
    const result = await checkCompleteness(db, event.id);
    expect(Object.keys(result.issues)).not.toContain("post.newLeads");
  });
});

describe("cost lines", () => {
  it("rolls estimates and actuals up to the event", async () => {
    const event = await newEvent();
    const a = await addCostLine(db, actor, event.id, { description: "Venue", estimated: "40000", categoryId }, meta());
    await addCostLine(db, actor, event.id, { description: "Catering", estimated: "15000" }, meta());

    let totals = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(Number(totals.estimatedCost)).toBe(55000);

    // Actuals are recorded once the event is approved.
    await db.event.update({ where: { id: event.id }, data: { lifecycleStatus: "IN_EXECUTION" } });
    await updateCostLine(db, actor, a.id, { actual: "42500", invoiceStatus: "PAID" }, meta());
    totals = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(Number(totals.actualCost)).toBe(42500);
  });

  it("recalculates when a line is removed", async () => {
    const event = await newEvent();
    const line = await addCostLine(db, actor, event.id, { description: "Swag", estimated: "10000" }, meta());
    await removeCostLine(db, actor, line.id, meta());
    expect(Number((await db.event.findUniqueOrThrow({ where: { id: event.id } })).estimatedCost)).toBe(0);
  });

  it("will not add plan costs to a locked event, but still accepts actuals", async () => {
    const event = await newEvent();
    const line = await addCostLine(db, actor, event.id, { description: "Venue", estimated: "1000" }, meta());
    await db.event.update({ where: { id: event.id }, data: { lifecycleStatus: "IN_EXECUTION" } });

    await expect(addCostLine(db, actor, event.id, { description: "Late", estimated: "1" }, meta())).rejects.toThrow();
    await expect(updateCostLine(db, actor, line.id, { actual: "900" }, meta())).resolves.toBeTruthy();
  });

  it("rejects a negative or unknown category", async () => {
    const event = await newEvent();
    await expect(addCostLine(db, actor, event.id, { description: "Bad", estimated: "-5" }, meta())).rejects.toThrow();
    await expect(
      addCostLine(db, actor, event.id, { description: "Bad", categoryId: "missing" }, meta()),
    ).rejects.toBeInstanceOf(EventError);
  });

  it("still accepts actuals, invoice and payment once the event is Closed", async () => {
    // Payment is usually settled after the event, not on the day it happens, so this has to stay
    // open past IN_EXECUTION — it was the one lifecycle stage this was missing from.
    const event = await newEvent();
    const line = await addCostLine(db, actor, event.id, { description: "Venue", estimated: "5000" }, meta());
    await db.event.update({ where: { id: event.id }, data: { lifecycleStatus: "CLOSED" } });

    const updated = await updateCostLine(
      db,
      actor,
      line.id,
      { actual: "4800", invoiceRef: "INV-2201", invoiceStatus: "PAID", paymentStatus: "PAID" },
      meta(),
    );
    expect(updated).toMatchObject({ invoiceRef: "INV-2201", invoiceStatus: "PAID", paymentStatus: "PAID" });
    expect(Number(updated.actual)).toBe(4800);

    // Still locked for plan fields — Closed is not a stage where the budget line itself changes.
    // The call resolves (Closed is still an executionStage, so it is not refused outright), but
    // the plan field is quietly not written, exactly as it already behaves in IN_EXECUTION.
    await updateCostLine(db, actor, line.id, { estimated: "1" }, meta());
    const unchanged = await db.costLineItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(Number(unchanged.estimated)).toBe(5000);
  });
});

describe("per-line invoice attachments", () => {
  it("attaches an invoice to one specific budget line, and it is readable back from the line", async () => {
    const event = await newEvent();
    const line = await addCostLine(db, actor, event.id, { description: "Venue", estimated: "5000" }, meta());
    await db.event.update({ where: { id: event.id }, data: { lifecycleStatus: "APPROVED" } });

    const file = Buffer.from("%PDF-1.4 fake invoice content");
    const attachment = await attachFile(
      db,
      actor,
      event.id,
      { name: "invoice.pdf", type: "application/pdf", bytes: file },
      "INVOICE",
      meta(),
      line.id,
    );
    expect(attachment.costLineId).toBe(line.id);
    expect(attachment.kind).toBe("INVOICE");

    const withInvoices = await db.costLineItem.findUniqueOrThrow({
      where: { id: line.id },
      include: { invoices: true },
    });
    expect(withInvoices.invoices.map((a) => a.id)).toEqual([attachment.id]);
  });

  it("refuses a cost line that belongs to a different event", async () => {
    const eventA = await newEvent();
    const eventB = await newEvent();
    const lineOnB = await addCostLine(db, actor, eventB.id, { description: "Catering", estimated: "2000" }, meta());

    await expect(
      attachFile(
        db,
        actor,
        eventA.id,
        { name: "invoice.pdf", type: "application/pdf", bytes: Buffer.from("x") },
        "INVOICE",
        meta(),
        lineOnB.id,
      ),
    ).rejects.toBeInstanceOf(EventError);
  });

  it("leaves a general attachment's costLineId null", async () => {
    const event = await newEvent();
    const attachment = await attachFile(
      db,
      actor,
      event.id,
      { name: "proposal.pdf", type: "application/pdf", bytes: Buffer.from("x") },
      "PROPOSAL",
      meta(),
    );
    expect(attachment.costLineId).toBeNull();
  });
});

describe("tasks", () => {
  it("blocks starting a task until what it waits for is done", async () => {
    const event = await newEvent();
    const venue = await addTask(db, actor, event.id, { title: "Book venue" }, meta());
    const invites = await addTask(db, actor, event.id, { title: "Send invites" }, meta());
    await addTaskDependency(db, invites.id, venue.id);

    await expect(updateTask(db, actor, invites.id, { status: "IN_PROGRESS" }, meta())).rejects.toThrow(/Book venue/);

    await updateTask(db, actor, venue.id, { status: "DONE" }, meta());
    expect((await updateTask(db, actor, invites.id, { status: "IN_PROGRESS" }, meta())).status).toBe("IN_PROGRESS");
  });

  it("refuses dependencies that would loop", async () => {
    const event = await newEvent();
    const a = await addTask(db, actor, event.id, { title: "Task A" }, meta());
    const b = await addTask(db, actor, event.id, { title: "Task B" }, meta());
    const c = await addTask(db, actor, event.id, { title: "Task C" }, meta());
    await addTaskDependency(db, b.id, a.id);
    await addTaskDependency(db, c.id, b.id);

    await expect(addTaskDependency(db, a.id, c.id)).rejects.toThrow(/circular/i);
    await expect(addTaskDependency(db, a.id, a.id)).rejects.toThrow(/itself/i);
  });

  it("will not link tasks across different events", async () => {
    const one = await newEvent();
    const two = await newEvent();
    const a = await addTask(db, actor, one.id, { title: "Task A" }, meta());
    const b = await addTask(db, actor, two.id, { title: "Task B" }, meta());
    await expect(addTaskDependency(db, a.id, b.id)).rejects.toThrow(/same event/i);
  });
});
