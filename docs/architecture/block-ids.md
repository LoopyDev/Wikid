# Document structure and block IDs

We use per-document stable block IDs to support deep linking to blocks and future block-level features.

- Each block carries a string ID unique within its document, assigned by a monotonic per-doc counter (`blockSeq`). No recycling; deleted blocks free the ID implicitly.
- IDs are persisted in the editor JSON (`attrs.id`) and survive reloads/collab.
- On load, any block missing an ID gets a new one; the counter advances past all seen IDs so future blocks are unique.
- Blocks created later (add/duplicate) get `block-{counter}` format (or similar), incrementing the counter each time.
- Deep links should prefer `#block-{id}`; avoid position-based anchors.
- Counter range: 64-bit safe space; practical wrap is impossible. No global uniqueness needed—document-level is enough.
