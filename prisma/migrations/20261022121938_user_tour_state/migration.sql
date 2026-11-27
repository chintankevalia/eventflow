-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tourDismissed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tourSeenSections" TEXT[] DEFAULT ARRAY[]::TEXT[];
