# Database Collaboration Structure

This document tracks how database pages are represented in Yjs for real-time collaboration
and how that state is persisted back to Prisma.

## Collab document naming
- Database pages use the collab room name `ws:<workspaceId>:db:<pageId>`.
- Doc pages continue to use `ws:<workspaceId>:<pageId>`.

## Yjs schema (database pages)
Top-level structures in the Yjs doc:

- `fieldOrder` (Y.Array of fieldId strings)
- `fields` (Y.Map of fieldId -> Y.Map)
  - `name` (string)
  - `type` (DatabaseFieldType string, ex: `TEXT`, `SELECT`)
  - `options` (plain JSON object, ex: `{ choices: [{ value, color? }] }`)
- `rowOrder` (Y.Array of rowId strings)
- `rows` (Y.Map of rowId -> Y.Map)
  - `data` (Y.Map of fieldId -> value)

Field and row ids are UUID strings used as map keys and order entries.

Cell values are stored as JSON values:
- TEXT/URL/DATE/SELECT: string
- NUMBER: number
- CHECKBOX: boolean
- MULTI_SELECT: array of strings

## Seeding flow
- The database UI still loads the API snapshot on mount.
- When the collab room syncs, if the Yjs doc has no fields/rows, it seeds the room
  from the API snapshot (fieldOrder/rowOrder + fields/rows maps).
- Once collab is enabled, UI writes go to Yjs only; Prisma persistence happens via
  the materializer.

## Persistence (materializer)
- The collab server stores Yjs state in `collab_doc`.
- The materializer reads the Yjs state, upserts database fields/rows, and deletes
  any rows/fields no longer present.
- Positions are derived from `fieldOrder`/`rowOrder` (index + 1).
- If the collab doc has no fields, materialization is skipped to avoid
  wiping databases before initial seed.

## Materialization rules
- Values are coerced to field types (number/boolean/date parsing).
- SELECT/MULTI_SELECT values are filtered to known choices.
