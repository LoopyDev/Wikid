import { describe, expect, it } from 'vitest';
import { collabDocumentTarget } from '../src/utils/collab-document-target.util';

const ws = '11111111-1111-4111-8111-111111111111';
const page = '22222222-2222-4222-8222-222222222222';

describe('what a live document name refers to', () => {
  it("reads a page's, a database's and a workspace's own documents", () => {
    expect(collabDocumentTarget(`ws:${ws}:${page}`)).toEqual({ type: 'page', workspaceId: ws, pageId: page, kind: 'DOC' });
    expect(collabDocumentTarget(`ws:${ws}:db:${page}`)).toEqual({ type: 'page', workspaceId: ws, pageId: page, kind: 'DATABASE' });
    expect(collabDocumentTarget(`ws:${ws}:events`)).toEqual({ type: 'workspace', workspaceId: ws });
    expect(collabDocumentTarget(`ws:${ws}:synced-blocks`)).toEqual({ type: 'workspace', workspaceId: ws });
  });

  it('refuses anything else: per-user names, ids that are not ids, extra parts', () => {
    for (const name of [
      `user:${ws}:${page}`,
      `ws:${ws}:not-a-page`,
      `ws:not-a-workspace:${page}`,
      `ws:${ws}:db:events`,
      `ws:${ws}:${page}:extra`,
      `ws:${ws}:sql:${page}`,
      '',
    ]) {
      expect(collabDocumentTarget(name)).toBeNull();
    }
  });
});
