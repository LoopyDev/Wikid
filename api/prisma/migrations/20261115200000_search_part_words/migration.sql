-- Search finds part of a word too: a word cut off part way ("organiz", where the word search keeps
-- "organization" as "organ"), or from its middle ("ployment"). Trigram indexes over the lower-case
-- text make "contains" matches quick; the expressions here are the ones the search uses.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Page_searchText_trgm_idx" ON "Page"
  USING GIN ((lower(coalesce("title", '') || ' ' || wikid_doc_text("content"))) gin_trgm_ops);

CREATE INDEX "DatabaseRow_searchText_trgm_idx" ON "DatabaseRow"
  USING GIN ((lower(wikid_row_text("data"))) gin_trgm_ops);
