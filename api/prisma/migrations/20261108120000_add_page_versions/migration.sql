-- Page history: one row per editing session of a page
CREATE TABLE "PageVersion" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "content" JSONB NOT NULL,
    "editorIds" UUID[],
    "restoredFromId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PageVersion_pageId_createdAt_idx" ON "PageVersion"("pageId", "createdAt");

ALTER TABLE "PageVersion" ADD CONSTRAINT "PageVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
