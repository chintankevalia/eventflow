-- CreateEnum
CREATE TYPE "LifecycleStatus" AS ENUM ('DRAFT', 'SCHEDULING', 'PENDING_APPROVAL', 'APPROVED', 'IN_EXECUTION', 'CLOSED', 'DROPPED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('NOT_RAISED', 'RECEIVED', 'PAID');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'DONE');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('PRESENTATION', 'AGENDA', 'PROPOSAL', 'QUOTATION', 'INVOICE', 'RECEIPT', 'REPORT', 'PHOTO', 'OTHER');

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "subtypeId" TEXT,
    "department" "Department" NOT NULL,
    "requesterId" TEXT NOT NULL,
    "ownerId" TEXT,
    "managerId" TEXT,
    "partnerOrgId" TEXT,
    "partnerTier" TEXT,
    "templateId" TEXT,
    "lifecycleStatus" "LifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "droppedReason" TEXT,
    "proposedDate" TIMESTAMP(3),
    "durationDays" INTEGER,
    "city" TEXT,
    "region" TEXT,
    "format" TEXT,
    "productFocus" TEXT,
    "estimatedCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approvedCost" DECIMAL(14,2),
    "actualCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "motadataContribution" DECIMAL(14,2),
    "partnerContribution" DECIMAL(14,2),
    "mdfAllocation" DECIMAL(14,2),
    "answers" JSONB NOT NULL DEFAULT '{}',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_stakeholders" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT,
    "externalName" TEXT,
    "role" TEXT NOT NULL,
    "responsibility" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_stakeholders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_line_items" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "categoryId" TEXT,
    "description" TEXT NOT NULL,
    "estimated" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approved" DECIMAL(14,2),
    "actual" DECIMAL(14,2),
    "vendor" TEXT,
    "invoiceRef" TEXT,
    "invoiceStatus" "InvoiceStatus" NOT NULL DEFAULT 'NOT_RAISED',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speakers" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT,
    "topic" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "speakers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'OTHER',
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_versions" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "eventTypeId" TEXT NOT NULL,
    "subtypeId" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "costLines" JSONB NOT NULL DEFAULT '[]',
    "tasks" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_code_counters" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "event_code_counters_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "events_code_key" ON "events"("code");

-- CreateIndex
CREATE INDEX "events_lifecycleStatus_proposedDate_idx" ON "events"("lifecycleStatus", "proposedDate");

-- CreateIndex
CREATE INDEX "events_department_lifecycleStatus_idx" ON "events"("department", "lifecycleStatus");

-- CreateIndex
CREATE INDEX "events_ownerId_idx" ON "events"("ownerId");

-- CreateIndex
CREATE INDEX "events_requesterId_idx" ON "events"("requesterId");

-- CreateIndex
CREATE INDEX "events_eventTypeId_idx" ON "events"("eventTypeId");

-- CreateIndex
CREATE INDEX "event_stakeholders_eventId_idx" ON "event_stakeholders"("eventId");

-- CreateIndex
CREATE INDEX "cost_line_items_eventId_idx" ON "cost_line_items"("eventId");

-- CreateIndex
CREATE INDEX "tasks_eventId_status_idx" ON "tasks"("eventId", "status");

-- CreateIndex
CREATE INDEX "tasks_ownerId_dueDate_idx" ON "tasks"("ownerId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_taskId_dependsOnTaskId_key" ON "task_dependencies"("taskId", "dependsOnTaskId");

-- CreateIndex
CREATE INDEX "speakers_eventId_idx" ON "speakers"("eventId");

-- CreateIndex
CREATE INDEX "attachments_eventId_kind_idx" ON "attachments"("eventId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "event_versions_eventId_versionNo_key" ON "event_versions"("eventId", "versionNo");

-- CreateIndex
CREATE INDEX "event_templates_eventTypeId_active_idx" ON "event_templates"("eventTypeId", "active");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "event_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_subtypeId_fkey" FOREIGN KEY ("subtypeId") REFERENCES "event_subtypes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_partnerOrgId_fkey" FOREIGN KEY ("partnerOrgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "event_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_stakeholders" ADD CONSTRAINT "event_stakeholders_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_stakeholders" ADD CONSTRAINT "event_stakeholders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_line_items" ADD CONSTRAINT "cost_line_items_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_line_items" ADD CONSTRAINT "cost_line_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speakers" ADD CONSTRAINT "speakers_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_versions" ADD CONSTRAINT "event_versions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_versions" ADD CONSTRAINT "event_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_templates" ADD CONSTRAINT "event_templates_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "event_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_templates" ADD CONSTRAINT "event_templates_subtypeId_fkey" FOREIGN KEY ("subtypeId") REFERENCES "event_subtypes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_templates" ADD CONSTRAINT "event_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
