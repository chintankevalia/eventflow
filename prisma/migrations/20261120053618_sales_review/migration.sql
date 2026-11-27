-- CreateEnum
CREATE TYPE "SalesReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'GO', 'NO_GO');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "salesReviewStatus" "SalesReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

-- CreateTable
CREATE TABLE "sales_reviews" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "totalScore" INTEGER,
    "decision" "SalesReviewStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_reviews_eventId_key" ON "sales_reviews"("eventId");

-- CreateIndex
CREATE INDEX "events_salesReviewStatus_idx" ON "events"("salesReviewStatus");

-- AddForeignKey
ALTER TABLE "sales_reviews" ADD CONSTRAINT "sales_reviews_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_reviews" ADD CONSTRAINT "sales_reviews_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
