import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { API_URL, Session, USERS, addMember, createPage, createWorkspace, loginAs, unique } from './helpers';

// A page's live document is filled from its saved content by the server, once, however many people
// open it at the same moment; and restoring a version is done there too, so two restores at once
// can't put the content in twice.

const COLLAB_URL = API_URL.replace(/^http/, 'ws').replace(/\/api$/, '/collab');
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

let alice: Session;
let bob: Session;
let workspaceId: string;

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  bob = await loginAs(USERS.bob.email);
  workspaceId = await createWorkspace(alice);
  await addMember(alice, workspaceId, USERS.bob.email, 'EDITOR');
});

/** Opens a page's live document and keeps it open; `paragraphs()` reads what it holds. */
async function openLive(session: Session, pageId: string) {
  const token = (await session.post('/collab/token', { workspaceId })).body.token as string;
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: COLLAB_URL });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `ws:${workspaceId}:${pageId}`, document: doc, token });
  provider.attach();
  await new Promise<void>((resolve) => provider.on('synced', () => resolve()));
  return {
    doc,
    // Each block's text, read from its text items (without the formatting)
    paragraphs: () =>
      doc
        .getXmlFragment('default')
        .toArray()
        .map((node) =>
          node instanceof Y.XmlElement
            ? node
                .toArray()
                .map((child) => (child instanceof Y.XmlText ? child.toDelta().map((op: { insert: unknown }) => (typeof op.insert === 'string' ? op.insert : '')).join('') : ''))
                .join('')
            : '',
        ),
    title: () => doc.getText('title').toString(),
    close: () => {
      provider.destroy();
      socket.destroy();
    },
  };
}

const versions = async (pageId: string) => (await alice.get(`/pages/${pageId}/versions`)).body as any[];

describe('filling live documents', () => {
  it("fills a page's live document from its saved content once, however many open it at the same moment", async () => {
    const page = (await createPage(alice, workspaceId, { title: unique('Shared notes') })).id;
    expect((await alice.put(`/pages/${page}/content`, { content: { type: 'doc', content: [p('One'), p('Two'), p('Three')] } })).status).toBe(200);

    const opened = await Promise.all([openLive(alice, page), openLive(bob, page), openLive(alice, page)]);
    for (const live of opened) {
      expect(live.paragraphs()).toEqual(['One', 'Two', 'Three']);
    }
    opened.forEach((live) => live.close());
    expect((await alice.get(`/pages/${page}/markdown`)).body.markdown).toBe('One\n\nTwo\n\nThree');
  });

  it('restores a version on the page itself, title too, and two restores at once put it in once', async () => {
    const page = (await createPage(alice, workspaceId, { title: 'First title' })).id;
    expect((await alice.put(`/pages/${page}/content`, { content: { type: 'doc', content: [p('Original')] } })).status).toBe(200);
    const [original] = await versions(page);
    // Restoring it as it is ends that version, so what follows is a version of its own
    expect((await alice.post(`/pages/${page}/versions/${original.id}/restore`)).status).toBe(201);
    expect((await alice.patch(`/pages/${page}`, { title: 'Second title' })).status).toBe(200);
    expect((await alice.put(`/pages/${page}/content`, { content: { type: 'doc', content: [p('Original'), p('Added later')] } })).status).toBe(200);

    const live = await openLive(alice, page);
    expect(live.paragraphs()).toEqual(['Original', 'Added later']);
    const both = await Promise.all([
      alice.post(`/pages/${page}/versions/${original.id}/restore`),
      bob.post(`/pages/${page}/versions/${original.id}/restore`),
    ]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);

    await expect.poll(() => live.paragraphs(), { timeout: 10_000 }).toEqual(['Original']);
    expect(live.title()).toBe('First title');
    live.close();
    expect((await alice.get(`/pages/${page}`)).body.title).toBe('First title');
    expect((await alice.get(`/pages/${page}/markdown`)).body.markdown).toBe('Original');
  });
});
