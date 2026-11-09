import { isUuid } from './uuid.util';

// Documents that belong to a workspace as a whole rather than to a page: live "pages changed"
// events, and the sources of synced blocks
export const WORKSPACE_DOCUMENTS = ['events', 'synced-blocks'];

export type CollabDocumentTarget =
  | { type: 'workspace'; workspaceId: string }
  | { type: 'page'; workspaceId: string; pageId: string; kind: 'DOC' | 'DATABASE' };

/**
 * What a live document's name says it is: a workspace's own document, or a page's or database's
 * (`ws:<workspace>:<page>`, `ws:<workspace>:db:<page>`). Null for anything else, including the
 * per-user names the app doesn't use. Says nothing about whether that's true: see authorizeDocument.
 */
export function collabDocumentTarget(documentName: string): CollabDocumentTarget | null {
  const parts = String(documentName || '').split(':');
  const [scope, workspaceId, third, fourth] = parts;
  if (scope !== 'ws' || !isUuid(workspaceId)) return null;
  if (parts.length === 3 && WORKSPACE_DOCUMENTS.includes(third)) return { type: 'workspace', workspaceId };
  if (parts.length === 3 && isUuid(third)) return { type: 'page', workspaceId, pageId: third, kind: 'DOC' };
  if (parts.length === 4 && third === 'db' && isUuid(fourth)) return { type: 'page', workspaceId, pageId: fourth, kind: 'DATABASE' };
  return null;
}
