-- What the system admin changed in a workspace (set an owner, removed a member), shown to its members
CREATE TABLE "WorkspaceAdminAction" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetUserId" UUID,
    "targetName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceAdminAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkspaceAdminAction_workspaceId_createdAt_idx" ON "WorkspaceAdminAction"("workspaceId", "createdAt");

ALTER TABLE "WorkspaceAdminAction" ADD CONSTRAINT "WorkspaceAdminAction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
