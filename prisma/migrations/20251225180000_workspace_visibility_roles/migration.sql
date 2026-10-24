-- Add page visibility and update workspace roles
CREATE TYPE "PageVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

ALTER TABLE "Page"
ADD COLUMN "visibility" "PageVisibility" NOT NULL DEFAULT 'PUBLIC';

ALTER TYPE "WorkspaceRole" RENAME VALUE 'ADMIN' TO 'OWNER';
