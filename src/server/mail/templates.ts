import type { MailMessage } from "./transport";
import { appUrl, escapeHtml, renderEmail } from "./layout";

const HOURS = (ms: number) => Math.round(ms / 3_600_000);

export function inviteEmail(input: {
  to: string;
  name: string;
  invitedBy: string;
  token: string;
  ttlMs: number;
}): MailMessage {
  const url = appUrl(`/invite/${input.token}`);
  const hours = HOURS(input.ttlMs);
  return {
    to: input.to,
    subject: "You're invited to EventFlow",
    html: renderEmail({
      preheader: "Set your password to start using EventFlow.",
      heading: `Welcome to EventFlow, ${input.name}`,
      paragraphs: [
        `${escapeHtml(input.invitedBy)} has created an EventFlow account for you. EventFlow is Motadata's portal for event requests, approvals and expense tracking.`,
        "Set your password to activate your account:",
      ],
      action: { label: "Set your password", url },
      footnote: `This link works once and expires in ${hours} hours. If you were not expecting this email, you can ignore it.`,
    }),
    text: `Welcome to EventFlow, ${input.name}

${input.invitedBy} has created an EventFlow account for you.
Set your password to activate it: ${url}

This link works once and expires in ${hours} hours.`,
  };
}

export function passwordResetEmail(input: { to: string; name: string; token: string; ttlMs: number }): MailMessage {
  const url = appUrl(`/reset-password/${input.token}`);
  const minutes = Math.round(input.ttlMs / 60_000);
  return {
    to: input.to,
    subject: "Reset your EventFlow password",
    html: renderEmail({
      preheader: "Use this link to choose a new password.",
      heading: "Reset your password",
      paragraphs: [
        `Hi ${escapeHtml(input.name)}, we received a request to reset your EventFlow password.`,
        "Choose a new password using the button below:",
      ],
      action: { label: "Choose a new password", url },
      footnote: `This link works once and expires in ${minutes} minutes. If you did not ask for this, ignore this email; your password stays the same.`,
    }),
    text: `Hi ${input.name},

Reset your EventFlow password: ${url}

This link works once and expires in ${minutes} minutes. If you did not ask for this, ignore this email.`,
  };
}

export function passwordChangedEmail(input: { to: string; name: string }): MailMessage {
  return {
    to: input.to,
    subject: "Your EventFlow password was changed",
    html: renderEmail({
      preheader: "Your password was just changed.",
      heading: "Password changed",
      paragraphs: [
        `Hi ${escapeHtml(input.name)}, the password for your EventFlow account was just changed and all other sessions were signed out.`,
        "If you did not do this, contact your EventFlow administrator straight away.",
      ],
    }),
    text: `Hi ${input.name}, the password for your EventFlow account was just changed and all other sessions were signed out. If you did not do this, contact your EventFlow administrator.`,
  };
}
