import { createCollabProvider } from './collabSocket';

// Live "something changed" messages for a workspace. The collab server relays them on a
// content-free document per workspace (ws:<id>:events), sent by the API whenever pages are
// created, renamed, moved, set up, deleted or restored, and by the collab server when a database
// is saved.

/**
 * Joins a workspace's events channel. `getToken` returns a collab token (it's called again on
 * reconnect, so an expired token is replaced). Returns a function that leaves the channel.
 */
export function connectWorkspaceEvents({ url, workspaceId, getToken, onPagesChanged, onDatabaseChanged }) {
  const provider = createCollabProvider({
    url,
    name: `ws:${workspaceId}:events`,
    token: getToken,
    onStateless: ({ payload }) => {
      let message = null;
      try {
        message = JSON.parse(payload);
      } catch {
        return;
      }
      if (message?.workspaceId !== workspaceId) return;
      if (message.type === 'pages-changed') onPagesChanged(message);
      if (message.type === 'database-changed') onDatabaseChanged?.(message);
    },
  });
  return () => provider.destroy();
}
