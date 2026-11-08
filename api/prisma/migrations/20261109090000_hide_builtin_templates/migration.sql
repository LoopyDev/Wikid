-- Built-in page templates a workspace's owner has hidden in that workspace
ALTER TABLE "Workspace" ADD COLUMN "hiddenTemplates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
