import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

/**
 * Approval policy, stored as application settings so administrators can change it without a deploy.
 * Defaults follow the decisions confirmed on 13-Oct-2026.
 */

export const APPROVAL_POLICY_KEY = "approval.policy";

export const approvalPolicySchema = z.object({
  /** Who is copied on approval emails, besides the approvers being asked to decide. */
  ccRequester: z.boolean().default(true),
  ccOwner: z.boolean().default(true),
  /** Copy the Stage 1 approvers on the final-approval email. */
  ccEarlierApprovers: z.boolean().default(true),
  /** Copy the event manager and every internal stakeholder listed on the event. */
  ccStakeholders: z.boolean().default(true),
  /** Copy everyone holding the Finance role (they monitor but never approve). */
  ccFinance: z.boolean().default(true),
  /** Extra addresses, e.g. a shared mailbox. */
  ccExtra: z.array(z.string().email()).default([]),
  /** How long an emailed approval link stays usable. */
  tokenTtlHours: z.number().int().min(1).max(720).default(168),
  /** Normally nobody approves their own request (PRD §10). */
  allowSelfApproval: z.boolean().default(false),
});
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export const DEFAULT_POLICY: ApprovalPolicy = approvalPolicySchema.parse({});

export async function getApprovalPolicy(db: PrismaClient): Promise<ApprovalPolicy> {
  const row = await db.appSetting.findUnique({ where: { key: APPROVAL_POLICY_KEY } });
  const parsed = approvalPolicySchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : DEFAULT_POLICY;
}

export async function saveApprovalPolicy(db: PrismaClient, patch: Partial<ApprovalPolicy>) {
  const current = await getApprovalPolicy(db);
  const next = approvalPolicySchema.parse({ ...current, ...patch });
  await db.appSetting.upsert({
    where: { key: APPROVAL_POLICY_KEY },
    create: { key: APPROVAL_POLICY_KEY, value: next },
    update: { value: next },
  });
  return next;
}
