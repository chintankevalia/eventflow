-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PENDING', 'VALIDATED', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('OK', 'WARNING', 'ERROR', 'SKIPPED');

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "columnMap" JSONB NOT NULL DEFAULT '[]',
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "okRows" INTEGER NOT NULL DEFAULT 0,
    "warnRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "mapped" JSONB NOT NULL DEFAULT '{}',
    "status" "ImportRowStatus" NOT NULL DEFAULT 'OK',
    "issues" JSONB NOT NULL DEFAULT '[]',
    "eventId" TEXT,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_uploadedById_createdAt_idx" ON "import_batches"("uploadedById", "createdAt");

-- CreateIndex
CREATE INDEX "import_rows_batchId_rowIndex_idx" ON "import_rows"("batchId", "rowIndex");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
