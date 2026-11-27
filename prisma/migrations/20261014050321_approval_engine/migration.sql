-- CreateEnum
CREATE TYPE "StageMode" AS ENUM ('ALL', 'ANY', 'SEQUENTIAL');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_CHANGES');

-- CreateEnum
CREATE TYPE "DecisionChannel" AS ENUM ('PORTAL', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "approval_workflows" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_stages" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "mode" "StageMode" NOT NULL DEFAULT 'ALL',
    "reminderHours" INTEGER NOT NULL DEFAULT 24,
    "escalationHours" INTEGER NOT NULL DEFAULT 48,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_stage_approvers" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_stage_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_rounds" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "currentStageId" TEXT,
    "status" "RoundStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReminderAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),

    CONSTRAINT "approval_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" "DecisionType" NOT NULL,
    "comment" TEXT,
    "channel" "DecisionChannel" NOT NULL DEFAULT 'PORTAL',
    "ipAddress" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "roundId" TEXT,
    "kind" TEXT NOT NULL,
    "recipients" TEXT[],
    "ccList" TEXT[],
    "subject" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'SENT',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_stages_workflowId_sequence_key" ON "approval_stages"("workflowId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "approval_stage_approvers_stageId_userId_key" ON "approval_stage_approvers"("stageId", "userId");

-- CreateIndex
CREATE INDEX "approval_rounds_status_stageEnteredAt_idx" ON "approval_rounds"("status", "stageEnteredAt");

-- CreateIndex
CREATE INDEX "approval_rounds_eventId_idx" ON "approval_rounds"("eventId");

-- CreateIndex
CREATE INDEX "approval_decisions_approverId_decidedAt_idx" ON "approval_decisions"("approverId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "approval_decisions_roundId_stageId_approverId_key" ON "approval_decisions"("roundId", "stageId", "approverId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_tokens_tokenHash_key" ON "approval_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "approval_tokens_roundId_approverId_idx" ON "approval_tokens"("roundId", "approverId");

-- CreateIndex
CREATE INDEX "notification_logs_eventId_createdAt_idx" ON "notification_logs"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_logs_status_createdAt_idx" ON "notification_logs"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "approval_stages" ADD CONSTRAINT "approval_stages_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "approval_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_stage_approvers" ADD CONSTRAINT "approval_stage_approvers_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "approval_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_stage_approvers" ADD CONSTRAINT "approval_stage_approvers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_rounds" ADD CONSTRAINT "approval_rounds_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_rounds" ADD CONSTRAINT "approval_rounds_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "event_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_rounds" ADD CONSTRAINT "approval_rounds_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "approval_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_rounds" ADD CONSTRAINT "approval_rounds_currentStageId_fkey" FOREIGN KEY ("currentStageId") REFERENCES "approval_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_rounds" ADD CONSTRAINT "approval_rounds_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "approval_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "approval_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_tokens" ADD CONSTRAINT "approval_tokens_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "approval_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_tokens" ADD CONSTRAINT "approval_tokens_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "approval_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_tokens" ADD CONSTRAINT "approval_tokens_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
