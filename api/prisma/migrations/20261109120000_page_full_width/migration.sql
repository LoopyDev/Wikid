-- Full width: a page's own setting, the same for everyone (it was kept in each browser)
ALTER TABLE "Page" ADD COLUMN "fullWidth" BOOLEAN NOT NULL DEFAULT false;
