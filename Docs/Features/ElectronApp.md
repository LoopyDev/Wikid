# Electron App Plan (macOS + Windows)

Goals: reuse the existing Vue app inside an Electron shell, let users log in, pull and cache all pages they can access, allow full editing while online, and switch to read-only when offline. Ship minimal scope first, then iterate.

## Platform + packaging
- Use Electron + your current Vue bundle. Package with `electron-builder` (outputs dmg/zip for macOS, exe/AppImage for Windows/Linux).
- Keep the web app served locally: preload the built `dist` files with `file://` or a local `app://` protocol. Set `VITE_API_URL` via env for the bundled app so it points to your API.
- Set up an auto-updater later; not required for first cut.

## App structure
- **Main process**: creates the BrowserWindow, handles app lifecycle, registers a custom protocol, exposes IPC for file system access and network status.
- **Preload script**: defines a safe IPC bridge (pages/pagesContent, auth token storage, sync commands, connectivity events).
- **Renderer**: your existing Vue app, with a small environment switch to run in “desktop” mode (to show offline banner, disable edits when offline, etc.).

## Data + caching
- Auth: store the login token securely (keytar or encrypted store). Expose it via IPC to the renderer for API calls.
- Pages index: cache the list of pages and metadata (id, title, icon, parentId, position, workspaceId, updatedAt) in a local DB (SQLite via better-sqlite3/Drizzle, or IndexedDB if you want all in renderer).
- Content: cache page content per page (raw editor doc JSON) with `updatedAt`. Also cache bin/soft-deleted flags if needed for parity.
- Assets: optionally cache referenced images in the app data dir to allow viewing offline; defer uploads until online.

## Online/offline handling
- Main process listens for connectivity changes; emits IPC events (`online-status-changed`).
- Renderer keeps a simple state machine: `online`, `syncing`, `offline`. Show a banner; when offline, disable editing UI (editor read-only, disable add/rename/delete/reorder).
- On reconnect, trigger a sync pass and flip to `online` only after a successful round-trip.

## Sync model (minimal-safe)
- On login (online only): fetch all accessible pages (personal + global) and store them locally; fetch content per page (batch/parallel with limits).
- While online:
  - Read from cache for initial render, then refresh in the background to update titles/content.
  - Apply edits immediately to the server as today; on success, update the local cache.
- While offline:
  - Block edits (read-only), allow copy/export.
- On reconnect:
  - Refresh the page list and content; overwrite local cache with server truth (since we didn’t allow offline edits, no conflicts).
  - If you later allow offline edits, introduce an outbox + conflict policy.

## Implementation steps
1) **Bootstrap Electron**: add `electron`, `electron-builder`, create `electron/main.js`, `electron/preload.js`, wire npm scripts (`electron:dev`, `electron:build`).
2) **Desktop env flag**: expose `process.env.WIKID_DESKTOP = true` and read it in the Vue app to enable the offline banner + read-only gating.
3) **Connectivity events**: in preload, listen to `navigator.onLine` and `require('dns')` checks; emit IPC to renderer.
4) **Local storage layer**: add a small storage module (SQLite or IndexedDB). Tables: `pages`, `page_content`, `meta` (lastSyncAt). Provide CRUD functions via IPC.
5) **Login flow**: reuse existing login UI; on success, save token via IPC. The API client in renderer requests the token from preload and attaches it.
6) **Cache hydration**: on app start (online), load cached pages/content for instant render; kick off a full fetch to refresh and repopulate cache.
7) **Read-only mode**: gate editor and page mutations when `offline`—e.g., pass `editable=false` to the editor, disable buttons for add/rename/delete/reorder, show tooltip “Unavailable offline”.
8) **Sync loop**: on `online` event, run: fetch pages list → diff and update cache → fetch content for changed pages → emit “synced” to renderer.
9) **Build outputs**: configure `electron-builder` targets (`mac` with universal/arm64, `win` with nsis). Set appId, icons, code signing later.

## Nice-to-haves (later)
- Background auto-updates.
- Asset caching and deferred uploads.
- Optional offline drafts + merge (outbox + CRDT) once the safe read-only mode feels solid.

## Steps (concrete sequence)
1) Scaffold Electron: add `electron/` with `main.js`, `preload.js`, wire `electron:dev`/`electron:build` scripts, and configure `electron-builder`.
2) Add desktop flag: expose `WIKID_DESKTOP` to the renderer to toggle offline banner/read-only behavior.
3) Build/run pipeline: point BrowserWindow to Vite dev server in dev; use `file://` (or custom protocol) to load the built `dist` in prod.
4) IPC bridge: in `preload`, expose APIs for token storage, cached pages/content access, and online-status events.
5) Local cache: implement storage (SQLite or IndexedDB) with tables for pages and page_content; hydrate cache on startup; refresh in the background when online.
6) Auth wiring: store tokens securely (keytar/encrypted store); have the API client request the token via IPC.
7) Online/offline state: listen for connectivity in main/preload; renderer flips between edit and read-only; surface banner and disable mutations when offline.
8) Sync loop: on login and on reconnect, fetch pages + content, update cache, and emit “synced”; use cached data for initial renders.
9) Packaging: configure `electron-builder` targets (macOS Intel/arm64, Windows), set appId/icons; add signing/notarization later.
