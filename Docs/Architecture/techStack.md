# Tech Stack

## Frontend (web/)
- Vue 3: Main UI framework for the client app.
- Vite: Dev server and build tooling for the web bundle.
- Pinia: Client-side state management (workspaces, pages, UI state).
- Tiptap (ProseMirror): Rich-text editor and block system.
- @tanstack/vue-table: Data grid for database views.
- Bootstrap Icons + custom SVGs: Icon library for UI visuals.
- emoji-picker-element: Emoji/icon picker UI.

## Backend API (src/)
- NestJS: HTTP API and application layer.
- Prisma: ORM and schema migrations for persistence.
- JSON Web Tokens: Auth/session tokens for services.

## Collaboration (collab/)
- Hocuspocus Server: Realtime collaboration backend.
- Yjs + y-prosemirror: Shared document state and CRDT syncing.

## Database
- PostgreSQL: Primary datastore for pages, databases, rows, and forms.
- Compliance PostgreSQL (separate DB): Append-only storage for immutable compliance records.

## Storage
- AWS S3 SDK: File and asset storage integration.
- Compliance MinIO (separate instance/bucket): Immutable attachments for compliance records.

## Tooling
- TypeScript: Typed codebase for server, collab, and web.
- ts-node / tsx: Local dev runtime for TypeScript services.
