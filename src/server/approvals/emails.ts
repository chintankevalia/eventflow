import { formatDate, formatINR } from "@/lib/format";
import { appUrl, escapeHtml, renderEmail } from "@/server/mail/layout";
import type { MailMessage } from "@/server/mail/transport";

/**
 * Approval emails. The detailed email carries the whole event summary and its costing (PRD §7),
 * and every approver gets Approve / Reject buttons that work straight from the inbox.
 */

export type EventSummary = {
  code: string;
  title: string;
  eventTypeName: string;
  subtypeName: string | null;
  department: string;
  requesterName: string;
  ownerName: string | null;
  partnerName: string | null;
  partnerTierLabel: string | null;
  proposedDate: Date | null;
  durationDays: number | null;
  city: string | null;
  region: string | null;
  format: string | null;
  productFocus: string | null;
  objective: string | null;
  expectedRoi: string | null;
  expectedRoiJustification: string | null;
  estimatedCost: number;
  motadataContribution: number | null;
  partnerContribution: number | null;
  mdfAllocation: number | null;
  costLines: { description: string; category: string | null; estimated: number }[];
  attachments: { fileName: string; kindLabel: string }[];
  versionNo: number;
};

const row = (label: string, value: string) =>
  `<tr><td style="padding:6px 12px 6px 0;font-size:13px;color:#6b7280;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;font-size:14px;color:#0f172a">${escapeHtml(value)}</td></tr>`;

function summaryTable(summary: EventSummary) {
  const rows = [
    row("Event ID", summary.code),
    row("Type", [summary.eventTypeName, summary.subtypeName].filter(Boolean).join(" · ")),
    row("Requesting team", summary.department),
    row("Requested by", summary.requesterName),
    summary.ownerName ? row("Event owner", summary.ownerName) : "",
    summary.partnerName
      ? row("Partner", summary.partnerName + (summary.partnerTierLabel ? ` (${summary.partnerTierLabel})` : ""))
      : "",
    row(
      "Date",
      summary.proposedDate
        ? formatDate(summary.proposedDate) +
            (summary.durationDays ? ` · ${summary.durationDays} day${summary.durationDays === 1 ? "" : "s"}` : "")
        : "Not set",
    ),
    row("Location", [summary.city, summary.region].filter(Boolean).join(", ") || "Not set"),
    summary.format ? row("Format", summary.format) : "",
    summary.productFocus ? row("Product focus", summary.productFocus) : "",
    summary.objective ? row("Objective", summary.objective) : "",
  ]
    .filter(Boolean)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${rows}</table>`;
}

function costTable(summary: EventSummary) {
  const lines = summary.costLines
    .map((line) => {
      const label =
        escapeHtml(line.description) +
        (line.category ? ` <span style="color:#6b7280">· ${escapeHtml(line.category)}</span>` : "");
      return `<tr><td style="padding:6px 0;font-size:13px;color:#0f172a;border-top:1px solid #e5e7eb">${label}</td><td style="padding:6px 0;font-size:13px;color:#0f172a;text-align:right;border-top:1px solid #e5e7eb;white-space:nowrap">${escapeHtml(formatINR(line.estimated))}</td></tr>`;
    })
    .join("");

  const contributions: [string, number][] = [];
  if (summary.motadataContribution !== null)
    contributions.push(["Motadata contribution", summary.motadataContribution]);
  if (summary.partnerContribution !== null) contributions.push(["Partner contribution", summary.partnerContribution]);
  if (summary.mdfAllocation !== null) contributions.push(["MDF / co-marketing", summary.mdfAllocation]);

  const contributionRows = contributions
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 0;font-size:13px;color:#6b7280">${escapeHtml(label)}</td><td style="padding:4px 0;font-size:13px;color:#6b7280;text-align:right">${escapeHtml(formatINR(value))}</td></tr>`,
    )
    .join("");

  const empty = `<tr><td style="padding:6px 0;font-size:13px;color:#6b7280">No cost lines.</td></tr>`;

  return `<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#0f172a">Costing</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">
${lines || empty}
<tr><td style="padding:8px 0;font-size:14px;font-weight:600;border-top:2px solid #0f172a">Estimated total</td><td style="padding:8px 0;font-size:14px;font-weight:600;text-align:right;border-top:2px solid #0f172a;white-space:nowrap">${escapeHtml(formatINR(summary.estimatedCost))}</td></tr>
${contributionRows}
</table>`;
}

