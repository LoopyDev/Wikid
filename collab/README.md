# Wikid Collab (Hocuspocus)

### Install
```bash
cd collab
npm install
```

### Run (dev)
```bash
npm run dev
# listens on ws://0.0.0.0:1234 by default
```

### Run (build/start)
```bash
npm run build
npm start
```

### Env
- `COLLAB_PORT` (default `1234`)
- `COLLAB_HOST` (default `0.0.0.0`)
- `COLLAB_JWT_SECRET` (required) shared secret for signing/verifying collab JWTs
- `COLLAB_API_URL` (default `http://localhost:3000`) API base URL for persistence
- `COLLAB_API_SECRET` (required) shared secret for collab server -> API persistence calls
- `COLLAB_STORE_DEBOUNCE_MS` (default `2000`) debounce for onStoreDocument
- `COLLAB_STORE_MAX_DEBOUNCE_MS` (default `10000`) max debounce for onStoreDocument

JWT expectations (for clients):
- Include a JWT in the `token` field when connecting.
- Claims: `sub` = userId (required), `workspaceIds` = array of workspace IDs allowed for `ws:<workspaceId>:<pageId>` documents.
- The server rejects if the doc’s workspaceId isn’t in `workspaceIds`, or if `sub` doesn’t match a `user:<userId>:<pageId>` doc.

### Notes
- `onLoadDocument` / `onStoreDocument` are stubs; wire persistence (DB/object store) keyed by `documentName` to save Yjs updates.
- The client should connect via WebSocket to the host/port above and pass a token matching `COLLAB_AUTH_TOKEN` when set.
