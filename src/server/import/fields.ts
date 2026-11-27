/**
 * Canonical list of importable event fields.
 * Each entry describes how a source column can map to an EventFlow field.
 */

export type ImportFieldDef = {
  key: string;
  label: string;
  /** Which section this field belongs to, for grouping in the UI. */
  group: "basic" | "budget" | "post_event";
  required: boolean;
  /** Expected value type; used for coercion and validation. */
  type: "string" | "date" | "number" | "enum";
  enumValues?: string[];
  hint?: string;
};

export const IMPORT_FIELDS: ImportFieldDef[] = [
  // ── Basic details ──────────────────────────────────────────────────────────
  {
    key: "title",
    label: "Event Name",
    group: "basic",
    required: true,
    type: "string",
  },
  {
    key: "code",
    label: "Event Code",
    group: "basic",
    required: false,
    type: "string",
    hint: "Leave blank to auto-generate (EF-YYYY-NNNN).",
  },
  {
    key: "department",
    label: "Department",
    group: "basic",
    required: true,
    type: "enum",
    enumValues: ["SALES", "MARKETING", "CHANNEL", "FINANCE", "MANAGEMENT", "OTHER"],
    hint: "SALES | MARKETING | CHANNEL | FINANCE | MANAGEMENT | OTHER",
  },
  {
    key: "proposedDate",
    label: "Proposed Date",
    group: "basic",
    required: false,
    type: "date",
    hint: "YYYY-MM-DD or any unambiguous date format.",
  },
  {
    key: "durationDays",
    label: "Duration (days)",
    group: "basic",
    required: false,
    type: "number",
  },
  {
    key: "city",
    label: "City",
    group: "basic",
    required: false,
    type: "string",
  },
  {
    key: "region",
    label: "Region",
    group: "basic",
    required: false,
    type: "string",
  },
  {
    key: "format",
    label: "Format",
    group: "basic",
    required: false,
    type: "enum",
    enumValues: ["Physical", "Virtual", "Hybrid"],
    hint: "Physical | Virtual | Hybrid",
  },
  {
    key: "productFocus",
    label: "Product Focus",
    group: "basic",
    required: false,
    type: "enum",
    enumValues: ["ObserveOps", "ServiceOps", "Both"],
    hint: "ObserveOps | ServiceOps | Both",
  },
  {
    key: "lifecycleStatus",
    label: "Status",
    group: "basic",
    required: false,
    type: "enum",
    enumValues: ["DRAFT", "SCHEDULING", "APPROVED", "IN_EXECUTION", "CLOSED", "DROPPED"],
    hint: "Defaults to DRAFT. Use CLOSED / APPROVED for historical migration.",
  },
  {
    key: "objective",
    label: "Objective",
    group: "basic",
    required: false,
    type: "string",
  },
  // ── Budget ─────────────────────────────────────────────────────────────────
  {
    key: "estimatedCost",
    label: "Estimated Budget (INR)",
    group: "budget",
    required: false,
    type: "number",
  },
  {
    key: "actualCost",
    label: "Actual Cost (INR)",
    group: "budget",
    required: false,
    type: "number",
  },
  {
    key: "motadataContribution",
    label: "Motadata Contribution (INR)",
    group: "budget",
    required: false,
    type: "number",
  },
  {
    key: "partnerContribution",
    label: "Partner Contribution (INR)",
    group: "budget",
    required: false,
    type: "number",
  },
  {
    key: "mdfAllocation",
    label: "MDF / Co-marketing (INR)",
    group: "budget",
    required: false,
    type: "number",
  },
  // ── Post-event outcomes ────────────────────────────────────────────────────
  {
    key: "actualAttendance",
    label: "Actual Attendance",
    group: "post_event",
    required: false,
    type: "number",
  },
  {
    key: "companiesEngaged",
    label: "Companies Engaged",
    group: "post_event",
    required: false,
    type: "number",
  },
  {
    key: "newLeads",
    label: "New Leads",
    group: "post_event",
    required: false,
    type: "number",
  },
  {
    key: "sqls",
    label: "SQLs",
    group: "post_event",
    required: false,
    type: "number",
  },
  {
    key: "opportunities",
    label: "Opportunities",
    group: "post_event",
    required: false,
    type: "number",
  },
  {
    key: "actualRoi",
    label: "Actual ROI",
    group: "post_event",
    required: false,
    type: "string",
  },
];

export const IMPORT_FIELD_BY_KEY = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, f]));

/** Heuristic: auto-match a source column header to a target field key. */
export function guessFieldKey(header: string): string | null {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  const MAP: Record<string, string> = {
    eventname: "title",
    name: "title",
    title: "title",
    eventcode: "code",
    code: "code",
    id: "code",
    eventid: "code",
    department: "department",
    dept: "department",
    date: "proposedDate",
    proposeddate: "proposedDate",
    eventdate: "proposedDate",
    duration: "durationDays",
    durationdays: "durationDays",
    days: "durationDays",
    city: "city",
    location: "city",
    venue: "city",
    region: "region",
    format: "format",
    mode: "format",
    productfocus: "productFocus",
    product: "productFocus",
    focus: "productFocus",
    status: "lifecycleStatus",
    lifecyclestatus: "lifecycleStatus",
    objective: "objective",
    description: "objective",
    estimatedbudget: "estimatedCost",
    estimatedcost: "estimatedCost",
    budget: "estimatedCost",
    estimated: "estimatedCost",
    actualcost: "actualCost",
    actual: "actualCost",
    actuals: "actualCost",
    motadatacontribution: "motadataContribution",
    motadata: "motadataContribution",
    partnercontribution: "partnerContribution",
    partner: "partnerContribution",
    mdf: "mdfAllocation",
    comarketing: "mdfAllocation",
    attendance: "actualAttendance",
    actualattendance: "actualAttendance",
    companiesengaged: "companiesEngaged",
    companies: "companiesEngaged",
    newleads: "newLeads",
    leads: "newLeads",
    sqls: "sqls",
    opportunities: "opportunities",
    actualroi: "actualRoi",
    roi: "actualRoi",
  };
  return MAP[h] ?? null;
}
