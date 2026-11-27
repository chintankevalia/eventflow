/**
 * Built-in event-form fields (PRD §6, the five sections). This is the canonical catalogue;
 * the FieldRule table layers required / visible rules on top per event type and partner tier (FR-23),
 * and admins can add further custom fields (FormField). Keep keys stable: events store answers by key.
 *
 * Only scalar fields appear here. Repeatable groups (cost lines, tasks, speakers), uploads and
 * computed totals are structural parts of the event built in Phase 3, not toggleable form fields.
 */

export const FORM_SECTIONS = ["BASIC_DETAILS", "STAKEHOLDERS", "BUDGET", "PLANNING", "POST_EVENT"] as const;
export type FormSection = (typeof FORM_SECTIONS)[number];

export const SECTION_META: Record<FormSection, { label: string; purpose: string }> = {
  BASIC_DETAILS: { label: "Event Basic Details", purpose: "Identify and classify every event." },
  STAKEHOLDERS: { label: "Stakeholder & Ownership", purpose: "Establish accountability and collaboration." },
  BUDGET: { label: "Budget & Expense", purpose: "Track financial planning and actual expenditure." },
  PLANNING: { label: "Planning & Execution", purpose: "Ensure all event activities are completed on time." },
  POST_EVENT: { label: "Post-Event Performance", purpose: "Measure business impact, not just execution." },
};

export const FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "CURRENCY",
  "DATE",
  "SELECT",
  "MULTISELECT",
  "CHECKBOX",
  "URL",
  "EMAIL",
  "PHONE",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  TEXT: "Short text",
  TEXTAREA: "Paragraph",
  NUMBER: "Number",
  CURRENCY: "Amount (₹)",
  DATE: "Date",
  SELECT: "Dropdown (one)",
  MULTISELECT: "Dropdown (many)",
  CHECKBOX: "Yes / No",
  URL: "Link",
  EMAIL: "Email",
  PHONE: "Phone",
};

export type BuiltinField = {
  key: string;
  section: FormSection;
  label: string;
  type: FieldType;
  /** Where SELECT options come from, when they are a managed lookup list. */
  lookup?: "COLLABORATION_MODEL" | "REGION" | "INDUSTRY" | "PRODUCT_FOCUS" | "EVENT_FORMAT";
  /** Pulls its value from another part of the system; shown for context but its rule is fixed. */
  system?: boolean;
  /** Only relevant to event types that involve a partner/distributor. */
  partnerOnly?: boolean;
  /** Default required state before an admin configures anything. */
  defaultRequired?: boolean;
  help?: string;
};

