-- CreateEnum
CREATE TYPE "PageKind" AS ENUM ('DOC', 'DATABASE');

-- CreateEnum
CREATE TYPE "DatabaseFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'CHECKBOX', 'SELECT', 'MULTI_SELECT', 'URL');

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "kind" "PageKind" NOT NULL DEFAULT 'DOC';

-- CreateTable
CREATE TABLE "Database" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Database_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatabaseField" (
    "id" UUID NOT NULL,
    "databaseId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DatabaseFieldType" NOT NULL,
    "options" JSONB,
    "position" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatabaseField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatabaseRow" (
    "id" UUID NOT NULL,
    "databaseId" UUID NOT NULL,
    "position" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatabaseRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Database_pageId_key" ON "Database"("pageId");

-- CreateIndex
CREATE INDEX "Database_workspaceId_idx" ON "Database"("workspaceId");

-- CreateIndex
CREATE INDEX "DatabaseField_databaseId_idx" ON "DatabaseField"("databaseId");

-- CreateIndex
CREATE INDEX "DatabaseRow_databaseId_idx" ON "DatabaseRow"("databaseId");

-- AddForeignKey
ALTER TABLE "Database" ADD CONSTRAINT "Database_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Database" ADD CONSTRAINT "Database_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseField" ADD CONSTRAINT "DatabaseField_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "Database"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseRow" ADD CONSTRAINT "DatabaseRow_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "Database"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
