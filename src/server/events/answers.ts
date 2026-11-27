import { startOfIstDay } from "@/lib/date-range";
import type { ResolvedField } from "@/server/config/form-fields";

/**
 * Validates and normalises the dynamic answers of an event form against the fields the
 * configuration resolved for its event type and partner tier (Phase 2).
 *
 * Required fields are only enforced when `enforceRequired` is set, so drafts can be saved
 * half-finished and completeness is checked at submission.
 */

export type AnswerValue = string | number | boolean | string[] | null;
export type Answers = Record<string, AnswerValue>;

export type ValidationResult =
  { ok: true; answers: Answers } | { ok: false; errors: Record<string, string>; answers: Answers };

/** Options a SELECT/MULTISELECT field accepts, by field key. */
export type OptionSets = Record<string, { value: string; label: string }[]>;

const isBlank = (v: AnswerValue) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

export function validateAnswers(
  fields: ResolvedField[],
  raw: Record<string, unknown>,
  { enforceRequired = false, options = {} as OptionSets } = {},
): ValidationResult {
  const answers: Answers = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    if (!field.visible) continue; // hidden fields are never stored
    const input = raw[field.key];
    let value: AnswerValue = null;

    switch (field.type) {
      case "NUMBER":
      case "CURRENCY": {
        if (input === "" || input === null || input === undefined) break;
        const n = typeof input === "number" ? input : Number(String(input).replace(/,/g, "").trim());
        if (!Number.isFinite(n)) {
          errors[field.key] = "Enter a number.";
        } else if (n < 0) {
          errors[field.key] = "Enter a number of zero or more.";
        } else {
          value = field.type === "CURRENCY" ? Math.round(n * 100) / 100 : Math.round(n);
        }
        break;
      }
      case "CHECKBOX": {
        value = input === true || input === "true" || input === "on";
        break;
      }
      case "DATE": {
        const s = String(input ?? "").trim();
        if (!s) break;
        // Expect YYYY-MM-DD from a date input.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) errors[field.key] = "Enter a valid date.";
        else value = s;
        break;
      }
      case "MULTISELECT": {
        const list = (Array.isArray(input) ? input : input == null || input === "" ? [] : [input]).map(String);
        const allowed = options[field.key];
        const bad = allowed ? list.filter((v) => !allowed.some((o) => o.value === v)) : [];
        if (bad.length) errors[field.key] = "Choose from the list.";
        else value = list;
        break;
      }
      case "SELECT": {
        const s = String(input ?? "").trim();
        if (!s) break;
        const allowed = options[field.key];
        if (allowed && !allowed.some((o) => o.value === s)) errors[field.key] = "Choose from the list.";
        else value = s;
        break;
      }
      case "EMAIL": {
        const s = String(input ?? "").trim();
        if (!s) break;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) errors[field.key] = "Enter a valid email address.";
        else value = s.toLowerCase();
        break;
      }
      case "URL": {
        const s = String(input ?? "").trim();
        if (!s) break;
        if (!/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(s)) errors[field.key] = "Enter a valid link.";
        else value = s;
        break;
      }
      case "PHONE": {
        const s = String(input ?? "").trim();
        if (!s) break;
        if (!/^[+\d][\d\s-]{5,}$/.test(s)) errors[field.key] = "Enter a valid phone number.";
        else value = s;
        break;
      }
      case "TEXTAREA": {
        const s = String(input ?? "").trim();
        if (s.length > 5000) errors[field.key] = "Keep this under 5000 characters.";
        else value = s || null;
        break;
      }
      default: {
        const s = String(input ?? "").trim();
        if (s.length > 500) errors[field.key] = "Keep this under 500 characters.";
        else value = s || null;
      }
    }

    if (enforceRequired && field.required && !errors[field.key] && isBlank(value) && field.type !== "CHECKBOX") {
      errors[field.key] = "This is required.";
    }
    if (!isBlank(value) || field.type === "CHECKBOX") answers[field.key] = value;
  }

  return Object.keys(errors).length ? { ok: false, errors, answers } : { ok: true, answers };
}

/** Fields promoted from the answers blob onto indexed columns for filtering and reports. */
export function promotedColumns(answers: Answers) {
  const str = (key: string) => (typeof answers[key] === "string" ? (answers[key] as string) : null);
  const num = (key: string) => (typeof answers[key] === "number" ? (answers[key] as number) : null);
  const dateValue = answers["basic.proposedDate"];
  return {
    title: str("basic.name") ?? "Untitled event",
    proposedDate: typeof dateValue === "string" ? startOfIstDay(dateValue) : null,
    durationDays: num("basic.durationDays"),
    city: str("basic.city"),
    region: str("basic.region"),
    format: str("basic.format"),
    productFocus: str("basic.productFocus"),
    // A custom field, promoted because dashboards group spend by venue. Other custom fields
    // stay in `answers` until one of them needs reporting on, which is one line here plus a
    // column — never an unindexed group-by over the JSON blob.
    venue: str("custom.venue"),
    motadataContribution: num("budget.motadataContribution"),
    partnerContribution: num("budget.partnerContribution"),
    mdfAllocation: num("budget.mdfAllocation"),
  };
}
