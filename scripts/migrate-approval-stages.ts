/**
 * One-time data migration: two approval stages become three.
 *
 *   Before: 1 "Department approval" (ALL)   2 "Final approval" (ALL)
 *   After:  1 "Channel review" (ANY)   2 "Event approval" (ALL)   3 "Budget approval" (ALL)
 *
 * Stage *ids* never change — only `sequence` and `name` on the two existing rows — because
 * `ApprovalRound.currentStageId`, `ApprovalDecision.stageId` and `ApprovalToken.stageId` all
 * point at a stage by id. Renumbering in place keeps every one of those references valid, in
 * flight or historical, without touching them.
 *
 * Idempotent and safe to run on a fresh install: if stage 1 is not still named exactly
 * "Department approval" (the name `seed-config.ts` wrote before this migration), nothing is
 * touched — either it has already run, or an administrator has since renamed the stage, and a
 * blind rename would overwrite their choice.
 *
 *   npx tsx --env-file=.env scripts/migrate-approval-stages.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const OLD_STAGE_1 = "Department approval";
const OLD_STAGE_2 = "Final approval";

async function main() {
  const workflow = await db.approvalWorkflow.findFirst({
    where: { active: true },
    include: { stages: { orderBy: { sequence: "asc" } } },
  });
  if (!workflow) {
    console.log("No active approval workflow yet — nothing to migrate. seed-config will create the three stages directly.");
    return;
  }

  const stage1 = workflow.stages.find((s) => s.sequence === 1);
  const stage2 = workflow.stages.find((s) => s.sequence === 2);
  const stage3 = workflow.stages.find((s) => s.sequence === 3);

  if (stage3) {
    console.log("Already three stages — nothing to do.");
    return;
  }
  if (!stage1 || !stage2 || stage1.name !== OLD_STAGE_1 || stage2.name !== OLD_STAGE_2) {
    console.log(
      `Stage 1/2 do not match the expected pre-migration names ("${OLD_STAGE_1}", "${OLD_STAGE_2}") — ` +
        "an administrator has likely renamed them. Leaving the workflow as it is.",
    );
    return;
  }

  // Highest sequence first: moving 2 -> 3 before 1 -> 2 means the two updates never collide on
  // the (workflowId, sequence) unique constraint.
  await db.$transaction([
    db.approvalStage.update({
      where: { id: stage2.id },
      data: { sequence: 3, name: "Budget approval" },
    }),
    db.approvalStage.update({
      where: { id: stage1.id },
      data: { sequence: 2, name: "Event approval" },
    }),
    db.approvalStage.create({
      data: {
        workflowId: workflow.id,
        sequence: 1,
        name: "Channel review",
        mode: "ANY",
        reminderHours: 24,
        escalationHours: 48,
      },
    }),
  ]);

  console.log("Migrated: Channel review (new, no approvers yet) -> Event approval -> Budget approval.");
  console.log("Assign Channel review's approver(s) in Settings -> Approval workflow.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
