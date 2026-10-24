# Document Save State (Collaboration UI)

This app shows a save status in the top bar during collaborative editing. The status is driven by the Hocuspocus provider and our own collab server broadcasts.

## What drives the status
- **Provider status:** `collabProvider.status` emits `connecting` / `connected` / `disconnected`.
- **Unsynced changes:** `collabProvider.hasUnsyncedChanges` signals whether local updates still need to sync.
- **Server “stored” signal:** The collab server broadcasts a stateless message `{ type: "stored", documentName, at }` from its `onStoreDocument` hook after persisting the Yjs state. The client listens for this and marks the doc as saved.

## Client logic (web/src/components/TiptapEditor.vue)
- On edit: emit “Saving…” and start a short watcher loop while `hasUnsyncedChanges` is true.
- On provider status:
  - `connecting` → “Connecting…”
  - `connected` → start the unsynced watcher (uses `hasUnsyncedChanges`)
  - `disconnected` → “Offline”
- On `synced` event: mark “Saved”.
- On stateless `{type:"stored"}`: mark “Saved”.
- Minimum display: “Saving…” is held for ~1s before flipping to “Saved” to avoid flicker when sync completes instantly.

## Server logic (collab/src/server.ts)
- Uses `@hocuspocus/extension-database` to persist Yjs state.
- In `onStoreDocument`, after persistence, broadcasts the stateless `{type:"stored", documentName, at}` message to all clients on that document.

## Notes
- There are no arbitrary save timers for persistence; the UI reflects provider sync state and the server’s store hook, with only a 1s UI hold to smooth the transition.
- If “Saving…” never clears, check whether `hasUnsyncedChanges` ever reaches false and whether the `stored` stateless message is arriving (look in the browser console/network logs).
