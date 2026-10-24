-- CreateTable
CREATE TABLE "DatabaseForm" (
    "id" UUID NOT NULL,
    "databaseId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "fields" JSONB,
    "position" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatabaseForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DatabaseForm_databaseId_idx" ON "DatabaseForm"("databaseId");

-- AddForeignKey
ALTER TABLE "DatabaseForm" ADD CONSTRAINT "DatabaseForm_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "Database"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
