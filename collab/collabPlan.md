## Collab rollout plan (Global workspace)

1) Doc naming
- Use a workspace-scoped namespace so multiple shared workspaces are easy.
- Proposal: `ws:<workspaceId>:<pageId>` for any shared workspace; optionally `user:<userId>:<pageId>` for private docs.

2) Auth & identity
- In `collab/src/server.ts` `onAuthenticate`, validate a JWT signed with `COLLAB_JWT_SECRET`.
- Claims: `sub` = userId, `workspaceIds` = array of allowed workspaceIds.
- Attach `userId` and `workspaceIds` to the context; reject if `documentName` workspace isn’t allowed.
- Client must send the JWT (e.g., `token` param) when connecting.

3) Persistence
- Implement `onLoadDocument` and `onStoreDocument` to load/save Yjs updates for each `documentName`.
- Storage options: DB via existing Nest/Prisma, object store, or file-based stub to start.
- Key records by `documentName` (e.g., `global:<pageId>`).

4) Client hookup
- Configure Tiptap collaboration (`@tiptap/extension-collaboration` / `@tiptap/y-tiptap`) to connect to `ws://<host>:1234`.
- Pass `documentName` using the `ws:<workspaceId>:<pageId>` format.
- Include auth token in the connection config so the server can enforce access.

5) Access control
- Server: block connections where `documentName` doesn’t match the user’s allowed workspace.
- Optionally add rate limits or doc size limits.

6) Validation & testing
- Start Hocuspocus (`npm run dev` in `collab/`), open two clients (Alice/Bob) to the same `global:<pageId>` doc, confirm live cursors/edits.
- Restart server to confirm persistence works (doc reloads content).
- Verify unauthorized token is rejected.


### Generating a dev JWT
node -e "console.log(require('jsonwebtoken').sign({ sub: 'u1', workspaceIds: ['global','personal-u1'] }, '[dev token here]'))"
