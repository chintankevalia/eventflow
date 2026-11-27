/**
 * CSV construction shared by the export routes.
 *
 * The rules that matter here are a spreadsheet's, not ours: every row must have
 * exactly as many fields as the header, amounts must arrive as numbers Finance
 * can sum, and nothing must be interpretable as a formula. Formatting money
 * with `formatINR` breaks the first of those — `₹2,50,000` carries commas — so
 * exports pass plain numbers and let the header name the unit.
 */

import { istDay } from "./date-range";

/** Characters that force a field to be quoted. */
const NEEDS_QUOTING = /[",\n\r]/;

/** A leading one of these makes Excel and Sheets treat the field as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One field, escaped for CSV.
 *
 * Numbers pass straight through: a number is never a formula, and prefixing a
 * negative amount would make Excel read `-500` as text and silently drop it
 * from every SUM — a wrong total is worse than an ugly one.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = value ?? "";
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return NEEDS_QUOTING.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One row. Field count is the caller's responsibility; escaping is not. */
export function csvRow(fields: readonly (string | number | null | undefined)[]): string {
  return fields.map(csvCell).join(",");
}

/**
 * `yyyy-mm-dd` — the one date form every spreadsheet reads the same way.
 *
 * The day is the Indian one, which is the whole point of going through
 * `istDay`. A proposed date is stored as IST midnight, so an event the portal
 * shows as 10-Dec-2026 is held as `2026-12-09T18:30:00Z`: read in UTC it
 * exports as 9 December, and the file disagrees with the screen it was
 * downloaded from on every single date.
 */
export function csvDay(date: Date | null | undefined): string {
  return date ? istDay(date) : "";
}

/**
 * The finished file: CRLF line endings, and a leading BOM so Windows Excel
 * reads it as UTF-8. Without the BOM `₹` arrives as mojibake.
 */
export function csvFile(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return `﻿${[csvRow(header), ...rows.map(csvRow)].join("\r\n")}`;
}

/** The headers that make a browser download the body instead of showing it. */
export function csvHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
}
