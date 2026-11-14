import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { API_URL, Session, USERS, addMember, createPage, createWorkspace, loginAs } from './helpers';

// A workspace's events document (ws:<id>:events) tells everyone with it open which pages changed.
// A private page's changes go only to its author: the others mustn't learn its id, or who deleted it.

const COLLAB_URL = API_URL.replace(/^http/, 'ws').replace(/\/api$/, '/collab');

type Listener = { messages: any[]; close: () => void };

/** Joins the workspace's events document and keeps every message sent on it. */
async function listen(session: Session, workspaceId: string): Promise<Listener> {
  const token = (await session.post('/collab/token', { workspaceId })).body.token as string;
  const messages: any[] = [];
  const socket = new HocuspocusProviderWebsocket({ url: COLLAB_URL });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `ws:${workspaceId}:events`,
    document: new Y.Doc(),
    token,
    onStateless: ({ payload }) => messages.push(JSON.parse(payload)),
  });
  provider.attach();
  await new Promise<void>((resolve) => provider.on('synced', () => resolve()));
  return {
    messages,
    close: () => {
      provider.destroy();
      socket.destroy();
    },
  };
}

const mentions = (messages: any[], pageId: string) =>
  messages.some((m) => (Array.isArray(m.pageIds) && m.pageIds.includes(pageId)) || m.pageId === pageId || m.deleted?.pageId === pageId);

/** Makes a public page and waits until Bob hears of it: everything sent to him before has arrived. */
async function heardLast() {
  const page = (await createPage(alice, workspace, { title: 'Last' })).id;
  await expect.poll(() => mentions(bobHears.messages, page), { timeout: 5000 }).toBe(true);
}

let alice: Session;
let bob: Session;
let workspace: string;
let aliceHears: Listener;
let bobHears: Listener;

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  bob = await loginAs(USERS.bob.email);
  workspace = await createWorkspace(alice);
  await addMember(alice, workspace, USERS.bob.email, 'EDITOR');
  aliceHears = await listen(alice, workspace);
  bobHears = await listen(bob, workspace);
});

afterAll(() => {
  aliceHears?.close();
  bobHears?.close();
});

describe("a workspace's events", () => {
  it("tell only a private page's author that it changed; a public page's changes, everyone", async () => {
    const privatePage = (await createPage(alice, workspace, { title: 'Alice only', visibility: 'PRIVATE' })).id;
    const publicPage = (await createPage(alice, workspace, { title: 'Shared notes' })).id;
    expect((await alice.patch(`/pages/${privatePage}`, { title: 'Still Alice only' })).status).toBe(200);
    expect((await alice.patch(`/pages/${publicPage}`, { title: 'Still shared' })).status).toBe(200);
    expect((await alice.delete(`/pages/${privatePage}`)).status).toBe(200);

    await expect.poll(() => mentions(bobHears.messages, publicPage), { timeout: 5000 }).toBe(true);
    await expect.poll(() => aliceHears.messages.some((m) => m.deleted?.pageId === privatePage), { timeout: 5000 }).toBe(true);
    // Once Bob has heard of something done after all that, he'd have heard of the private page too
    await heardLast();
    expect(mentions(bobHears.messages, privatePage)).toBe(false);
  });

  it('tell everyone when a page is made private, so it leaves their sidebar', async () => {
    const page = (await createPage(alice, workspace, { title: 'Soon private' })).id;
    expect((await alice.patch(`/pages/${page}/visibility`, { visibility: 'PRIVATE' })).status).toBe(200);
    await expect.poll(() => mentions(bobHears.messages, page), { timeout: 5000 }).toBe(true);
  });

  it("tell only a private database's author that it was saved", async () => {
    const database = (await createPage(alice, workspace, { title: 'Alice’s list', kind: 'DATABASE', visibility: 'PRIVATE' })).id;
    const publicDatabase = (await createPage(alice, workspace, { title: 'Our list', kind: 'DATABASE' })).id;
    // Saved by the collab server, which then says so
    for (const id of [database, publicDatabase]) {
      const token = (await alice.post('/collab/token', { workspaceId: workspace })).body.token as string;
      const doc = new Y.Doc();
      const socket = new HocuspocusProviderWebsocket({ url: COLLAB_URL });
      const provider = new HocuspocusProvider({ websocketProvider: socket, name: `ws:${workspace}:db:${id}`, document: doc, token });
      provider.attach();
      await new Promise<void>((resolve) => provider.on('synced', () => resolve()));
      doc.getMap('rows').set('r', new Y.Map());
      await new Promise<void>((resolve) => {
        const check = () => (provider.hasUnsyncedChanges ? setTimeout(check, 50) : resolve());
        check();
      });
      provider.destroy();
      socket.destroy();
    }

    await expect.poll(() => bobHears.messages.some((m) => m.type === 'database-changed' && m.pageId === publicDatabase), { timeout: 15000 }).toBe(true);
    await expect.poll(() => aliceHears.messages.some((m) => m.type === 'database-changed' && m.pageId === database), { timeout: 15000 }).toBe(true);
    await heardLast();
    expect(mentions(bobHears.messages, database)).toBe(false);
  });
});
