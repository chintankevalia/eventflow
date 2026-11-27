-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "costLineId" TEXT;

-- CreateIndex
CREATE INDEX "attachments_costLineId_idx" ON "attachments"("costLineId");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_costLineId_fkey" FOREIGN KEY ("costLineId") REFERENCES "cost_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
