# Synced Blocks

This document describes how synced blocks work in the current implementation.

## Scope
- Cross-page synced blocks are enabled only for private pages (personal workspace).
- Collaboration must be enabled (collab token + doc name) for workspace sync to run.

## Data model
- Each block carries `attrs.id` (for example, `block-123`) via `BlockIdExtension`.
- Synced references carry `attrs.syncedFrom`.
  - Same-page references use `block-123`.
  - Cross-page references use `pageId:blockId`.
- Workspace sync document name: `ws:<workspaceId>:synced-blocks`.
  - Yjs map `syncedBlocks` stores block payloads keyed by `<pageId>:<blockId>`.
  - Yjs map `syncedLocks` stores unlock flags keyed by `<pageId>:<blockId>` (present = unlocked).

## Insert flow
1. Copy block link: `/ws/<workspaceId>/doc/<pageId>#block-<n>`.
2. On paste/insert, the URL is parsed for `workspaceId`, `pageId`, and `blockId`.
3. The link must point to the same workspace.
4. The source block is resolved in this order:
   - Current editor doc (same page).
   - Workspace `syncedBlocks` map.
   - REST API fetch of the target page.
5. If available, the source payload is written into `syncedBlocks`.
6. A reference node is inserted with `syncedFrom` set to `blockId` (same page) or `pageId:blockId` (cross-page).

## Sync behavior
- Same page:
  - `SyncedMirrorExtension` keeps sources and references aligned.
- Cross page:
  - `applyExternalSyncedUpdates` listens to the workspace map and updates:
    - References whose source is not present in the current doc.
    - Source blocks in this doc from the workspace map.
  - `updateSyncedWorkspaceSourcesFromDoc` publishes changes into the workspace map:
    - Local source blocks always publish.
    - References publish only if the source is not in the current doc and the reference is unlocked.
- Updates are scheduled on editor changes and after collab sync.

## Locks and editing from references
- Lock state is read from the workspace `syncedLocks` map when available, otherwise from the page doc.
- The bubble menu toggles unlock for the resolved workspace key.
- When unlocked and the source is not in the current doc, edits to a reference update the workspace map and propagate to the source page.

## Notes
- Cross-page syncing is currently gated to personal workspaces only.
- Frontend demo content is disabled; new page content should be seeded by the backend.
