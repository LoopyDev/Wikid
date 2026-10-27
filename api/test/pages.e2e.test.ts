import { beforeAll, describe, expect, it } from 'vitest';
import {
  Session,
  USERS,
  addMember,
  createPage,
  createWorkspace,
  docWithParagraphs,
  loginAs,
  paragraphTexts,
  unique,
} from './helpers';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let alice: Session;
let bob: Session;
let workspaceId: string; // alice owns it, bob is an editor

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  bob = await loginAs(USERS.bob.email);
  workspaceId = await createWorkspace(alice);
  await addMember(alice, workspaceId, USERS.bob.email, 'EDITOR');
});

const listIds = async (session: Session, query = '') =>
  ((await session.get(`/pages?workspaceId=${workspaceId}${query}`)).body as any[]).map((p) => p.id);

describe('creating and reading pages', () => {
  it('creates a document page with sensible defaults', async () => {
    const res = await alice.post('/pages', { workspaceId, title: 'Hello' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      workspaceId,
      title: 'Hello',
      kind: 'DOC',
      visibility: 'PUBLIC',
      setupStatus: 'COMPLETE',
      parentId: null,
      authorId: USERS.alice.id,
      isDeleted: false,
    });
    expect(res.body.content.type).toBe('doc');

    const page = await alice.get(`/pages/${res.body.id}`);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ id: res.body.id, title: 'Hello', lockedBy: USERS.alice.id });
    expect(await listIds(alice)).toContain(res.body.id);
  });

  it('places new pages after their siblings', async () => {
    const ws = await createWorkspace(alice);
    const first = await createPage(alice, ws);
    const second = await createPage(alice, ws);
    expect(Number(second.position)).toBeGreaterThan(Number(first.position));
  });

  it('creates child pages that inherit the parent visibility', async () => {
    const parent = await createPage(alice, workspaceId, { visibility: 'PRIVATE' });
    const child = await createPage(alice, workspaceId, { parentId: parent.id });
    expect(child).toMatchObject({ parentId: parent.id, visibility: 'PRIVATE' });
    const elsewhere = await createWorkspace(alice);
    const wrongWorkspace = await alice.post('/pages', { workspaceId: elsewhere, parentId: parent.id });
    expect(wrongWorkspace.status).toBe(400);
    expect(wrongWorkspace.body.message).toBe('parent does not exist in workspace');
  });

  it('validates the request and access', async () => {
    expect((await alice.post('/pages', { title: 'No workspace' })).status).toBe(400);
    const outsider = await createWorkspace(bob);
    expect((await alice.post('/pages', { workspaceId: outsider })).status).toBe(403);
    expect((await alice.get(`/pages/${MISSING_ID}`)).status).toBe(404);
    const bobsPage = await createPage(bob, outsider);
    expect((await alice.get(`/pages/${bobsPage.id}`)).status).toBe(403);
  });

  it('lists only the pages of a workspace the user belongs to', async () => {
    const outsider = await createWorkspace(bob);
    expect((await alice.get(`/pages?workspaceId=${outsider}`)).status).toBe(403);
  });
});

