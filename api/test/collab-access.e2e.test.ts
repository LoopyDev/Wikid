import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { API_URL, Session, USERS, addMember, createPage, createWorkspace, loginAs } from './helpers';

// Who may open which live-editing document. A token is for a workspace, but the document's name says
// which page: the server must check that page is in that workspace and that the person can see it,
// as the page's own API routes do.

const COLLAB_URL = API_URL.replace(/^http/, 'ws').replace(/\/api$/, '/collab');

type Opened = 'synced' | 'denied' | 'timeout';

/** Opens a live document with a token for `tokenWorkspaceId` (or a given token); says what happened. */
async function open(session: Session, tokenWorkspaceId: string, documentName: string, token?: string): Promise<Opened> {
  if (!token) {
    const res = await session.post('/collab/token', { workspaceId: tokenWorkspaceId });
    expect(res.status).toBe(201);
    token = res.body.token as string;
  }
  const socket = new HocuspocusProviderWebsocket({ url: COLLAB_URL });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: documentName, document: new Y.Doc(), token });
  provider.attach();
  try {
    return await new Promise<Opened>((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 8000);
      provider.on('synced', () => {
        clearTimeout(timer);
        resolve('synced');
      });
      provider.on('authenticationFailed', () => {
        clearTimeout(timer);
        resolve('denied');
      });
    });
  } finally {
    provider.destroy();
    socket.destroy();
  }
}

/** Opens a live document, lets `write` change it, and waits for the change to reach the server. */
async function edit(session: Session, workspaceId: string, documentName: string, write: (doc: Y.Doc) => void) {
  const token = (await session.post('/collab/token', { workspaceId })).body.token as string;
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: COLLAB_URL });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: documentName, document: doc, token });
  provider.attach();
  await new Promise<void>((resolve) => provider.on('synced', () => resolve()));
  write(doc);
  // Until the server has it (no unsynced changes)
  await new Promise<void>((resolve) => {
    const check = () => (provider.hasUnsyncedChanges ? setTimeout(check, 50) : resolve());
    check();
  });
  return () => {
    provider.destroy();
    socket.destroy();
  };
}

const paragraph = (text: string) => {
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  return p;
};

let alice: Session;
let bob: Session;
let shared: string; // alice owns it, bob is an editor
let alicesOwn: string; // alice only
let bobsOwn: string; // bob only
let publicPage: string;
let privatePage: string; // alice's, in the shared workspace
let otherPage: string; // in alice's own workspace
let database: string; // a database page in alice's own workspace

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  bob = await loginAs(USERS.bob.email);
  shared = await createWorkspace(alice);
  await addMember(alice, shared, USERS.bob.email, 'EDITOR');
  alicesOwn = await createWorkspace(alice);
  bobsOwn = await createWorkspace(bob);
  publicPage = (await createPage(alice, shared, { title: 'Shared notes' })).id;
  privatePage = (await createPage(alice, shared, { title: 'Alice only', visibility: 'PRIVATE' })).id;
  otherPage = (await createPage(alice, alicesOwn, { title: 'Not for Bob' })).id;
  database = (await createPage(alice, alicesOwn, { title: 'Not for Bob either', kind: 'DATABASE' })).id;
});

