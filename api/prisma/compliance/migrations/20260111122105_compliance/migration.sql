-- CreateEnum
CREATE TYPE "ComplianceRecordStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEW', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ComplianceRevisionKind" AS ENUM ('SUBMIT', 'AMEND');

-- CreateEnum
CREATE TYPE "ComplianceAuditEventType" AS ENUM ('CREATE', 'SUBMIT', 'AMEND', 'TRANSITION', 'EXPORT', 'REVISION_VIEW', 'ARCHIVE', 'LEGAL_HOLD', 'LEGAL_HOLD_RELEASE');

-- CreateTable
CREATE TABLE "ComplianceRecord" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceDatabaseId" UUID NOT NULL,
    "status" "ComplianceRecordStatus" NOT NULL DEFAULT 'SUBMITTED',
    "latestRevisionId" UUID,
    "workflowVersionId" UUID,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRecordRevision" (
    "id" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "workflowVersionId" UUID,
    "schemaVersionId" UUID,
    "kind" "ComplianceRevisionKind" NOT NULL DEFAULT 'SUBMIT',
    "data" JSONB NOT NULL,
    "attachmentHashes" JSONB,
    "createdById" UUID,
    "createdByName" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceRecordRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceAuditEvent" (
    "id" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "revisionId" UUID,
    "eventType" "ComplianceAuditEventType" NOT NULL,
    "actorId" UUID,
    "actorName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceWorkflowVersion" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceDatabaseId" UUID NOT NULL,
    "config" JSONB NOT NULL,
    "createdById" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceWorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceSchemaVersion" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceDatabaseId" UUID NOT NULL,
    "schema" JSONB NOT NULL,
    "createdById" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceSchemaVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceAttachment" (
    "id" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "revisionId" UUID,
    "hash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "uploadedById" UUID,
    "uploadedByName" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRecord_latestRevisionId_key" ON "ComplianceRecord"("latestRevisionId");

-- CreateIndex
CREATE INDEX "ComplianceRecord_workspaceId_idx" ON "ComplianceRecord"("workspaceId");

-- CreateIndex
CREATE INDEX "ComplianceRecord_sourceDatabaseId_idx" ON "ComplianceRecord"("sourceDatabaseId");

-- CreateIndex
CREATE INDEX "ComplianceRecord_status_idx" ON "ComplianceRecord"("status");

-- CreateIndex
CREATE INDEX "ComplianceRecordRevision_recordId_idx" ON "ComplianceRecordRevision"("recordId");

-- CreateIndex
CREATE INDEX "ComplianceRecordRevision_workflowVersionId_idx" ON "ComplianceRecordRevision"("workflowVersionId");

-- CreateIndex
CREATE INDEX "ComplianceRecordRevision_schemaVersionId_idx" ON "ComplianceRecordRevision"("schemaVersionId");

-- CreateIndex
CREATE INDEX "ComplianceAuditEvent_recordId_idx" ON "ComplianceAuditEvent"("recordId");

-- CreateIndex
CREATE INDEX "ComplianceAuditEvent_revisionId_idx" ON "ComplianceAuditEvent"("revisionId");

-- CreateIndex
CREATE INDEX "ComplianceAuditEvent_eventType_idx" ON "ComplianceAuditEvent"("eventType");

-- CreateIndex
CREATE INDEX "ComplianceWorkflowVersion_workspaceId_idx" ON "ComplianceWorkflowVersion"("workspaceId");

-- CreateIndex
CREATE INDEX "ComplianceWorkflowVersion_sourceDatabaseId_idx" ON "ComplianceWorkflowVersion"("sourceDatabaseId");

-- CreateIndex
CREATE INDEX "ComplianceSchemaVersion_workspaceId_idx" ON "ComplianceSchemaVersion"("workspaceId");

-- CreateIndex
CREATE INDEX "ComplianceSchemaVersion_sourceDatabaseId_idx" ON "ComplianceSchemaVersion"("sourceDatabaseId");

-- CreateIndex
CREATE INDEX "ComplianceAttachment_recordId_idx" ON "ComplianceAttachment"("recordId");

-- CreateIndex
CREATE INDEX "ComplianceAttachment_revisionId_idx" ON "ComplianceAttachment"("revisionId");

-- CreateIndex
CREATE INDEX "ComplianceAttachment_hash_idx" ON "ComplianceAttachment"("hash");

-- AddForeignKey
ALTER TABLE "ComplianceRecord" ADD CONSTRAINT "ComplianceRecord_latestRevisionId_fkey" FOREIGN KEY ("latestRevisionId") REFERENCES "ComplianceRecordRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRecord" ADD CONSTRAINT "ComplianceRecord_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "ComplianceWorkflowVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRecordRevision" ADD CONSTRAINT "ComplianceRecordRevision_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ComplianceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRecordRevision" ADD CONSTRAINT "ComplianceRecordRevision_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "ComplianceWorkflowVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRecordRevision" ADD CONSTRAINT "ComplianceRecordRevision_schemaVersionId_fkey" FOREIGN KEY ("schemaVersionId") REFERENCES "ComplianceSchemaVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAuditEvent" ADD CONSTRAINT "ComplianceAuditEvent_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ComplianceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAuditEvent" ADD CONSTRAINT "ComplianceAuditEvent_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ComplianceRecordRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAttachment" ADD CONSTRAINT "ComplianceAttachment_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ComplianceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAttachment" ADD CONSTRAINT "ComplianceAttachment_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ComplianceRecordRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
