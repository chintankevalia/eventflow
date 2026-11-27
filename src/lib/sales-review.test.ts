import { describe, expect, it } from "vitest";
import { missingForDecision, salesReviewAnswersSchema, scoreBand, totalScore } from "./sales-review";

const complete = {
  eventKind: "partner",
  goal: "new_leads",
  city: "Mumbai",
  date: "2026-12-10",
  format: "physical",
  expectedAccounts: "40",
  newAccounts: "15",
  designations: "CIO, IT Head",
  qualifiedLeads: "12",
  leadsBasis: "Last year's Pune meet",
  opportunities: "4",
  pipelineUsd: "120000",
  revenueUsd: "40000",
  closeMonths: "6",
  costPerHead: "3500",
  totalCost: "140000",
  motadataShare: "70000",
  travelPresales: "Two presales engineers, one day",
  loseAccess: "partly",
  icpQuality: "4",
  dealSize: "3",
  brandValue: "4",
  salesCommitment: "5",
  costEfficiency: "3",
};

describe("sales review", () => {
  it("parses form strings into numbers and totals the matrix", () => {
    const answers = salesReviewAnswersSchema.parse(complete);
    expect(answers.expectedAccounts).toBe(40);
    expect(answers.pipelineUsd).toBe(120000);
    expect(totalScore(answers)).toBe(19);
    expect(missingForDecision(answers)).toEqual([]);
  });

  it("past results and the explain notes are optional; everything else is needed for Go", () => {
    const answers = salesReviewAnswersSchema.parse({ ...complete, leadsBasis: "", icpQuality: "" });
    expect(totalScore(answers)).toBeNull();
    expect(missingForDecision(answers)).toEqual(["5. Lead estimate", "11. Decision matrix"]);
  });

  it("rejects scores outside 1–5 and unknown choices", () => {
    expect(salesReviewAnswersSchema.safeParse({ dealSize: "6" }).success).toBe(false);
    expect(salesReviewAnswersSchema.safeParse({ goal: "fun" }).success).toBe(false);
    expect(salesReviewAnswersSchema.safeParse({ expectedAccounts: "-1" }).success).toBe(false);
  });

  it("bands the score as guidance", () => {
    expect(scoreBand(null).label).toBe("Not scored yet");
    expect(scoreBand(19).tone).toBe("success");
    expect(scoreBand(14).tone).toBe("warning");
    expect(scoreBand(9).tone).toBe("danger");
  });
});
