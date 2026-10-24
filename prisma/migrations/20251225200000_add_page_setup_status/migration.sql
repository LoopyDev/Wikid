-- Add setup status to pages
CREATE TYPE "PageSetupStatus" AS ENUM ('PENDING', 'COMPLETE');

ALTER TABLE "Page"
ADD COLUMN "setupStatus" "PageSetupStatus" NOT NULL DEFAULT 'COMPLETE';
