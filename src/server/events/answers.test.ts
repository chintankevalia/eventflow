import { describe, expect, it } from "vitest";
import type { ResolvedField } from "@/server/config/form-fields";
import { promotedColumns, validateAnswers } from "./answers";

const field = (over: Partial<ResolvedField> & { key: string; type: ResolvedField["type"] }): ResolvedField => ({
  section: "BASIC_DETAILS",
  label: over.key,
  required: false,
  visible: true,
  custom: false,
  system: false,
  partnerOnly: false,
  ...over,
});

describe("validateAnswers", () => {
  it("normalises numbers, currency and checkboxes", () => {
    const fields = [
      field({ key: "a", type: "NUMBER" }),
      field({ key: "b", type: "CURRENCY" }),
      field({ key: "c", type: "CHECKBOX" }),
    ];
    const result = validateAnswers(fields, { a: "42", b: "1,25,000.456", c: "on" });
    expect(result.ok).toBe(true);
    expect(result.answers).toEqual({ a: 42, b: 125000.46, c: true });
  });

  it("records an unticked checkbox as false rather than dropping it", () => {
    const result = validateAnswers([field({ key: "c", type: "CHECKBOX" })], {});
    expect(result.answers).toEqual({ c: false });
  });

  it("rejects bad numbers, dates, emails and links", () => {
    const fields = [
      field({ key: "n", type: "NUMBER" }),
      field({ key: "d", type: "DATE" }),
      field({ key: "e", type: "EMAIL" }),
      field({ key: "u", type: "URL" }),
    ];
    const result = validateAnswers(fields, { n: "abc", d: "12/10/2026", e: "nope", u: "not a link" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["d", "e", "n", "u"]);
  });

  it("rejects negative amounts", () => {
    const result = validateAnswers([field({ key: "b", type: "CURRENCY" })], { b: "-5" });
    expect(result.ok).toBe(false);
  });

  it("only accepts dropdown values from the list", () => {
    const fields = [field({ key: "s", type: "SELECT" })];
    const options = { s: [{ value: "north", label: "North" }] };
    expect(validateAnswers(fields, { s: "north" }, { options }).ok).toBe(true);
    expect(validateAnswers(fields, { s: "mars" }, { options }).ok).toBe(false);
  });

  it("ignores hidden fields entirely", () => {
    const fields = [field({ key: "h", type: "TEXT", visible: false, required: true })];
    const result = validateAnswers(fields, { h: "value" }, { enforceRequired: true });
    expect(result.ok).toBe(true);
    expect(result.answers).toEqual({});
  });

  it("enforces required fields only when asked", () => {
    const fields = [field({ key: "r", type: "TEXT", required: true })];
    expect(validateAnswers(fields, {}).ok).toBe(true);
    const strict = validateAnswers(fields, { r: "   " }, { enforceRequired: true });
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.errors.r).toMatch(/required/i);
  });
});

describe("promotedColumns", () => {
  it("pulls indexed values out of the answers", () => {
    const promoted = promotedColumns({
      "basic.name": "Partner meet",
      "basic.proposedDate": "2026-11-20",
      "basic.city": "Pune",
      "budget.motadataContribution": 50000,
    });
    expect(promoted.title).toBe("Partner meet");
    expect(promoted.city).toBe("Pune");
    expect(promoted.motadataContribution).toBe(50000);
    // Stored at midnight India time, so the calendar date cannot drift.
    expect(promoted.proposedDate?.toISOString()).toBe("2026-11-19T18:30:00.000Z");
  });

  it("falls back to a placeholder title", () => {
    expect(promotedColumns({}).title).toBe("Untitled event");
  });
});
