-- CreateEnum
CREATE TYPE "DashboardVisibility" AS ENUM ('PRIVATE', 'ROLES', 'EVERYONE');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "venue" TEXT;

-- CreateTable
CREATE TABLE "dashboards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "visibility" "DashboardVisibility" NOT NULL DEFAULT 'PRIVATE',
    "visibleRoles" "Role"[],
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_widgets" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "w" INTEGER NOT NULL,
    "h" INTEGER NOT NULL,
    "z" INTEGER NOT NULL DEFAULT 0,
    "spec" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_shares" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboards_ownerId_idx" ON "dashboards"("ownerId");

-- CreateIndex
CREATE INDEX "dashboards_visibility_idx" ON "dashboards"("visibility");

-- CreateIndex
CREATE INDEX "dashboard_widgets_dashboardId_idx" ON "dashboard_widgets"("dashboardId");

-- CreateIndex
CREATE INDEX "dashboard_shares_userId_idx" ON "dashboard_shares"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_shares_dashboardId_userId_key" ON "dashboard_shares"("dashboardId", "userId");

-- CreateIndex
CREATE INDEX "approval_decisions_stageId_idx" ON "approval_decisions"("stageId");

-- CreateIndex
CREATE INDEX "cost_line_items_categoryId_idx" ON "cost_line_items"("categoryId");

-- CreateIndex
CREATE INDEX "events_proposedDate_idx" ON "events"("proposedDate");

-- CreateIndex
CREATE INDEX "events_partnerOrgId_idx" ON "events"("partnerOrgId");

-- CreateIndex
CREATE INDEX "events_managerId_idx" ON "events"("managerId");

-- CreateIndex
CREATE INDEX "events_subtypeId_idx" ON "events"("subtypeId");

-- CreateIndex
CREATE INDEX "events_venue_idx" ON "events"("venue");

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_shares" ADD CONSTRAINT "dashboard_shares_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_shares" ADD CONSTRAINT "dashboard_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill the promoted venue from the answers blob. `custom.venue` is the key
-- scripts/seed-config.ts gives the field; events saved from now on have it written by
-- promotedColumns() in src/server/events/answers.ts. NULLIF keeps an empty string out.
UPDATE "events"
SET "venue" = NULLIF(TRIM("answers" ->> 'custom.venue'), '')
WHERE "answers" ? 'custom.venue';
