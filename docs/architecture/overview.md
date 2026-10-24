# Wikid Architecture

## Overview
- Three Node services: a NestJS API (`api/src/`), a Hocuspocus collaboration server (`collab/`), and a Vue 3 + Vite frontend (`web/`).
- The editor is Tiptap v3 with custom extensions in `web/src/tiptap/`. Documents are ProseMirror JSON; live editing state is Yjs.
- Two Postgres databases, each with its own Prisma schema: the main database (`api/prisma/schema.prisma`) and an append-only compliance database (`api/prisma/compliance/schema.prisma`).
- File storage is S3-compatible (MinIO locally), with a separate bucket/instance for compliance attachments.
- An optional MCP server (`mcp/`) exposes workspace pages and databases to AI tools.

## Backend (NestJS)
- Entry: `api/src/main.ts` bootstraps Nest Express with a 10 MB body limit and CORS for `localhost:5173/5174`.
- Modules (`api/src/app.module.ts`):
  - `Prisma` / `CompliancePrisma`: PrismaClient singletons for each database.
  - `Pages`: page, block, and database CRUD; database templates (inventory, maintenance, assignments); forms; workspaces; users and admin endpoints.
  - `Collab`: endpoints the collab server calls to load/store Yjs state (`CollabDoc`), plus a materializer that periodically writes Yjs docs back to `Page.content` and database rows.
  - `Compliance`: compliance records, workflow transitions (Draft → Submitted → In Review → Closed/Sealed), and compliance uploads.
  - `Uploads`: S3 uploads via `@aws-sdk/client-s3`; `PUBLIC_API_URL` sets the absolute URL base.
  - `Embeds`: `GET|POST /embeds/link` fetches Open Graph/title/description/image metadata for link previews.
  - `Ai`: `POST /ai/generate` streams Claude responses over SSE (needs `ANTHROPIC_API_KEY`).
  - HTML export (`api/src/export/`) and PDF rendering via Puppeteer (`api/src/pdf/`).
- Auth (`api/src/auth/`): `POST /auth/login` checks an email + password (scrypt hashes) and sets a signed `wikid_session` cookie (JWT, `SESSION_SECRET`). `SessionGuard` is registered globally and rejects requests without a valid session. It then overwrites the `userId` / `userName` / `adminId` request params with the session user, so the service-layer permission checks use the real identity. Routes marked `@Public()` skip the guard: login/logout, and the collab persistence endpoints, which check `COLLAB_API_SECRET` instead. In handlers, `@CurrentUser()` returns the session user.
- PDF export: Puppeteer is given a session cookie for the requesting user so the print page can call the API.

## Collaboration
- The `collab/` server runs Hocuspocus on `:1234`. Clients authenticate with a short-lived JWT signed with `COLLAB_JWT_SECRET`.
- The collab server persists Yjs updates through the API (authenticated with `COLLAB_API_SECRET`), debounced by `COLLAB_STORE_DEBOUNCE_MS`.
- Doc names are `ws:<workspaceId>:<pageId>` for pages and `ws:<workspaceId>:db:<pageId>` for databases. See [`collab-persistence.md`](collab-persistence.md) and [`database-collab-structure.md`](database-collab-structure.md).

## Data Layer (Prisma + Postgres)
- Main models: `User`, `Workspace`, `UserWorkspace`, `Page` (hierarchical via `parentId`; kinds `DOC` / `DATABASE`), `Database`, `DatabaseField`, `DatabaseRow`, `DatabaseForm`, `CollabDoc`, `FileAsset`.
- The compliance schema keeps immutable records; `api/prisma/compliance/immutability.sql` adds database-level guards.
- `api/prisma/seed.ts` seeds demo users and a starter workspace.

## Frontend (Vite + Vue 3)
- `web/src/App.vue` is the main shell (sidebar, page tree, context menus); `web/src/stores/workspace.js` (Pinia) holds API calls, autosave, and page state; `web/src/api/client.js` wraps every endpoint.
- `web/src/components/TiptapEditor.vue` wires up the editor: slash commands, callouts, columns, toggle headings, inline database views and forms, page links, draw.io diagrams, Gaussian splat embeds, table of contents, and AI actions.
- `web/src/PrintApp.vue` is a stripped-down shell used for PDF rendering.
- Env: `VITE_API_URL` (default `http://localhost:3000`) and `VITE_COLLAB_URL` (default `ws://localhost:1234`).