describe('opening live documents', () => {
  it("opens the pages, databases and workspace documents someone may edit", async () => {
    expect(await open(alice, shared, `ws:${shared}:${publicPage}`)).toBe('synced');
    expect(await open(alice, shared, `ws:${shared}:${privatePage}`)).toBe('synced');
    expect(await open(bob, shared, `ws:${shared}:${publicPage}`)).toBe('synced');
    expect(await open(alice, alicesOwn, `ws:${alicesOwn}:db:${database}`)).toBe('synced');
    expect(await open(bob, shared, `ws:${shared}:events`)).toBe('synced');
    expect(await open(bob, shared, `ws:${shared}:synced-blocks`)).toBe('synced');
  });

  it("refuses another workspace's page or database, named under a workspace of one's own", async () => {
    expect(await open(bob, bobsOwn, `ws:${bobsOwn}:${otherPage}`)).toBe('denied');
    expect(await open(bob, bobsOwn, `ws:${bobsOwn}:db:${database}`)).toBe('denied');
    // Or under the shared workspace, which Bob is in
    expect(await open(bob, shared, `ws:${shared}:${otherPage}`)).toBe('denied');
  });

  it("refuses a page someone else keeps private, to another editor of the workspace", async () => {
    expect(await open(bob, shared, `ws:${shared}:${privatePage}`)).toBe('denied');
  });

  it('refuses a page under the wrong kind of document, and per-user documents', async () => {
    expect(await open(alice, alicesOwn, `ws:${alicesOwn}:db:${otherPage}`)).toBe('denied');
    expect(await open(alice, alicesOwn, `ws:${alicesOwn}:${database}`)).toBe('denied');
    expect(await open(bob, bobsOwn, `user:${USERS.bob.id}:${otherPage}`)).toBe('denied');
    expect(await open(bob, bobsOwn, `ws:${bobsOwn}:not-a-page`)).toBe('denied');
  });

  it('refuses someone removed from the workspace, though their token is still in date', async () => {
    const workspace = await createWorkspace(alice);
    await addMember(alice, workspace, USERS.bob.email, 'EDITOR');
    const page = (await createPage(alice, workspace, { title: 'Soon not yours' })).id;
    const token = (await bob.post('/collab/token', { workspaceId: workspace })).body.token as string;
    expect(await open(bob, workspace, `ws:${workspace}:${page}`, token)).toBe('synced');

    expect((await alice.delete(`/workspaces/${workspace}/members/${USERS.bob.id}`)).status).toBe(200);
    expect(await open(bob, workspace, `ws:${workspace}:${page}`, token)).toBe('denied');
    expect(await open(bob, workspace, `ws:${workspace}:events`, token)).toBe('denied');
  });
});

describe('what live documents can change', () => {
  it("doesn't let a database's live document give a row a page that isn't one made for it", async () => {
    const workspace = await createWorkspace(alice);
    const db = (await createPage(alice, workspace, { title: 'Tasks', kind: 'DATABASE' })).id;
    const row = (await alice.post(`/pages/${db}/database/rows`, { data: {} })).body.id as string;
    const elsewhere = (await createPage(alice, workspace, { title: 'Not a row page', visibility: 'PRIVATE' })).id;
    const { fields } = (await alice.get(`/pages/${db}/database`)).body;

    const close = await edit(alice, workspace, `ws:${workspace}:db:${db}`, (doc) => {
      doc.transact(() => {
        const fieldMap = doc.getMap('fields');
        for (const field of fields) {
          const f = new Y.Map();
          f.set('name', field.name);
          f.set('type', field.type);
          f.set('options', field.options ?? {});
          fieldMap.set(field.id, f);
          doc.getArray('fieldOrder').push([field.id]);
        }
        const rowMap = doc.getMap('rows').get(row) as Y.Map<any>;
        rowMap.set('pageId', elsewhere);
        (rowMap.get('data') as Y.Map<any>).set('__pageId', elsewhere);
      });
    });
    close();
    // Reading the database copies its live document first
    const saved = ((await alice.get(`/pages/${db}/database`)).body.rows as any[]).find((r) => r.id === row);
    expect(saved.pageId).toBeNull();
    expect(saved.data?.__pageId).toBeUndefined();
  });

  it('moves a page with what was typed in it, not the older stored copy', async () => {
    const from = await createWorkspace(alice);
    const to = await createWorkspace(alice);
    const page = (await createPage(alice, from, { title: 'Moving house' })).id;
    const close = await edit(alice, from, `ws:${from}:${page}`, (doc) => {
      doc.getXmlFragment('default').insert(0, [paragraph('Typed just before the move')]);
    });
    expect((await alice.patch(`/pages/${page}/workspace`, { targetWorkspaceId: to })).status).toBe(200);
    close();
    expect((await alice.get(`/pages/${page}/markdown`)).body.markdown).toContain('Typed just before the move');
    // And it opens in the new workspace with it
    expect(await open(alice, to, `ws:${to}:${page}`)).toBe('synced');
  });
});

