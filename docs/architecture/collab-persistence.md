# Collab Persistence (API-backed)

## Overview
Collaboration state is stored in Postgres instead of local files. The collab server reads/writes Yjs updates via the API, and the API periodically materializes Yjs docs back into the primary tables (for now, only `Page.content`).

## Data model
New table:

```
CollabDoc
- documentName (PK)
- state (bytea)
- createdAt
- updatedAt
- materializedAt
- materializeRequestedAt
```

`state` holds the Yjs update for the full document. `materializedAt` tracks the last time the API wrote a snapshot into primary storage.

## Document naming
- Docs: `ws:<workspaceId>:<pageId>`
- Databases (reserved for future): `ws:<workspaceId>:db:<pageId>`
- Synced blocks: `ws:<workspaceId>:synced-blocks` (stored but not materialized)

## API endpoints (collab server -> API)
All endpoints require `Authorization: Bearer $COLLAB_API_SECRET`.

- `GET /collab/docs?documentName=...`
  - Returns `{ state: <base64> }` or 404.
- `PUT /collab/docs`
  - Body: `{ documentName, state }` (base64).
- `POST /collab/docs/materialize`
  - Body: `{ documentName }`.
  - Used on last disconnect to force a materialization run.

## Admin endpoints (UI)
These require `adminId=SYSTEM_ADMIN_ID` as a query parameter.

- `GET /collab/admin/docs?adminId=...`
  - Returns list of stored collab docs with `updatedAt`, `materializedAt`, `materializeRequestedAt`.
- `POST /collab/admin/materialize?adminId=...`
  - Body: `{ documentName }`.
  - Sets `materializeRequestedAt` so the materializer runs soon.
- `POST /collab/admin/purge?adminId=...`
  - Body: `{ confirm: "PURGE ALL DOCUMENTS" }`.
  - Deletes all pages (docs + databases), database rows/fields, blocks, and all collab Yjs snapshots.

The web app exposes these in the sidebar under "Sysadmin console" (visible to the system admin user).

## Collab server flow
1. `Database.fetch` calls `GET /collab/docs` and loads the Yjs state.
2. `Database.store` calls `PUT /collab/docs` with a new update.
3. `onDisconnect` checks `clientsCount` and calls `POST /collab/docs/materialize` when the last client leaves.
4. `onStoreDocument` still broadcasts the `stored` stateless message so the UI can show "Saved".

## Materialization flow (API server)
The API server runs a background poller:
- `COLLAB_MATERIALIZE_POLL_MS` (default 60s): how often to check for work.
- `COLLAB_MATERIALIZE_INTERVAL_MS` (default 5m): minimum time between materializations for a doc.

A doc is materialized when:
- `materializeRequestedAt` is newer than `materializedAt`, or
- the doc has newer updates and the minimum interval has passed.

For doc pages:
1. Load Yjs state from `CollabDoc`.
2. Convert the `default` Yjs fragment to ProseMirror JSON using the server schema.
3. Normalize it with `normalizeEditorContent`.
4. Update `Page.content`.
5. Update `materializedAt` and clear `materializeRequestedAt`.

Database materialization is not implemented yet; the parser and naming are in place for future work.

## Env vars
API server:
- `COLLAB_API_SECRET` (required)
- `COLLAB_MATERIALIZE_POLL_MS` (optional)
- `COLLAB_MATERIALIZE_INTERVAL_MS` (optional)

Collab server:
- `COLLAB_API_URL` (default `http://localhost:3000`)
- `COLLAB_API_SECRET` (required)
- `COLLAB_JWT_SECRET` (required for user auth)
- `COLLAB_STORE_DEBOUNCE_MS` (default `2000`)
- `COLLAB_STORE_MAX_DEBOUNCE_MS` (default `10000`)

## Migrations
Run Prisma migrations after pulling the changes:

```
npm run prisma:migrate -w api
```

Install new server-side dependencies:

```
npm install
```

## Notes
- The Yjs to ProseMirror conversion uses a server-side schema that mirrors the editor.
- If you add new editor nodes/marks, update `api/src/collab/collab-doc.schema.ts`.
