# Document Structure (Collab Yjs Doc)

- **Single Yjs document per page**: The page title and editor content live in the same Y.Doc scoped by the Hocuspocus `documentName`.
- **Document name format**: `ws:<workspaceId>:<pageId>` (workspace-scoped pages). This exact string is the room name used by the collab server and provider.
- **Shared types inside the doc**:
  - `title`: `Y.Text` storing the page title.
  - `default`: `Y.XmlFragment` storing the Tiptap body content.
- **Persistence**: The collab server persists the entire Y.Doc state (all types) to a base64-encoded filename under `collab/data/`. Title and body are saved together.
- **Auth**: Clients connect with a JWT (`COLLAB_JWT_SECRET`), validated against the `documentName` workspace segment (`ws:<workspaceId>`). Unauthorized workspace/doc names are rejected.
- **Client setup**:
  - Provider connects to `ws://<COLLAB_HOST>:<COLLAB_PORT>` with `{ name: documentName, token }`.
  - Title binds to `doc.getText('title')`; editor binds to `doc.getXmlFragment('default')`.
  - Save/status UI listens to the same provider events (`status`, `synced`, `unsyncedChanges`).
- **Stateless “stored” signal**: On `onStoreDocument`, server broadcasts `{ type: "stored", documentName, at }`, which the client uses to show “Saved”.
