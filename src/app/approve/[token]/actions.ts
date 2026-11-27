"use server";

import { ZodError } from "zod";
import type { DecisionType } from "@prisma/client";
import { flattenErrors } from "@/lib/form-errors";
import { ApprovalError } from "@/server/approvals/engine";
import { decideWithToken, inspectApprovalToken } from "@/server/approvals/tokens";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getRequestContext } from "@/server/request-context";

export type ApproveState = { error?: string; outcome?: string };

/**
 * Records a decision made from an email link. Nothing happens on opening the link: this runs only
 * when the approver submits the confirmation form.
 */
export async function decideFromEmailAction(
  token: string,
  _prev: ApproveState,
  formData: FormData,
): Promise<ApproveState> {
  const decision = String(formData.get("decision") ?? "") as DecisionType;
  if (!["APPROVE", "REJECT", "REQUEST_CHANGES"].includes(decision)) return { error: "Choose a decision." };
  const comment = String(formData.get("comment") ?? "");

  // If someone else is signed in on this browser, refuse rather than record the wrong name.
  const check = await inspectApprovalToken(db, token);
  if (check.ok) {
    const signedIn = await getCurrentUser();
    if (signedIn && signedIn.id !== check.approverId) {
      return {
        error: `This link belongs to ${check.approverName}, but you are signed in as ${signedIn.name}. Sign out, or use the Approval Center with your own account.`,
      };
    }
  }

  try {
    const result = await decideWithToken(db, token, decision, comment || null, await getRequestContext());
    return { outcome: result.outcome };
  } catch (err) {
    if (err instanceof ZodError) return { error: Object.values(flattenErrors(err))[0] ?? "Check the form." };
    if (err instanceof ApprovalError) return { error: err.message };
    console.error(err);
    return { error: "Something went wrong. Please try again." };
  }
}
