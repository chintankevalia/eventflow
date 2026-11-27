-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID');

-- AlterTable
ALTER TABLE "cost_line_items" ADD COLUMN     "paymentStatus" "PaymentStatus";

-- CreateTable
CREATE TABLE "post_event_results" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "actualAttendance" INTEGER,
    "companiesEngaged" INTEGER,
    "newLeads" INTEGER,
    "sqls" INTEGER,
    "opportunities" INTEGER,
    "partnerParticipation" TEXT,
    "meetingsConducted" INTEGER,
    "satisfactionScore" TEXT,
    "followUpOwner" TEXT,
    "nextAction" TEXT,
    "actualRoi" TEXT,
    "actualRoiJustification" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_event_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_event_results_eventId_key" ON "post_event_results"("eventId");

-- AddForeignKey
ALTER TABLE "post_event_results" ADD CONSTRAINT "post_event_results_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
