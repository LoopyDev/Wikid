# Compliance V1 Implementation TODO

Based on `Docs/compliancePlan.md`.

## 0) Infra + Config
- [ ] Provision separate **Compliance Postgres** (own DB + user)
- [x] Add compliance DB connection/env wiring in app config
- [ ] Run `npm run prisma:generate:compliance` and `npm run prisma:migrate:compliance`
- [ ] Provision separate **MinIO** instance/bucket for compliance attachments
- [x] Add compliance MinIO credentials + endpoint config

## 1) Database Schema (Compliance DB)
- [x] Create tables: `Record`, `RecordRevision`, `AuditEvent`, `WorkflowVersion`, `Attachment`, `SchemaVersion`
- [x] Add `Record.workflowVersionId` + `RecordRevision.workflowVersionId`
- [x] Add `RecordRevision.schemaVersionId` + JSONB field snapshot
- [x] Add `Attachment.hash` (SHA-256), size, mime, filename, uploadedBy/At
- [x] Add `Record.legalHold`, `Record.status`, `Record.latestRevisionId`
- [x] Indexes: recordId, revisionId, workflowVersionId, schemaVersionId, timestamps

## 2) DB Immutability Guards
- [ ] Restrict UPDATE/DELETE on `RecordRevision` + `AuditEvent` for app role (see `prisma/compliance/immutability.sql`)
- [ ] Add safety trigger to reject UPDATE/DELETE on append-only tables (see `prisma/compliance/immutability.sql`)
- [ ] Confirm allowed updates for `Record` (status + latestRevisionId)

## 3) Compliance Service (Core Write Paths)
- [x] Create compliance service layer (single entry for all mutations)
- [x] Submit: validate, create `Record` + `RecordRevision` + `AuditEvent`
- [x] Amend: require reason, append new `RecordRevision` + `AuditEvent`
- [x] Transition: enforce workflow guards (reviewer/approval), append `AuditEvent`
- [x] Store/read `WorkflowVersion` JSON configs (immutable)

## 4) Draft Handling (Non-Compliance Path)
- [ ] Save drafts in workspace DB (non-compliance)
- [ ] On submit: validate against compliance schema/workflow
- [ ] Ensure draft → compliance submission path is explicit and audited

## 5) Attachments Integrity
- [x] Hash uploads server-side (SHA-256)
- [x] Store to **compliance MinIO** under hash-based key (no overwrite)
- [x] Persist hash in Attachment + embed in RecordRevision snapshot
- [x] Verify hash on **every download**

## 6) Read Logging + Exports
- [x] Log **revision views** and **exports** (not list views)
- [ ] Export pipeline (PDF/CSV) + log read event (JSON export stub implemented)
- [x] Verify attachment hashes during export

## 7) Retention + Legal Holds
- [x] Default to **indefinite retention**
- [x] Add archive-only state (no delete)
- [x] Implement `legalHold` guard that blocks archive
- [x] Add retention job stub (no-op unless policy configured)

## 8) Workflow Config UI + Defaults
- [ ] Create default workflow JSON (draft → submitted → review → closed)
- [ ] Guard rules: Review → Closed requires **reviewer + approval**
- [ ] Expose workflow config for compliance databases

## 9) Permissions + Roles
- [x] Basic workspace membership enforcement (owner/editor required for writes)
- [ ] Define reviewer/approver roles and assignment model
- [ ] Enforce server-side guards (no UI bypass)
- [ ] Ensure export permissions gated

## 10) Testing + Verification
- [ ] Unit tests for validation + workflow guard logic
- [ ] Integration tests for append-only enforcement
- [ ] Verify hash checks on download
- [ ] Audit log coverage for submit/amend/transition/export

## 11) Docs + Ops
- [ ] Update deployment docs for second Postgres + MinIO instance
- [ ] Add runbook for compliance backup/restore
- [ ] Link architecture diagram + implementation checklist in docs
