/**
 * Event lifecycle (confirmed 13-Oct-2026): Request → Scheduling → Approval → Execution → Closure.
 * Approval status is stored separately from lifecycle status (PRD §6.1).
 */

export const LIFECYCLE_STATUSES = [
  "DRAFT",
  "SCHEDULING",
  "PENDING_APPROVAL",
  "APPROVED",
  "IN_EXECUTION",
  "CLOSED",
  "DROPPED",
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

export const LIFECYCLE_META: Record<LifecycleStatus, { label: string; tone: Tone; description: string }> = {
  DRAFT: { label: "Draft", tone: "neutral", description: "Request raised; an idea, not yet planned." },
  SCHEDULING: {
    label: "Scheduling",
    tone: "info",
    description: "Dates, venue, vendors, agenda, tasks, budget and expected ROI being planned.",
  },
  PENDING_APPROVAL: {
    label: "Pending Approval",
    tone: "warning",
    description: "Submitted; with Akshay and Mitul, then Amit sir.",
  },
  APPROVED: { label: "Approved", tone: "success", description: "Final approval given; plan and budget locked." },
  IN_EXECUTION: {
    label: "In Execution",
    tone: "brand",
    description: "Event running; tasks, actual expenses and invoices tracked.",
  },
  CLOSED: {
    label: "Closed",
    tone: "neutral",
    description: "Post-event results, final expense and actual ROI recorded.",
  },
  DROPPED: { label: "Dropped", tone: "danger", description: "Cancelled; reason and full history kept." },
};

export const APPROVAL_META: Record<ApprovalStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  CHANGES_REQUESTED: { label: "Changes Requested", tone: "info" },
};

/**
 * Labels for every value the column can actually hold, `NOT_SUBMITTED`
 * included. `APPROVAL_META` deliberately omits it — the event page shows an
 * unsubmitted request as "Pending", which reads correctly next to a lifecycle
 * badge. An export has no such context, so it says what is true: nothing has
 * been submitted yet.
 */
export const APPROVAL_LABEL: Record<"NOT_SUBMITTED" | ApprovalStatus, string> = {
  NOT_SUBMITTED: "Not submitted",
  PENDING: APPROVAL_META.PENDING.label,
  APPROVED: APPROVAL_META.APPROVED.label,
  REJECTED: APPROVAL_META.REJECTED.label,
  CHANGES_REQUESTED: APPROVAL_META.CHANGES_REQUESTED.label,
};

/** The main path shown as a pipeline; DROPPED can happen from any stage. */
export const LIFECYCLE_FLOW: LifecycleStatus[] = [
  "DRAFT",
  "SCHEDULING",
  "PENDING_APPROVAL",
  "APPROVED",
  "IN_EXECUTION",
  "CLOSED",
];
