/**
 * Sales' business case for an event — asked as soon as a draft is saved, before any planning.
 * Sales answers eleven questions and scores five factors, then decides Go or No-go. A Go unlocks
 * Scheduling; a No-go drops the event with Sales' reason (history kept).
 *
 * Pure and shared by the server (validation) and the form (rendering), so the two never disagree.
 */
import { z } from "zod";

export type SalesQuestionField =
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[] }
  | { key: string; label: string; type: "int" | "money"; unit?: string }
  | { key: string; label: string; type: "date" | "text" | "textarea" };

export type SalesQuestion = { n: number; title: string; prompt: string; fields: SalesQuestionField[] };

export const SALES_REVIEW_QUESTIONS: SalesQuestion[] = [
  {
    n: 1,
    title: "Type of event",
    prompt: "What type of event is it?",
    fields: [
      {
        key: "eventKind",
        label: "Event type",
        type: "select",
        options: [
          { value: "partner", label: "Partner" },
          { value: "partner_led_customer", label: "Partner-led customer" },
          { value: "end_customer", label: "End-customer" },
          { value: "industry", label: "Industry" },
        ],
      },
    ],
  },
  {
    n: 2,
    title: "Main goal",
    prompt: "What is the main goal?",
    fields: [
      {
        key: "goal",
        label: "Main goal",
        type: "select",
        options: [
          { value: "new_leads", label: "New leads" },
          { value: "advance_deals", label: "Advancing existing deals" },
          { value: "brand_awareness", label: "Brand awareness" },
          { value: "partner_enablement", label: "Partner enablement" },
        ],
      },
    ],
  },
  {
    n: 3,
    title: "Date and place",
    prompt: "In which city and on what date will it be held, and in what format?",
    fields: [
      { key: "city", label: "City", type: "text" },
      { key: "date", label: "Date", type: "date" },
      {
        key: "format",
        label: "Format",
        type: "select",
        options: [
          { value: "physical", label: "Physical" },
          { value: "virtual", label: "Virtual" },
          { value: "hybrid", label: "Hybrid" },
        ],
      },
    ],
  },
  {
    n: 4,
    title: "Audience",
    prompt: "How many accounts do you expect to attend, how many of them are new, and what designations will they hold?",
    fields: [
      { key: "expectedAccounts", label: "Accounts expected", type: "int" },
      { key: "newAccounts", label: "Of which new", type: "int" },
      { key: "designations", label: "Designations", type: "text" },
    ],
  },
  {
    n: 5,
    title: "Lead estimate",
    prompt: "How many qualified leads do you expect, and what is that based on?",
    fields: [
      { key: "qualifiedLeads", label: "Qualified leads", type: "int" },
      { key: "leadsBasis", label: "Based on", type: "textarea" },
    ],
  },
  {
    n: 6,
    title: "Opportunities",
    prompt: "How many of those leads do you expect to become opportunities, and with what total pipeline value?",
    fields: [
      { key: "opportunities", label: "Opportunities", type: "int" },
      { key: "pipelineUsd", label: "Pipeline value", type: "money", unit: "USD" },
    ],
  },
  {
    n: 7,
    title: "Revenue and timing",
    prompt: "What revenue do you expect to close from this event, and within how many months?",
    fields: [
      { key: "revenueUsd", label: "Expected revenue", type: "money", unit: "USD" },
      { key: "closeMonths", label: "Within (months)", type: "int" },
    ],
  },
  {
    n: 8,
    title: "Total investment",
    prompt: "What is the total cost by head, Motadata's 50% share, and any Motadata travel or presales effort?",
    fields: [
      { key: "costPerHead", label: "Cost per head", type: "money", unit: "INR" },
      { key: "totalCost", label: "Total cost", type: "money", unit: "INR" },
      { key: "motadataShare", label: "Motadata's 50% share", type: "money", unit: "INR" },
      { key: "travelPresales", label: "Motadata travel / presales effort", type: "textarea" },
    ],
  },
  {
    n: 9,
    title: "Access to this audience",
    prompt: "If we don't attend this event, do we lose access to this audience elsewhere?",
    fields: [
      {
        key: "loseAccess",
        label: "Lose access?",
        type: "select",
        options: [
          { value: "yes", label: "Yes — no other way to reach them" },
          { value: "partly", label: "Partly" },
          { value: "no", label: "No — reachable elsewhere" },
        ],
      },
      { key: "loseAccessNote", label: "Explain", type: "textarea" },
    ],
  },
  {
    n: 10,
    title: "Past results",
    prompt: "What did a similar event in this region deliver before in attendees, leads and closed deals?",
    fields: [
      { key: "pastAttendees", label: "Attendees", type: "int" },
      { key: "pastLeads", label: "Leads", type: "int" },
      { key: "pastDeals", label: "Closed deals", type: "int" },
      { key: "pastNote", label: "Which event / notes", type: "textarea" },
    ],
  },
];

