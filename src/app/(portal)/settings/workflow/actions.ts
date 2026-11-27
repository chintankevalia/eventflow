"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { ForbiddenError, requirePermission } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { saveApprovalPolicy, type ApprovalPolicy } from "@/server/approvals/settings";
import { db } from "@/server/db";
import { getRequestContext } from "@/server/request-context";

export type ActionResult = { ok: boolean; message?: string };

function toResult(err: unknown): ActionResult {
  if (err instanceof ZodError) return { ok: false, message: err.issues[0]?.message ?? "Check the values." };
  if (err instanceof ForbiddenError) return { ok: false, message: err.message };
  console.error(err);
  return { ok: false, message: "Something went wrong. Please try again." };
}

export async function addApproverAction(stageId: string, userId: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission("settings.manage");
    const [stage, user] = await Promise.all([
      db.approvalStage.findUnique({ where: { id: stageId } }),
      db.user.findFirst({ where: { id: userId, status: "ACTIVE" } }),
    ]);
    if (!stage || !user) return { ok: false, message: "Choose a valid person." };

    const max = await db.approvalStageApprover.aggregate({ where: { stageId }, _max: { sortOrder: true } });
    await db.approvalStageApprover.upsert({
      where: { stageId_userId: { stageId, userId } },
      update: {},
      create: { stageId, userId, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
    await writeAudit(db, {
      actorId: actor.id,
      action: "workflow.approver_added",
      entityType: "ApprovalStage",
      entityId: stageId,
      summary: `${actor.name} added ${user.name} as an approver at "${stage.name}"`,
      ipAddress: (await getRequestContext()).ipAddress,
    });
    revalidatePath("/settings/workflow");
    return { ok: true, message: `${user.name} added to ${stage.name}.` };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeApproverAction(stageId: string, userId: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission("settings.manage");
    const [stage, user] = await Promise.all([
      db.approvalStage.findUnique({ where: { id: stageId }, include: { _count: { select: { approvers: true } } } }),
      db.user.findUnique({ where: { id: userId } }),
    ]);
    if (!stage || !user) return { ok: false, message: "Not found." };
    if (stage._count.approvers <= 1) {
      return { ok: false, message: "A stage needs at least one approver. Add someone else first." };
    }

    await db.approvalStageApprover.deleteMany({ where: { stageId, userId } });
    await writeAudit(db, {
      actorId: actor.id,
      action: "workflow.approver_removed",
      entityType: "ApprovalStage",
      entityId: stageId,
      summary: `${actor.name} removed ${user.name} as an approver at "${stage.name}"`,
      ipAddress: (await getRequestContext()).ipAddress,
    });
    revalidatePath("/settings/workflow");
    return { ok: true, message: `${user.name} removed from ${stage.name}.` };
  } catch (err) {
    return toResult(err);
  }
}

const stageSettingsSchema = z.object({
  mode: z.enum(["ALL", "ANY", "SEQUENTIAL"]),
  reminderHours: z.coerce.number().int().min(1).max(720),
  escalationHours: z.coerce.number().int().min(1).max(720),
});

export async function updateStageAction(
  stageId: string,
  input: { mode: string; reminderHours: string; escalationHours: string },
): Promise<ActionResult> {
  try {
    const actor = await requirePermission("settings.manage");
    const data = stageSettingsSchema.parse(input);
    if (data.escalationHours < data.reminderHours) {
      return { ok: false, message: "Escalation must come at or after the reminder." };
    }
    const stage = await db.approvalStage.update({ where: { id: stageId }, data });
    await writeAudit(db, {
      actorId: actor.id,
      action: "workflow.stage_updated",
      entityType: "ApprovalStage",
      entityId: stageId,
      summary: `${actor.name} updated "${stage.name}": ${data.mode === "ALL" ? "all approvers" : data.mode === "ANY" ? "any one approver" : "in order"}, reminder ${data.reminderHours}h, escalation ${data.escalationHours}h`,
      ipAddress: (await getRequestContext()).ipAddress,
    });
    revalidatePath("/settings/workflow");
    return { ok: true, message: "Stage updated." };
  } catch (err) {
    return toResult(err);
  }
}

export async function updatePolicyAction(patch: Partial<ApprovalPolicy>): Promise<ActionResult> {
  try {
    const actor = await requirePermission("settings.manage");
    const next = await saveApprovalPolicy(db, patch);
    await writeAudit(db, {
      actorId: actor.id,
      action: "workflow.policy_updated",
      entityType: "AppSetting",
      entityId: "approval.policy",
      summary: `${actor.name} updated the approval notification policy`,
      after: next,
      ipAddress: (await getRequestContext()).ipAddress,
    });
    revalidatePath("/settings/workflow");
    return { ok: true, message: "Saved." };
  } catch (err) {
    return toResult(err);
  }
}
