# Databases Plan

Quick plan for adding database-style tables to Wikid while keeping simple tables.

## Goals (phase 1)
- Add a new page type that renders a database table only.
- Allow column (field) definitions with basic types.
- Allow row creation/editing with type-aware inputs.
- Keep simple Tiptap tables in regular pages unchanged.

## Goals (phase 2: inline table views)
- Add a `databaseView` block in documents that renders an inline table view of a database page.
- Persist view config in the document (column order/visibility for now).
- Reuse the same cell editing logic as database pages (read/write).

## Non-goals (phase 1)
- Relations between databases.
- Multiple view types beyond table (board/calendar).
- Per-view filtering/sorting/grouping (later).

## Proposed data model (backend)
Introduce database tables tied to pages/workspaces:
- `Page`: add `kind` (ex: `DOC` | `DATABASE`).
- `Database`: `id`, `workspaceId`, `pageId`, `createdAt`, `updatedAt`.
- `DatabaseField`: `id`, `databaseId`, `name`, `type`, `options` (JSON), `position`.
- `DatabaseRow`: `id`, `databaseId`, `position`, `data` (JSON map of `fieldId -> value`), timestamps.

Initial field types:
- `text`, `number`, `date`, `checkbox`, `select`, `multiSelect`, `url`.

Notes:
- Store values as JSON to keep schema flexible (typed parsing in API/UI).
- Positions use the same decimal ordering approach as pages.

## API surface (backend)
- `POST /databases` (create database for a page)
- `GET /databases/:id` (schema + rows)
- `POST /databases/:id/fields`
- `PATCH /databases/fields/:id`
- `DELETE /databases/fields/:id`
- `POST /databases/:id/rows`
- `PATCH /databases/rows/:id` (update row data)
- `DELETE /databases/rows/:id`

## Frontend (phase 1)
- Page creation: allow “Database” as a page kind.
- Routing/editor:
  - If `Page.kind === DATABASE`, render `DatabaseTable` component instead of `TiptapEditor`.
- `DatabaseTable` uses the Tiptap table extension for layout (columns/rows) but data is owned by the database API.
  - Table layout maps 1:1 to fields/rows.
  - Edits call API to update row data.
- Keep normal pages using standard Tiptap tables (no database linkage).

## Inline table views (phase 2)
- Create a `databaseView` node for Tiptap that stores `databaseId` + view config.
- Render a read/write table view inline inside documents.
- Reserve view config keys for future filtering/sorting (not active yet).

## Phased delivery
1) **Schema + API**
   - Add models and migrations.
   - Create endpoints for schema + row CRUD.
2) **UI for database pages**
   - “New database” page creation.
   - DatabaseTable component with basic cell editors.
3) **Polish**
   - Field type editing, validation, empty-state UX, column resize.
4) **Inline table views**
   - Add `databaseView` node + view configs.
5) **Relations (later)**
   - Field type `relation` + reciprocal link.

## Risks / open questions
- How to map Tiptap table operations (add/remove row/col) to DB updates cleanly.
- Concurrency/locking for database rows (collab vs REST).
- Row `data` JSON size vs querying/filtering later.