/** Question 11: the decision matrix, each factor scored 1 (low) to 5 (high). */
export const DECISION_FACTORS = [
  { key: "icpQuality", label: "ICP quality" },
  { key: "dealSize", label: "Deal size potential" },
  { key: "brandValue", label: "Brand / strategic value" },
  { key: "salesCommitment", label: "Sales commitment" },
  { key: "costEfficiency", label: "Event cost efficiency" },
] as const;

export const MAX_SCORE = DECISION_FACTORS.length * 5;

/** A reading of the total — guidance only; Sales makes the call. */
export function scoreBand(total: number | null): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (total === null) return { label: "Not scored yet", tone: "neutral" };
  if (total >= 18) return { label: "Strong case", tone: "success" };
  if (total >= 12) return { label: "Borderline", tone: "warning" };
  return { label: "Weak case", tone: "danger" };
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

const numberField = (integer: boolean) =>
  z.preprocess(
    (v) => (blank(v) ? undefined : typeof v === "string" ? Number(v.replace(/,/g, "")) : v),
    (integer ? z.number().int("Enter a whole number.") : z.number()).min(0, "Can't be negative.").max(1e12).optional(),
  );

function fieldSchema(f: SalesQuestionField): z.ZodType {
  switch (f.type) {
    case "select":
      return z.preprocess(
        (v) => (blank(v) ? undefined : v),
        z.enum(f.options.map((o) => o.value) as [string, ...string[]], { message: "Choose an option." }).optional(),
      );
    case "int":
      return numberField(true);
    case "money":
      return numberField(false);
    case "date":
      return z.preprocess((v) => (blank(v) ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.").optional());
    default:
      return z.preprocess((v) => (blank(v) ? undefined : String(v).trim()), z.string().max(2000).optional());
  }
}

const score = z.preprocess(
  (v) => (blank(v) ? undefined : Number(v)),
  z.number().int().min(1, "Score 1–5.").max(5, "Score 1–5.").optional(),
);

export const salesReviewAnswersSchema = z.object({
  ...Object.fromEntries(SALES_REVIEW_QUESTIONS.flatMap((q) => q.fields.map((f) => [f.key, fieldSchema(f)]))),
  ...Object.fromEntries(DECISION_FACTORS.map((f) => [f.key, score])),
});

export type SalesReviewAnswers = Record<string, unknown>;

export function totalScore(answers: SalesReviewAnswers): number | null {
  const scores = DECISION_FACTORS.map((f) => answers[f.key]);
  if (scores.some((s) => typeof s !== "number")) return null;
  return (scores as number[]).reduce((a, b) => a + b, 0);
}

/** Questions that must be answered before Sales can say Go (a No-go only needs a reason). */
export function missingForDecision(answers: SalesReviewAnswers): string[] {
  const missing: string[] = [];
  for (const q of SALES_REVIEW_QUESTIONS) {
    // Past results may genuinely not exist (a first event in a region), and the "explain" notes
    // are optional; every other field is required.
    if (q.n === 10) continue;
    const required = q.fields.filter((f) => !f.key.endsWith("Note"));
    if (required.some((f) => blank(answers[f.key]))) missing.push(`${q.n}. ${q.title}`);
  }
  if (totalScore(answers) === null) missing.push("11. Decision matrix");
  return missing;
}