export const BUILTIN_FIELDS: BuiltinField[] = [
  // 1. Basic details
  { key: "basic.name", section: "BASIC_DETAILS", label: "Event name", type: "TEXT", defaultRequired: true },
  { key: "basic.objective", section: "BASIC_DETAILS", label: "Objective", type: "TEXTAREA", defaultRequired: true },
  {
    key: "basic.collaborationModel",
    section: "BASIC_DETAILS",
    label: "Collaboration model",
    type: "SELECT",
    lookup: "COLLABORATION_MODEL",
  },
  {
    key: "basic.format",
    section: "BASIC_DETAILS",
    label: "Event format",
    type: "SELECT",
    lookup: "EVENT_FORMAT",
    defaultRequired: true,
  },
  { key: "basic.region", section: "BASIC_DETAILS", label: "Region", type: "SELECT", lookup: "REGION" },
  { key: "basic.country", section: "BASIC_DETAILS", label: "Country", type: "TEXT" },
  { key: "basic.city", section: "BASIC_DETAILS", label: "City", type: "TEXT" },
  // Part of the location block (region, country, city, venue) rather than the Planning tab it
  // first lived in as a custom field. The key keeps its old name on purpose: events, the importer
  // and the dashboards' "by venue" grouping all already read `custom.venue`.
  {
    key: "custom.venue",
    section: "BASIC_DETAILS",
    label: "Venue",
    type: "TEXT",
    help: "Hotel, campus or office the event is held at.",
  },
  { key: "basic.proposedDate", section: "BASIC_DETAILS", label: "Proposed date", type: "DATE", defaultRequired: true },
  { key: "basic.durationDays", section: "BASIC_DETAILS", label: "Duration (days)", type: "NUMBER" },
  { key: "basic.targetAudience", section: "BASIC_DETAILS", label: "Target audience", type: "TEXT" },
  {
    key: "basic.industry",
    section: "BASIC_DETAILS",
    label: "Industries",
    type: "MULTISELECT",
    lookup: "INDUSTRY",
    help: "Tick every industry the audience comes from, or \"Cross-industry\" when it is open to all.",
  },
  {
    key: "basic.productFocus",
    section: "BASIC_DETAILS",
    label: "Product focus",
    type: "SELECT",
    lookup: "PRODUCT_FOCUS",
    defaultRequired: true,
  },

  // 2. Stakeholders
  {
    key: "stakeholders.owner",
    section: "STAKEHOLDERS",
    label: "Event owner",
    type: "SELECT",
    system: true,
    defaultRequired: true,
    help: "An EventFlow user. Set on the event.",
  },
  { key: "stakeholders.manager", section: "STAKEHOLDERS", label: "Event manager", type: "SELECT", system: true },
  { key: "stakeholders.internalSpoc", section: "STAKEHOLDERS", label: "Internal SPOC", type: "TEXT" },
  { key: "stakeholders.salesOwner", section: "STAKEHOLDERS", label: "Sales owner", type: "TEXT" },
  { key: "stakeholders.channelOwner", section: "STAKEHOLDERS", label: "Channel owner", type: "TEXT" },
  {
    key: "stakeholders.partner",
    section: "STAKEHOLDERS",
    label: "Partner / distributor",
    type: "SELECT",
    system: true,
    partnerOnly: true,
    help: "Chosen from master data; shows the partner tier.",
  },

  // 3. Budget
  { key: "budget.motadataContribution", section: "BUDGET", label: "Motadata contribution", type: "CURRENCY" },
  {
    key: "budget.partnerContribution",
    section: "BUDGET",
    label: "Partner / distributor contribution",
    type: "CURRENCY",
    partnerOnly: true,
  },
  {
    key: "budget.mdfAllocation",
    section: "BUDGET",
    label: "MDF / co-marketing fund",
    type: "CURRENCY",
    partnerOnly: true,
  },
  {
    key: "budget.expectedRoi",
    section: "BUDGET",
    label: "Expected ROI",
    type: "TEXT",
    defaultRequired: true,
    help: "Entered by hand; not a formula.",
  },
  {
    key: "budget.expectedRoiJustification",
    section: "BUDGET",
    label: "Expected ROI — justification",
    type: "TEXTAREA",
  },

  // 4. Planning
  { key: "planning.registrationLink", section: "PLANNING", label: "Invitation / registration link", type: "URL" },
  { key: "planning.expectedRegistrations", section: "PLANNING", label: "Expected registrations", type: "NUMBER" },
  { key: "planning.expectedAttendance", section: "PLANNING", label: "Expected attendance", type: "NUMBER" },
  {
    key: "planning.brandingRequirements",
    section: "PLANNING",
    label: "Branding & collateral requirements",
    type: "TEXTAREA",
  },
  { key: "planning.logistics", section: "PLANNING", label: "Logistics & travel arrangements", type: "TEXTAREA" },

  // 5. Post-event
  { key: "post.actualAttendance", section: "POST_EVENT", label: "Actual attendance", type: "NUMBER" },
  { key: "post.companiesEngaged", section: "POST_EVENT", label: "Companies / accounts engaged", type: "NUMBER" },
  { key: "post.newLeads", section: "POST_EVENT", label: "New leads generated", type: "NUMBER" },
  { key: "post.sqls", section: "POST_EVENT", label: "Sales-qualified leads", type: "NUMBER" },
  { key: "post.opportunities", section: "POST_EVENT", label: "Opportunities", type: "NUMBER" },
  {
    key: "post.partnerParticipation",
    section: "POST_EVENT",
    label: "Partner participation",
    type: "TEXT",
    partnerOnly: true,
  },
  { key: "post.meetings", section: "POST_EVENT", label: "Meetings conducted", type: "NUMBER" },
  { key: "post.satisfaction", section: "POST_EVENT", label: "Feedback / satisfaction", type: "TEXT" },
  { key: "post.followUpOwner", section: "POST_EVENT", label: "Follow-up owner", type: "TEXT" },
  { key: "post.nextAction", section: "POST_EVENT", label: "Next action", type: "TEXT" },
  { key: "post.actualRoi", section: "POST_EVENT", label: "Actual ROI", type: "TEXT" },
  { key: "post.actualRoiJustification", section: "POST_EVENT", label: "Actual ROI — justification", type: "TEXTAREA" },
];

export const BUILTIN_BY_KEY: Record<string, BuiltinField> = Object.fromEntries(BUILTIN_FIELDS.map((f) => [f.key, f]));

export function builtinFieldsForSection(section: FormSection): BuiltinField[] {
  return BUILTIN_FIELDS.filter((f) => f.section === section);
}
