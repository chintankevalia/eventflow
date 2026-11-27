import type { DecisionType, PrismaClient } from "@prisma/client";
import { hashToken } from "@/server/auth/tokens";
import { ApprovalError, recordDecision } from "./engine";

/**
 * Deciding from an email link (PRD §7.1).
 *
 * The link carries a 256-bit token, stored only as a hash, bound to one approver, one stage and one
 * submitted version. It is single-use and expires. Opening it never records anything: the page asks
 * for confirmation and the decision is made by a POST, so link scanners and prefetchers cannot
 * approve anything by following it.
 */

export type TokenCheck =
  | { ok: true; roundId: string; stageId: string; approverId: string; approverName: string; eventId: string }
  | { ok: false; reason: "invalid" | "used" | "expired" | "closed" };

export async function inspectApprovalToken(db: PrismaClient, token: string): Promise<TokenCheck> {
  const record = await db.approvalToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      approver: { select: { id: true, name: true, status: true } },
      round: { select: { id: true, status: true, currentStageId: true, eventId: true } },
    },
  });
  if (!record) return { ok: false, reason: "invalid" };
  if (record.usedAt) return { ok: false, reason: "used" };
  if (record.expiresAt <= new Date()) return { ok: false, reason: "expired" };
  if (record.approver.status !== "ACTIVE") return { ok: false, reason: "invalid" };
  // The round must still be open at the stage this link was issued for; otherwise it is stale.
  if (record.round.status !== "PENDING" || record.round.currentStageId !== record.stageId) {
    return { ok: false, reason: "closed" };
  }
  return {
    ok: true,
    roundId: record.roundId,
    stageId: record.stageId,
    approverId: record.approverId,
    approverName: record.approver.name,
    eventId: record.round.eventId,
  };
}

/** Consumes the link and records the decision as that approver. */
export async function decideWithToken(
  db: PrismaClient,
  token: string,
  decision: DecisionType,
  comment: string | null,
  meta: { ipAddress?: string | null } = {},
) {
  const tokenHash = hashToken(token);
  const check = await inspectApprovalToken(db, token);
  if (!check.ok) {
    const messages = {
      invalid: "This link is not valid.",
      used: "This link has already been used.",
      expired: "This link has expired.",
      closed: "This request has already moved on, so the link no longer applies.",
    } as const;
    throw new ApprovalError(messages[check.reason]);
  }

  // Burn the link first, in a conditional update, so two clicks cannot both get through.
  const burned = await db.approvalToken.updateMany({
    where: { tokenHash, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (burned.count !== 1) throw new ApprovalError("This link has already been used.");

  try {
    return await recordDecision(
      db,
      { roundId: check.roundId, approverId: check.approverId, decision, comment, channel: "EMAIL" },
      meta,
    );
  } catch (error) {
    // The decision did not stick, so let the approver try again with the same link.
    await db.approvalToken.updateMany({ where: { tokenHash }, data: { usedAt: null } });
    throw error;
  }
}
