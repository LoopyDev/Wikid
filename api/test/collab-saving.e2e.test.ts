import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { API_URL, Session, USERS, createPage, createWorkspace, loginAs } from './helpers';

// What's typed in a live document gets saved, however big it gets, and the saved signal only comes
// once it has been.

const COLLAB_URL = API_URL.replace(/^http/, 'ws').replace(/\/api$/, '/collab');

let alice: Session;
let workspaceId: string;

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  workspaceId = await createWorkspace(alice);
});

describe('saving live documents', () => {
  it('saves a page whose live document is bigger than an ordinary request may be', async () => {
    const page = (await createPage(alice, workspaceId, { title: 'Very long page' })).id;
    const token = (await alice.post('/collab/token', { workspaceId })).body.token as string;
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({ url: COLLAB_URL });
    const provider = new HocuspocusProvider({ websocketProvider: socket, name: `ws:${workspaceId}:${page}`, document: doc, token });
    const saved: number[] = [];
    provider.on('stateless', ({ payload }: { payload: string }) => {
      if (JSON.parse(payload)?.type === 'stored') saved.push(Date.now());
    });
    provider.attach();
    await new Promise<void>((resolve) => provider.on('synced', () => resolve()));

    // Over 10 MB once sent: a few hundred long paragraphs, and a marker at the end
    const line = 'All work and no play makes for a very long page. '.repeat(400);
    doc.transact(() => {
      const fragment = doc.getXmlFragment('default');
      for (let i = 0; i < 520; i += 1) {
        const p = new Y.XmlElement('paragraph');
        p.insert(0, [new Y.XmlText(`${i} ${line}`)]);
        fragment.push([p]);
      }
      const last = new Y.XmlElement('paragraph');
      last.insert(0, [new Y.XmlText('The very end of the page')]);
      fragment.push([last]);
    });
    expect(Y.encodeStateAsUpdate(doc).byteLength).toBeGreaterThan(8 * 1024 * 1024);

    // Saved (the signal comes), and what's stored has it
    await expect.poll(() => saved.length, { timeout: 30_000, interval: 500 }).toBeGreaterThan(0);
    provider.destroy();
    socket.destroy();
    const markdown = (await alice.get(`/pages/${page}/markdown`)).body.markdown as string;
    expect(markdown.endsWith('The very end of the page')).toBe(true);
  }, 60_000);
});
