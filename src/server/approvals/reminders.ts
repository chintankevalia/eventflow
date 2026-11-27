import type { PrismaClient } from "@prisma/client";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { reminderEmail } from "./emails";
import { buildEventSummary, resolveCcList, sendAndLog } from "./notifications";
import { getApprovalPolicy } from "./settings";

/**
 * Chases approvals that have gone quiet (PRD §3.1): a reminder once the stage's reminder window
 * passes, an escalation with the wider team copied once the escalation window passes, and a daily
 * nudge after that. Run on a schedule — see scripts/run-reminders.ts.
 */

const DAY_MS = 24 * 3_600_000;

export type ReminderRun = { reminded: number; escalated: number; checked: number };

export async function runApprovalReminders(db: PrismaClient, now = new Date()): Promise<ReminderRun> {
  const rounds = await db.approvalRound.findMany({
    where: { status: "PENDING", currentStageId: { not: null } },
    include: {
      event: { select: { id: true, code: true } },
      version: { select: { versionNo: true } },
      currentStage: { include: { approvers: { include: { user: true } } } },
      decisions: { select: { approverId: true, stageId: true } },
    },
  });

  const policy = await getApprovalPolicy(db);
  let reminded = 0;
  let escalated = 0;

  for (const round of rounds) {
    const stage = round.currentStage;
    if (!stage) continue;

    const waitingMs = now.getTime() - round.stageEnteredAt.getTime();
    const waitingHours = Math.floor(waitingMs / 3_600_000);
    const dueForEscalation = waitingHours >= stage.escalationHours;
    const dueForReminder = waitingHours >= stage.reminderHours;
    if (!dueForReminder) continue;

    // After the first notice, chase once a day rather than on every run.
    const lastTouch = round.lastReminderAt ?? round.escalatedAt;
    if (lastTouch && now.getTime() - lastTouch.getTime() < DAY_MS) continue;

    const isFirstEscalation = dueForEscalation && !round.escalatedAt;
    const pendingApprovers = stage.approvers.filter(
      (a) =>
        a.user.status === "ACTIVE" && !round.decisions.some((d) => d.approverId === a.userId && d.stageId === stage.id),
    );
    if (pendingApprovers.length === 0) continue;

    const summary = await buildEventSummary(db, round.eventId, round.version.versionNo);

    for (const entry of pendingApprovers) {
      // Reuse this approver's live link, or mint a fresh one if it has expired or been used.
      let token = generateToken();
      const existing = await db.approvalToken.findFirst({
        where: { roundId: round.id, stageId: stage.id, approverId: entry.userId, usedAt: null, expiresAt: { gt: now } },
      });
      if (existing) {
        // The raw token is not recoverable from its hash, so replace it with a new one.
        await db.approvalToken.update({ where: { id: existing.id }, data: { usedAt: now } });
      }
      await db.approvalToken.create({
        data: {
          tokenHash: hashToken(token),
          roundId: round.id,
          stageId: stage.id,
          approverId: entry.userId,
          expiresAt: new Date(now.getTime() + policy.tokenTtlHours * 3_600_000),
        },
      });

      const cc = dueForEscalation
        ? await resolveCcList(db, round.eventId, { excludeEmails: [entry.user.email], policy })
        : undefined;

      await sendAndLog(
        db,
        reminderEmail({
          to: entry.user.email,
          approverName: entry.user.name,
          summary,
          token,
          hoursWaiting: waitingHours,
          escalation: dueForEscalation,
          cc,
        }),
        {
          kind: dueForEscalation ? "approval.escalation" : "approval.reminder",
          eventId: round.eventId,
          roundId: round.id,
        },
      );
      token = "";
    }

    await db.approvalRound.update({
      where: { id: round.id },
      data: { lastReminderAt: now, ...(isFirstEscalation ? { escalatedAt: now } : {}) },
    });
    if (dueForEscalation) escalated += 1;
    else reminded += 1;
  }

  return { reminded, escalated, checked: rounds.length };
}
