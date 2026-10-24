# Per-document URLs

We now mirror the active document in the browser location to make sharing and reloading easier. This is a lightweight, client-side implementation—no router required.

## How it works

- On mount, `App.vue` parses the path for `/doc/<uuid>` and records the requested page ID.
- After pages finish loading, if the requested page exists in the store, it is auto-selected.
- Whenever `activePageId` changes, the URL is updated via `history.replaceState` to `/doc/<uuid>` (or `/` when no page is active).
- The dev sandbox at `/dev` is ignored so its preview remains unaffected.

## User flow

1. Open or navigate to `/doc/<page-id>` → the app loads and selects that page.
2. Selecting another page updates the URL, so refresh/bookmark/share keeps you on that document.
3. Navigating to `/dev` still shows the sandbox editor without changing pages.

## Notes

- The UUID matcher expects standard v4-like GUIDs: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` (case-insensitive).
- This is history-safe: we use `replaceState` to avoid polluting the back stack.
- No server changes are required; it’s purely front-end state + location sync. 