describe('editing pages', () => {
  it('renames a page and sets its icon', async () => {
    const page = await createPage(alice, workspaceId);
    const res = await bob.patch(`/pages/${page.id}`, { title: 'Renamed', icon: '📄' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Renamed', icon: '📄' });
    expect((await alice.get(`/pages/${page.id}`)).body.title).toBe('Renamed');
  });

  it('saves and returns page content', async () => {
    const page = await createPage(alice, workspaceId);
    await alice.get(`/pages/${page.id}`);
    const saved = await alice.put(`/pages/${page.id}/content`, { content: docWithParagraphs('One', 'Two') });
    expect(saved.status).toBe(200);
    expect(paragraphTexts((await alice.get(`/pages/${page.id}`)).body.content)).toEqual(['One', 'Two']);
  });

  it('refuses content saves while someone else has the page open', async () => {
    const page = await createPage(alice, workspaceId);
    await alice.get(`/pages/${page.id}`); // alice now holds the edit lock
    const res = await bob.put(`/pages/${page.id}/content`, { content: docWithParagraphs('Bob') });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Page is currently being edited by Alice');
  });

  it('stops viewers from editing', async () => {
    const ws = await createWorkspace(alice);
    await addMember(alice, ws, USERS.bob.email, 'VIEWER');
    const page = await createPage(alice, ws);
    expect((await bob.get(`/pages/${page.id}`)).status).toBe(200);
    expect((await bob.patch(`/pages/${page.id}`, { title: 'x' })).status).toBe(403);
    expect((await bob.put(`/pages/${page.id}/content`, { content: docWithParagraphs('x') })).status).toBe(403);
    expect((await bob.post('/pages', { workspaceId: ws })).status).toBe(403);
    expect((await bob.delete(`/pages/${page.id}`)).status).toBe(403);
  });
});

describe('private pages', () => {
  it('hides private pages from other members', async () => {
    const page = await createPage(alice, workspaceId, { visibility: 'PRIVATE' });
    expect((await alice.get(`/pages/${page.id}`)).status).toBe(200);
    expect((await bob.get(`/pages/${page.id}`)).status).toBe(403);
    expect(await listIds(bob)).not.toContain(page.id);
    expect(await listIds(alice)).toContain(page.id);
  });

  it('changes visibility for the page and its children', async () => {
    const parent = await createPage(alice, workspaceId);
    const child = await createPage(alice, workspaceId, { parentId: parent.id });
    const res = await alice.patch(`/pages/${parent.id}/visibility`, { visibility: 'PRIVATE' });
    expect(res.status).toBe(200);
    expect(res.body.updatedIds.sort()).toEqual([parent.id, child.id].sort());
    expect((await bob.get(`/pages/${child.id}`)).status).toBe(403);
    expect((await alice.patch(`/pages/${parent.id}/visibility`, { visibility: 'SECRET' })).status).toBe(400);
    // Bob can't publish or move alice's private pages.
    expect((await bob.patch(`/pages/${parent.id}/visibility`, { visibility: 'PUBLIC' })).status).toBe(403);
  });

  it('moves a child out of its parent when their visibility no longer matches', async () => {
    const parent = await createPage(alice, workspaceId);
    const child = await createPage(alice, workspaceId, { parentId: parent.id });
    const res = await alice.patch(`/pages/${child.id}/visibility`, { visibility: 'PRIVATE' });
    expect(res.body.page).toMatchObject({ id: child.id, parentId: null, visibility: 'PRIVATE' });
  });
});

describe('bin, restore and permanent delete', () => {
  it('bins a page with its children and restores them', async () => {
    const parent = await createPage(alice, workspaceId);
    const child = await createPage(alice, workspaceId, { parentId: parent.id });

    const binned = await alice.delete(`/pages/${parent.id}`);
    expect(binned.status).toBe(200);
    expect(binned.body).toEqual({ count: 2 });
    const inBin = await alice.get(`/pages/${child.id}`);
    expect(inBin.status).toBe(404);
    expect(inBin.body.message).toBe('Page is in the bin');
    expect(await listIds(alice)).not.toContain(parent.id);
    expect(await listIds(alice, '&state=bin')).toEqual(expect.arrayContaining([parent.id, child.id]));
    expect(await listIds(alice, '&includeDeleted=true')).toEqual(expect.arrayContaining([parent.id, child.id]));

    const restored = await alice.patch(`/pages/${parent.id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ count: 2, movedToTopLevel: false });
    expect((await alice.get(`/pages/${child.id}`)).status).toBe(200);
  });

  it('asks where to put a page whose parent is still in the bin, and can put it at the top level', async () => {
    const parent = await createPage(alice, workspaceId, { title: unique('Parent') });
    const child = await createPage(alice, workspaceId, { title: unique('Child'), parentId: parent.id });
    await alice.delete(`/pages/${parent.id}`);

    // Under a parent that's still in the bin it wouldn't show anywhere, so the API won't do that.
    const asked = await alice.patch(`/pages/${child.id}/restore`);
    expect(asked.status).toBe(409);
    expect(asked.body).toMatchObject({ code: 'PARENT_IN_BIN', parents: [{ id: parent.id, title: parent.title }] });
    expect((await alice.get(`/pages/${child.id}`)).status).toBe(404);

    const toTop = await alice.patch(`/pages/${child.id}/restore`, { placement: 'topLevel' });
    expect(toTop.status).toBe(200);
    expect(toTop.body).toMatchObject({ count: 1, movedToTopLevel: true });
    expect((await alice.get(`/pages/${child.id}`)).body).toMatchObject({ parentId: null });
    expect((await alice.get(`/pages/${parent.id}`)).status).toBe(404);
    expect(await listIds(alice)).toContain(child.id);
  });

  it('restores a page together with the binned pages above it, but not their other sub-pages', async () => {
    const top = await createPage(alice, workspaceId, { title: unique('Top') });
    const middle = await createPage(alice, workspaceId, { title: unique('Middle'), parentId: top.id });
    const page = await createPage(alice, workspaceId, { title: unique('Page'), parentId: middle.id });
    const sibling = await createPage(alice, workspaceId, { title: unique('Sibling'), parentId: middle.id });
    await alice.delete(`/pages/${top.id}`);

    const asked = await alice.patch(`/pages/${page.id}/restore`);
    expect(asked.body.parents.map((p: any) => p.id)).toEqual([middle.id, top.id]);

    const withParents = await alice.patch(`/pages/${page.id}/restore`, { placement: 'withParents' });
    expect(withParents.status).toBe(200);
    expect(withParents.body).toMatchObject({ count: 3, movedToTopLevel: false });
    expect((await alice.get(`/pages/${page.id}`)).body).toMatchObject({ parentId: middle.id });
    expect((await alice.get(`/pages/${middle.id}`)).status).toBe(200);
    expect((await alice.get(`/pages/${top.id}`)).status).toBe(200);
    expect((await alice.get(`/pages/${sibling.id}`)).status).toBe(404);
  });

  it('deletes pages permanently', async () => {
    const page = await createPage(alice, workspaceId);
    await alice.delete(`/pages/${page.id}`);
    const destroyed = await alice.delete('/pages', { ids: [page.id] });
    expect(destroyed.status).toBe(200);
    expect(destroyed.body).toEqual({ count: 1 });
    expect((await alice.get(`/pages/${page.id}`)).status).toBe(404);
    expect(await listIds(alice, '&includeDeleted=true')).not.toContain(page.id);
    expect((await alice.delete('/pages', { ids: [] })).body).toEqual({ count: 0 });
  });

  it('deletes a database page permanently', async () => {
    const db = await createPage(alice, workspaceId, { kind: 'DATABASE' });
    await alice.post(`/pages/${db.id}/database/rows`, { data: {} });
    await alice.delete(`/pages/${db.id}`);
    expect((await alice.delete('/pages', { ids: [db.id] })).status).toBe(200);
    expect((await alice.get(`/pages/${db.id}/database`)).status).toBe(404);
  });

  it('deletes a database page with views and forms permanently', async () => {
    const db = await createPage(alice, workspaceId, { kind: 'DATABASE' });
    expect((await alice.post(`/pages/${db.id}/database/views`, { name: 'Board', type: 'BOARD' })).status).toBe(201);
    expect((await alice.post(`/pages/${db.id}/database/forms`, { name: 'Form' })).status).toBe(201);
    await alice.delete(`/pages/${db.id}`);
    expect((await alice.delete('/pages', { ids: [db.id] })).status).toBe(200);
    expect((await alice.get(`/pages/${db.id}`)).status).toBe(404);
  });

  it('deletes a row page permanently and unlinks its row', async () => {
    const db = await createPage(alice, workspaceId, { kind: 'DATABASE' });
    const titleField = (await alice.get(`/pages/${db.id}/database`)).body.fields[0].id;
    const row = (await alice.post(`/pages/${db.id}/database/rows`, { data: { [titleField]: 'Has a page' } })).body;
    await alice.delete(`/pages/${row.pageId}`);
    expect((await alice.delete('/pages', { ids: [row.pageId] })).status).toBe(200);
    const after = (await alice.get(`/pages/${db.id}/database`)).body.rows.find((r: any) => r.id === row.id);
    expect(after.pageId).toBeNull();
  });

  it("doesn't let others bin private pages they don't own", async () => {
    const parent = await createPage(bob, workspaceId);
    await createPage(alice, workspaceId, { parentId: parent.id });
    const privateChild = await createPage(bob, workspaceId, { parentId: parent.id });
    await bob.patch(`/pages/${privateChild.id}/visibility`, { visibility: 'PRIVATE' });
    // The private child moved out of the public parent, so make a private tree instead.
    const privateParent = await createPage(bob, workspaceId, { visibility: 'PRIVATE' });
    expect((await alice.delete(`/pages/${privateParent.id}`)).status).toBe(403);
  });
});

describe('moving and reordering pages', () => {
  it('reorders siblings', async () => {
    const ws = await createWorkspace(alice);
    const [a, b, c] = [await createPage(alice, ws), await createPage(alice, ws), await createPage(alice, ws)];
    const res = await alice.patch('/pages/reorder', { parentId: null, orderedIds: [c.id, a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    const order = ((await alice.get(`/pages?workspaceId=${ws}`)).body as any[]).map((p) => p.id);
    expect(order).toEqual([c.id, a.id, b.id]);
  });

  it('moves a page under a new parent by reordering', async () => {
    const ws = await createWorkspace(alice);
    const parent = await createPage(alice, ws);
    const page = await createPage(alice, ws);
    expect((await alice.patch('/pages/reorder', { parentId: parent.id, orderedIds: [page.id] })).status).toBe(200);
    expect((await alice.get(`/pages/${page.id}`)).body.parentId).toBe(parent.id);
  });

  it('validates reorder requests', async () => {
    const page = await createPage(alice, workspaceId);
    expect((await alice.patch('/pages/reorder', { parentId: null, orderedIds: [] })).status).toBe(400);
    expect((await alice.patch('/pages/reorder', { parentId: null, orderedIds: [page.id, page.id] })).status).toBe(400);
    expect((await alice.patch('/pages/reorder', { parentId: MISSING_ID, orderedIds: [page.id] })).status).toBe(400);
    expect((await alice.patch('/pages/reorder', { parentId: null, orderedIds: [page.id, MISSING_ID] })).status).toBe(400);
  });

  it('moves a page and its children to another workspace', async () => {
    const target = await createWorkspace(alice);
    const parent = await createPage(alice, workspaceId);
    const child = await createPage(alice, workspaceId, { parentId: parent.id });
    const res = await alice.patch(`/pages/${parent.id}/workspace`, { targetWorkspaceId: target });
    expect(res.status).toBe(200);
    expect(res.body.page).toMatchObject({ id: parent.id, workspaceId: target, parentId: null });
    expect(res.body.movedIds.sort()).toEqual([parent.id, child.id].sort());
    expect((await alice.get(`/pages/${child.id}`)).body.workspaceId).toBe(target);

    expect((await alice.patch(`/pages/${parent.id}/workspace`, { targetWorkspaceId: target })).status).toBe(400);
    expect((await alice.patch(`/pages/${parent.id}/workspace`, { targetWorkspaceId: 'nope' })).status).toBe(400);
    const outsider = await createWorkspace(bob);
    expect((await alice.patch(`/pages/${parent.id}/workspace`, { targetWorkspaceId: outsider })).status).toBe(403);
  });
});

describe('page setup', () => {
  it('turns a pending page into a database and completes setup', async () => {
    const page = await createPage(alice, workspaceId, { setupStatus: 'PENDING' });
    expect(page).toMatchObject({ kind: 'DOC', setupStatus: 'PENDING' });
    const res = await alice.patch(`/pages/${page.id}/setup`, { kind: 'DATABASE', setupStatus: 'COMPLETE' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'DATABASE', setupStatus: 'COMPLETE', databaseComplianceMode: false });
    expect((await alice.get(`/pages/${page.id}/database`)).status).toBe(200);
  });

  it('turns a pending database with views and forms back into a document', async () => {
    const page = await createPage(alice, workspaceId, { setupStatus: 'PENDING' });
    await alice.patch(`/pages/${page.id}/setup`, { kind: 'DATABASE' });
    expect((await alice.post(`/pages/${page.id}/database/views`, { name: 'Board', type: 'BOARD' })).status).toBe(201);
    expect((await alice.post(`/pages/${page.id}/database/forms`, { name: 'Form' })).status).toBe(201);
    const res = await alice.patch(`/pages/${page.id}/setup`, { kind: 'DOC' });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('DOC');
    expect((await alice.get(`/pages/${page.id}/database`)).status).toBe(400);
  });

  it('refuses to change the type after setup', async () => {
    const page = await createPage(alice, workspaceId);
    expect((await alice.patch(`/pages/${page.id}/setup`, {})).status).toBe(400);
    const res = await alice.patch(`/pages/${page.id}/setup`, { kind: 'DATABASE' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Setup already completed');
  });
});

describe('blocks', () => {
  it('creates, lists and updates blocks', async () => {
    const page = await createPage(alice, workspaceId);
    const first = await alice.post(`/pages/${page.id}/blocks`, { content: 'First' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ pageId: page.id, type: 'TEXT', content: 'First' });
    const second = await alice.post(`/pages/${page.id}/blocks`, { content: 'Second' });
    expect(Number(second.body.position)).toBeGreaterThan(Number(first.body.position));

    const updated = await alice.patch(`/blocks/${first.body.id}`, { content: 'Changed' });
    expect(updated.status).toBe(200);
    expect(updated.body.content).toBe('Changed');

    const list = await alice.get(`/pages/${page.id}/blocks`);
    expect(list.body.map((b: any) => b.content)).toEqual(['Changed', 'Second']);
    expect((await alice.patch(`/blocks/${MISSING_ID}`, { content: 'x' })).status).toBe(404);
  });
});
