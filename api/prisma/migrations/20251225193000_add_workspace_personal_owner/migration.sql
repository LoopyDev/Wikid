-- Add personal workspace owner reference
ALTER TABLE "Workspace"
ADD COLUMN "personalOwnerId" UUID;

ALTER TABLE "Workspace"
ADD CONSTRAINT "Workspace_personalOwnerId_fkey"
FOREIGN KEY ("personalOwnerId")
REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Workspace_personalOwnerId_key" ON "Workspace"("personalOwnerId");