function roiBlock(summary: EventSummary) {
  if (!summary.expectedRoi) return "";
  const justification = summary.expectedRoiJustification
    ? `<br><span style="color:#6b7280">${escapeHtml(summary.expectedRoiJustification)}</span>`
    : "";
  return `<strong>Expected ROI:</strong> ${escapeHtml(summary.expectedRoi)}${justification}`;
}

function attachmentsBlock(summary: EventSummary) {
  if (!summary.attachments.length) return "";
  const list = summary.attachments.map((a) => escapeHtml(`${a.fileName} (${a.kindLabel})`)).join(", ");
  return `<span style="font-size:13px;color:#6b7280"><strong style="color:#0f172a">Attached:</strong> ${list}</span>`;
}

function textSummary(summary: EventSummary) {
  return [
    `${summary.code} — ${summary.title}`,
    `Type: ${[summary.eventTypeName, summary.subtypeName].filter(Boolean).join(" / ")}`,
    `Team: ${summary.department} · Requested by ${summary.requesterName}`,
    summary.partnerName
      ? `Partner: ${summary.partnerName}${summary.partnerTierLabel ? ` (${summary.partnerTierLabel})` : ""}`
      : "",
    `Date: ${summary.proposedDate ? formatDate(summary.proposedDate) : "not set"}`,
    `Location: ${[summary.city, summary.region].filter(Boolean).join(", ") || "not set"}`,
    summary.objective ? `Objective: ${summary.objective}` : "",
    "",
    "Costing:",
    ...summary.costLines.map(
      (l) => `  ${l.description}${l.category ? ` (${l.category})` : ""}: ${formatINR(l.estimated)}`,
    ),
    `  Estimated total: ${formatINR(summary.estimatedCost)}`,
    summary.expectedRoi ? `\nExpected ROI: ${summary.expectedRoi}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Approve and Reject side by side, replacing the layout's single action button. */
function decisionButtons(approveUrl: string, rejectUrl: string) {
  return `<tr><td style="padding:4px 0 20px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:10px"><a href="${escapeHtml(approveUrl)}" style="display:inline-block;background:#15803d;color:#ffffff;font-weight:600;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:8px">Approve</a></td>
<td><a href="${escapeHtml(rejectUrl)}" style="display:inline-block;background:#ffffff;color:#b91c1c;border:1px solid #b91c1c;font-weight:600;font-size:15px;text-decoration:none;padding:11px 23px;border-radius:8px">Reject</a></td>
</tr></table>
</td></tr>
<tr><td style="padding:0 0 24px;font-size:12px;color:#6b7280;line-height:1.5">Both buttons open EventFlow and ask you to confirm before anything is recorded. The link is yours alone, works once, and stops working if the request changes.</td></tr>`;
}

export function approvalRequestEmail(input: {
  to: string;
  approverName: string;
  stageName: string;
  isFinalStage: boolean;
  summary: EventSummary;
  token: string;
  cc?: string[];
}): MailMessage {
  const base = appUrl(`/approve/${input.token}`);
  const approveUrl = `${base}?decision=approve`;
  const rejectUrl = `${base}?decision=reject`;
  const { summary } = input;
  const heading = input.isFinalStage ? `Final approval needed: ${summary.title}` : `Approval needed: ${summary.title}`;

  return {
    to: input.to,
    cc: input.cc,
    subject: `${input.isFinalStage ? "Final approval" : "Approval"} needed — ${summary.code} ${summary.title}`,
    html: renderEmail({
      preheader: `${summary.code} · ${formatINR(summary.estimatedCost)} · ${summary.requesterName}`,
      heading,
      paragraphs: [
        `Hi ${escapeHtml(input.approverName)}, this event request needs your decision (${escapeHtml(input.stageName)}).`,
        summaryTable(summary),
        costTable(summary),
        roiBlock(summary),
        attachmentsBlock(summary),
      ].filter(Boolean),
      actionsHtml: decisionButtons(approveUrl, rejectUrl),
      footnote: `Prefer the portal? Open <a href="${escapeHtml(appUrl("/approvals"))}" style="color:#6b7280">the Approval Center</a>.`,
    }),
    text: `${heading}\n\n${textSummary(summary)}\n\nApprove: ${approveUrl}\nReject: ${rejectUrl}\n\nOr decide in the portal: ${appUrl("/approvals")}`,
  };
}

export function decisionOutcomeEmail(input: {
  to: string[];
  cc?: string[];
  summary: EventSummary;
  outcome: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
  approverName: string;
  comment: string | null;
}): MailMessage {
  const { summary } = input;
  const titles = {
    APPROVED: `Approved: ${summary.title}`,
    REJECTED: `Rejected: ${summary.title}`,
    CHANGES_REQUESTED: `Changes requested: ${summary.title}`,
  } as const;
  const leads = {
    APPROVED: `${escapeHtml(input.approverName)} gave the final approval. The plan and budget are now locked; any material change needs a fresh approval.`,
    REJECTED: `${escapeHtml(input.approverName)} rejected this request.`,
    CHANGES_REQUESTED: `${escapeHtml(input.approverName)} asked for changes. The request is back with the requester for editing and resubmission.`,
  } as const;

  return {
    to: input.to,
    cc: input.cc,
    subject: `${titles[input.outcome]} — ${summary.code}`,
    html: renderEmail({
      preheader: `${summary.code} · ${input.outcome.toLowerCase().replace("_", " ")}`,
      heading: titles[input.outcome],
      paragraphs: [
        leads[input.outcome],
        input.comment ? `<strong>Comment:</strong> ${escapeHtml(input.comment)}` : "",
        summaryTable(summary),
      ].filter(Boolean),
      action: { label: "Open the event", url: appUrl(`/events?q=${encodeURIComponent(summary.code)}`) },
    }),
    text: `${titles[input.outcome]}\n\n${input.comment ? `Comment: ${input.comment}\n\n` : ""}${textSummary(summary)}`,
  };
}

export function reminderEmail(input: {
  to: string;
  approverName: string;
  summary: EventSummary;
  token: string;
  hoursWaiting: number;
  escalation: boolean;
  cc?: string[];
}): MailMessage {
  const base = appUrl(`/approve/${input.token}`);
  const heading = input.escalation
    ? `Overdue approval: ${input.summary.title}`
    : `Reminder: ${input.summary.title} is waiting for you`;

  return {
    to: input.to,
    cc: input.cc,
    subject: `${input.escalation ? "Overdue" : "Reminder"} — ${input.summary.code} needs your approval`,
    html: renderEmail({
      preheader: `Waiting ${input.hoursWaiting} hours`,
      heading,
      paragraphs: [
        `Hi ${escapeHtml(input.approverName)}, ${escapeHtml(input.summary.code)} has been waiting ${input.hoursWaiting} hours for your decision.`,
        input.escalation ? "This is now past the agreed turnaround, so the wider team has been copied." : "",
        summaryTable(input.summary),
      ].filter(Boolean),
      action: { label: "Review and decide", url: base },
    }),
    text: `${heading}\n\n${input.summary.code} has been waiting ${input.hoursWaiting} hours.\n\nDecide: ${base}`,
  };
}
