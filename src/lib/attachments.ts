/**
 * Attachment kinds and their labels. Plain constants, kept out of the storage module so that
 * scripts and jobs can use them without pulling in server-only code.
 */

export const ATTACHMENT_KINDS = [
  "BUDGET_DETAILS",
  "INTERNAL_COSTING",
  "PRESENTATION",
  "AGENDA",
  "PROPOSAL",
  "QUOTATION",
  "INVOICE",
  "RECEIPT",
  "REPORT",
  "PHOTO",
  "OTHER",
] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = {
  BUDGET_DETAILS: "Budget details / cost breakup",
  INTERNAL_COSTING: "Internal costing",
  PRESENTATION: "Presentation (PPT)",
  AGENDA: "Agenda",
  PROPOSAL: "Event proposal",
  QUOTATION: "Quotation",
  INVOICE: "Invoice",
  RECEIPT: "Receipt",
  REPORT: "Post-event report",
  PHOTO: "Photograph",
  OTHER: "Other",
};

/**
 * What the Files tab offers for a new upload: the three document types the team works with.
 * Invoices are uploaded through the finance invoice step, not here. Older kinds stay in
 * ATTACHMENT_KINDS so files already uploaded under them keep their labels.
 */
export const UPLOADABLE_KINDS = ["BUDGET_DETAILS", "PROPOSAL", "INTERNAL_COSTING"] as const satisfies readonly AttachmentKind[];
