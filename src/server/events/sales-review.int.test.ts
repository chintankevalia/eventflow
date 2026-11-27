import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, makeActor, meta, sentMail, uid } from "../../../tests/integration/helpers";
import { createEventType } from "../config/event-types";
import { submitForApproval } from "../approvals/engine";
import { canReviewForSales, notifySalesReviewers, saveSalesReview } from "./sales-review";
import { createEvent, moveToScheduling } from "./service";

let admin: Awaited<ReturnType<typeof makeActor>>;
let requester: { id: string; name: string; roles: string[]; department: "MARKETING" };
let seller: { id: string; name: string; email: string; roles: string[]; department: "SALES" };
let typeId: string;

const fullAnswers = {
  eventKind: "end_customer",
  goal: "new_leads",
  city: "Pune",
  date: "2026-12-10",
  format: "physical",
  expectedAccounts: "30",
  newAccounts: "10",
  designations: "CIO",
  qualifiedLeads: "8",
  leadsBasis: "Similar meet last year",
  opportunities: "3",
  pipelineUsd: "90000",
  revenueUsd: "30000",
  closeMonths: "6",
  costPerHead: "4000",
  totalCost: "120000",
  motadataShare: "60000",
  travelPresales: "One presales engineer",
  loseAccess: "partly",
  icpQuality: "4",
  dealSize: "4",
  brandValue: "3",
  salesCommitment: "4",
  costEfficiency: "3",
};

beforeAll(async () => {
  admin = await makeActor();
  typeId = (await createEventType(db, admin, { name: `Sales gate ${uid()}`, needsPartner: false }, meta())).id;
  const mk = async (department: "SALES" | "MARKETING", label: string) =>
    db.user.create({
      data: {
        name: `${label} ${uid()}`,
        email: `${label.toLowerCase()}.${uid()}@eventflow.test`,
        roles: ["REQUESTER"],
        department,
        status: "ACTIVE",
      },
    });
  const r = await mk("MARKETING", "Requester");
  requester = { id: r.id, name: r.name, roles: r.roles, department: "MARKETING" };
  const s = await mk("SALES", "Seller");
  seller = { id: s.id, name: s.name, email: s.email, roles: s.roles, department: "SALES" };
});

beforeEach(() => {
  sentMail.length = 0;
});

afterAll(() => db.$disconnect());

const draft = () => createEvent(db, requester, { eventTypeId: typeId, title: `Gate ${uid()}`, department: "MARKETING" }, meta());

describe("the Sales gate", () => {
  it("every new event starts waiting for Sales, with an open review", async () => {
    const event = await createEvent(
      db,
      requester,
      { eventTypeId: typeId, title: `Gate ${uid()}`, department: "MARKETING" },
      meta(),
    );
    expect(event.salesReviewStatus).toBe("PENDING");
    const review = await db.salesReview.findUnique({ where: { eventId: event.id } });
    expect(review?.decision).toBe("PENDING");
  });

  it("blocks Scheduling and approval until Sales says Go", async () => {
    const event = await draft();
    await expect(moveToScheduling(db, requester, event.id, meta())).rejects.toThrow(/Sales/);
    await expect(submitForApproval(db, requester, event.id, meta())).rejects.toThrow(/Sales/);
  });

  it("emails everyone in Sales about a new event", async () => {
    const event = await draft();
    await notifySalesReviewers(db, event.id);
    const mail = sentMail.find((m) => m.subject.includes("Sales review needed"));
    expect([mail?.to].flat()).toContain(seller.email);
  });

  it("only Sales (or an admin) may review", async () => {
    expect(canReviewForSales(requester)).toBe(false);
    expect(canReviewForSales(seller)).toBe(true);
    expect(canReviewForSales({ id: "x", roles: ["ADMIN"], department: "MARKETING" })).toBe(true);
    const event = await draft();
    await expect(
      saveSalesReview(db, requester, event.id, { answers: fullAnswers, decision: "GO" }, meta()),
    ).rejects.toThrow(/Only the Sales team/);
  });

  it("saving keeps the review open; Go needs every answer", async () => {
    const event = await draft();
    await saveSalesReview(db, seller, event.id, { answers: { goal: "new_leads" }, decision: "SAVE" }, meta());
    expect((await db.event.findUniqueOrThrow({ where: { id: event.id } })).salesReviewStatus).toBe("PENDING");
    await expect(
      saveSalesReview(db, seller, event.id, { answers: { goal: "new_leads" }, decision: "GO" }, meta()),
    ).rejects.toThrow(/Still missing/);
  });

  it("Go unlocks Scheduling, records the score and tells the requester", async () => {
    const event = await draft();
    const result = await saveSalesReview(db, seller, event.id, { answers: fullAnswers, decision: "GO" }, meta());
    expect(result.total).toBe(18);
    const review = await db.salesReview.findUniqueOrThrow({ where: { eventId: event.id } });
    expect(review).toMatchObject({ decision: "GO", totalScore: 18, reviewedById: seller.id });
    expect(sentMail.some((m) => m.subject.startsWith("Go from Sales"))).toBe(true);

    const moved = await moveToScheduling(db, requester, event.id, meta());
    expect(moved.lifecycleStatus).toBe("SCHEDULING");
    await expect(
      saveSalesReview(db, seller, event.id, { answers: fullAnswers, decision: "NO_GO", comment: "Changed my mind" }, meta()),
    ).rejects.toThrow(/already decided/);
  });

  it("No-go needs a reason and drops the event with it", async () => {
    const event = await draft();
    await expect(
      saveSalesReview(db, seller, event.id, { answers: {}, decision: "NO_GO" }, meta()),
    ).rejects.toThrow(/reason/);
    await saveSalesReview(
      db,
      seller,
      event.id,
      { answers: {}, decision: "NO_GO", comment: "Audience is reachable at our own roadshow." },
      meta(),
    );
    const after = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.salesReviewStatus).toBe("NO_GO");
    expect(after.lifecycleStatus).toBe("DROPPED");
    expect(after.droppedReason).toMatch(/Sales No-go: Audience is reachable/);
  });
});

describe("Sales can only review, never edit", () => {
  it("canEditEvent refuses a Sales user even on an event they raised", async () => {
    const { canEditEvent } = await import("./service");
    const ev = { requesterId: seller.id, ownerId: seller.id, managerId: null };
    expect(canEditEvent(seller, ev)).toBe(false);
    expect(canEditEvent({ id: "x", roles: ["ADMIN"], department: "SALES" }, ev)).toBe(true);
  });
});
