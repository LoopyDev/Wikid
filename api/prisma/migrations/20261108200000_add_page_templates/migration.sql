-- Page templates: pages marked as templates, kept out of the page tree and search
ALTER TABLE "Page" ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Page_workspaceId_isTemplate_idx" ON "Page"("workspaceId", "isTemplate");
