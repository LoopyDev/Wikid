-- Replace APP_ROLE with the role used by the application.
-- Run after applying the compliance schema migrations.

BEGIN;

-- Prevent updates/deletes on append-only tables.
CREATE OR REPLACE FUNCTION compliance_block_mutations()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: updates/deletes are not allowed';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'compliance_block_revision_mutations') THEN
    CREATE TRIGGER compliance_block_revision_mutations
    BEFORE UPDATE OR DELETE ON "ComplianceRecordRevision"
    FOR EACH ROW EXECUTE FUNCTION compliance_block_mutations();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'compliance_block_audit_mutations') THEN
    CREATE TRIGGER compliance_block_audit_mutations
    BEFORE UPDATE OR DELETE ON "ComplianceAuditEvent"
    FOR EACH ROW EXECUTE FUNCTION compliance_block_mutations();
  END IF;
END $$;

-- Restrict app role to SELECT/INSERT only on append-only tables.
REVOKE UPDATE, DELETE ON "ComplianceRecordRevision" FROM postgres;
REVOKE UPDATE, DELETE ON "ComplianceAuditEvent" FROM postgres;

COMMIT;
