# Trailing Empty Blocks on Reopen

## Issue
Reopening a doc adds an empty paragraph block underneath existing content each time.

## Root cause
In collab mode, the editor boots with a local ProseMirror doc that contains a single empty paragraph (schema requires `doc: block+`). That placeholder is treated as real content and synced into the shared doc before the stored content is seeded, so each reopen contributes another blank block.

## Fix
- Treat a single empty paragraph as "empty" when deciding whether to seed the collab doc from `props.doc`.
- Capture the id of the initial auto-inserted empty paragraph, and remove it after the first sync if the doc now has real content.
- Only runs in collab mode; user-inserted empty paragraphs are preserved.

## Implementation
- `web/src/components/TiptapEditor.vue`
  - `seedCollabDocFromProps`: ignore a lone empty paragraph for `hasCurrent`.
  - `captureInitialAutoBlock` + `pruneInitialAutoBlock`: track and remove the initial placeholder paragraph after sync.

## Verification
- Open a doc with a single text block, close/reopen multiple times: no new empty blocks appear.
- Add multiple empty paragraphs manually, reopen: those remain intact.

## Expected trailing paragraphs (by design)
- Image slash command explicitly inserts a paragraph after the image so the cursor can continue below the block (`web/src/components/TiptapEditor.vue`).
- Horizontal rule command inserts a paragraph when the rule is at the end of the document to keep a valid textblock after it (Tiptap `HorizontalRule` command).
- The "insert new block below" handle action inserts a new paragraph with `/` to trigger the slash menu (`web/src/components/TiptapEditor.vue`).
