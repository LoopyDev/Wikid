-- Full-text search over pages (title and document text) and database rows (cell values).
-- Postgres keeps the search columns up to date on every write; GIN indexes make them fast.

-- The text of a page document (ProseMirror JSON): every "text" value, in order.
CREATE FUNCTION wikid_doc_text(doc jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(string_agg(t #>> '{}', ' '), '')
  FROM jsonb_path_query(coalesce(doc, 'null'::jsonb), 'strict $.**.text') AS t
$$;

-- The text of a database row: its string and number values, leaving out ids (relations store them).
CREATE FUNCTION wikid_row_text(data jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(string_agg(v, ' '), '')
  FROM (
    SELECT t #>> '{}' AS v
    FROM jsonb_path_query(coalesce(data, 'null'::jsonb), 'strict $.** ? (@.type() == "string" || @.type() == "number")') AS t
  ) values_found
  WHERE v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

ALTER TABLE "Page" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english', wikid_doc_text("content")), 'B')
) STORED;
CREATE INDEX "Page_searchVector_idx" ON "Page" USING GIN ("searchVector");

ALTER TABLE "DatabaseRow" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  to_tsvector('english', wikid_row_text("data"))
) STORED;
CREATE INDEX "DatabaseRow_searchVector_idx" ON "DatabaseRow" USING GIN ("searchVector");
