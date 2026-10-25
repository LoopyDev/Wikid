import { beforeAll, describe, expect, it } from 'vitest';
import { Session, USERS, addMember, createPage, createWorkspace, loginAs } from './helpers';

let alice: Session;
let bob: Session;
let workspaceId: string; // alice owns it, bob is a viewer

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  bob = await loginAs(USERS.bob.email);
  workspaceId = await createWorkspace(alice);
  await addMember(alice, workspaceId, USERS.bob.email, 'VIEWER');
});

const decodeJwtPayload = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

// A 1×1 transparent PNG.
const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);

describe('wikis', () => {
  it('turns a page into a wiki home with a pages database', async () => {
    const home = await createPage(alice, workspaceId, { title: 'Handbook' });
    const existingChild = await createPage(alice, workspaceId, { parentId: home.id, title: 'Existing' });

    const res = await alice.post(`/pages/${home.id}/wiki`);
    expect(res.status).toBe(201);
    expect(res.body.page).toMatchObject({ id: home.id, wikiHomeId: home.id });
    expect(res.body.page.wikiConfig.databasePageId).toBe(res.body.databasePage.id);
    expect(res.body.databasePage).toMatchObject({ kind: 'DATABASE', parentId: home.id, wikiHomeId: home.id });

    // Pages under the wiki, old and new, belong to it and get a row in its database.
    expect((await alice.get(`/pages/${existingChild.id}`)).body.wikiHomeId).toBe(home.id);
    const newChild = await createPage(alice, workspaceId, { parentId: home.id, title: 'New' });
    expect(newChild.wikiHomeId).toBe(home.id);
    const rows = (await alice.get(`/pages/${res.body.databasePage.id}/database`)).body.rows;
    expect(rows.map((r: any) => r.pageId)).toEqual(expect.arrayContaining([existingChild.id, newChild.id]));

    // Converting again keeps the same database.
    const again = await alice.post(`/pages/${home.id}/wiki`);
    expect(again.body.databasePage.id).toBe(res.body.databasePage.id);
  });

  it('only turns editable document pages into wikis', async () => {
    const db = await createPage(alice, workspaceId, { kind: 'DATABASE' });
    const notDoc = await alice.post(`/pages/${db.id}/wiki`);
    expect(notDoc.status).toBe(400);
    expect(notDoc.body.message).toBe('Only document pages can be wiki homes');
    const page = await createPage(alice, workspaceId);
    expect((await bob.post(`/pages/${page.id}/wiki`)).status).toBe(403);
  });
});

describe('live editing tokens', () => {
  it('issues a token for the workspaces the user can edit', async () => {
    const all = await alice.post('/collab/token', {});
    expect(all.status).toBe(201);
    expect(all.body.workspaceIds).toContain(workspaceId);
    expect(decodeJwtPayload(all.body.token)).toMatchObject({ sub: USERS.alice.id, workspaceIds: all.body.workspaceIds });

    const one = await alice.post('/collab/token', { workspaceId });
    expect(one.body.workspaceIds).toEqual([workspaceId]);
  });

  it("refuses a token for a workspace the user can't edit", async () => {
    const res = await bob.post('/collab/token', { workspaceId });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('User does not have edit access to requested workspace');
  });
});

describe('HTML export', () => {
  it('exports a page tree and a whole workspace', async () => {
    const ws = await createWorkspace(alice);
    const root = await createPage(alice, ws, { title: 'Export root' });
    await createPage(alice, ws, { parentId: root.id, title: 'Export child' });

    const tree = await alice.download('/export/html', { method: 'POST', body: { rootPageId: root.id } });
    expect(tree.status).toBe(201);
    expect(tree.contentType).toContain('text/html');
    const treeHtml = Buffer.from(tree.bytes).toString('utf8');
    expect(treeHtml).toContain('Export root');
    expect(treeHtml).toContain('Export child');

    const whole = await alice.download('/export/html', { method: 'POST', body: { workspaceId: ws, mode: 'pages' } });
    expect(whole.status).toBe(201);
    expect(Buffer.from(whole.bytes).toString('utf8')).toContain('Export child');
  });

  // Known bug: the export doesn't check access, so anyone logged in can export any
  // workspace or page tree by its id.
  it.fails("refuses to export a workspace the user isn't a member of", async () => {
    const ws = await createWorkspace(alice);
    await createPage(alice, ws, { title: 'Not for Bob' });
    const res = await bob.download('/export/html', { method: 'POST', body: { workspaceId: ws } });
    expect(res.status).toBe(403);
  });
});

describe('uploads', () => {
  it('uploads an image to a page and serves it to members', async () => {
    const page = await createPage(alice, workspaceId);
    const res = await alice.upload('/uploads', { pageId: page.id }, { field: 'image', name: 'dot.png', type: 'image/png', data: PNG });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(1);
    expect(res.body.file.key).toMatch(new RegExp(`^${page.id}/`));

    const own = await alice.download(`/uploads/${res.body.file.key}`);
    expect(own.status).toBe(200);
    expect(own.contentType).toBe('image/png');
    expect(Buffer.from(own.bytes).equals(Buffer.from(PNG))).toBe(true);
    // Viewers can see it too.
    expect((await bob.download(`/uploads/${res.body.file.key}`)).status).toBe(200);
  });

  it('checks the file type, the page and access', async () => {
    const page = await createPage(alice, workspaceId);
    const text = await alice.upload('/uploads', { pageId: page.id }, { field: 'image', name: 'a.txt', type: 'text/plain', data: new Uint8Array([104, 105]) });
    expect(text.status).toBe(400);
    expect(text.body.message).toBe('Unsupported file type');
    expect((await alice.upload('/uploads', {}, { field: 'image', name: 'dot.png', type: 'image/png', data: PNG })).status).toBe(400);
    // Viewers can't upload.
    expect((await bob.upload('/uploads', { pageId: page.id }, { field: 'image', name: 'dot.png', type: 'image/png', data: PNG })).status).toBe(403);

    // Outsiders can't read uploads.
    const ws = await createWorkspace(alice);
    const privatePage = await createPage(alice, ws);
    const up = await alice.upload('/uploads', { pageId: privatePage.id }, { field: 'image', name: 'dot.png', type: 'image/png', data: PNG });
    expect((await bob.download(`/uploads/${up.body.file.key}`)).status).toBe(403);
    expect((await alice.download(`/uploads/${privatePage.id}/missing.png`)).status).toBe(404);
  });
});

describe('admin reset', () => {
  it('requires the admin and the exact confirmation text', async () => {
    // Only the guard rails are tested: a real reset would wipe the stack.
    expect((await alice.post('/workspaces/admin/reset?adminId=x', { confirm: 'x' })).status).toBe(403);
    const admin = await loginAs(USERS.admin.email);
    expect((await admin.post('/workspaces/admin/reset?adminId=x', {})).status).toBe(400);
    const wrong = await admin.post('/workspaces/admin/reset?adminId=x', { confirm: 'please' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/^confirm must match/);
  });
});
