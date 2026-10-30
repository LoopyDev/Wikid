-- Who added each database row (unknown for rows added before this)
ALTER TABLE "DatabaseRow" ADD COLUMN "createdById" UUID;
