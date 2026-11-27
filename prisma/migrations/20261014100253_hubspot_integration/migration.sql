-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('HUBSPOT_TO_EF', 'EF_TO_HUBSPOT', 'BOTH');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncObjectType" AS ENUM ('COMPANY', 'CONTACT', 'EVENT_ENGAGEMENT');

-- CreateTable
CREATE TABLE "hubspot_config" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "portalId" TEXT,
    "encryptedToken" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "companyFieldMap" JSONB NOT NULL DEFAULT '[]',
    "contactFieldMap" JSONB NOT NULL DEFAULT '[]',
    "createOnInbound" BOOLEAN NOT NULL DEFAULT true,
    "pushEngagements" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hubspot_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "objectType" "SyncObjectType" NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "efId" TEXT,
    "hubspotId" TEXT,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_errors" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "objectType" "SyncObjectType" NOT NULL,
    "efId" TEXT,
    "hubspotId" TEXT,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_jobs_status_scheduledAt_idx" ON "sync_jobs"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "sync_jobs_objectType_efId_idx" ON "sync_jobs"("objectType", "efId");

-- CreateIndex
CREATE INDEX "sync_errors_objectType_efId_idx" ON "sync_errors"("objectType", "efId");

-- CreateIndex
CREATE INDEX "sync_errors_createdAt_idx" ON "sync_errors"("createdAt");
