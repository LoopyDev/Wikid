-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "wikiHomeId" UUID,
ADD COLUMN     "wikiConfig" JSONB,
ADD COLUMN     "isHidden" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DatabaseRow" ADD COLUMN     "pageId" UUID;

-- CreateIndex
CREATE INDEX "Page_wikiHomeId_idx" ON "Page"("wikiHomeId");

-- CreateIndex
CREATE INDEX "DatabaseRow_pageId_idx" ON "DatabaseRow"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "DatabaseRow_databaseId_pageId_key" ON "DatabaseRow"("databaseId", "pageId");

-- AddForeignKey
ALTER TABLE "DatabaseRow" ADD CONSTRAINT "DatabaseRow_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
