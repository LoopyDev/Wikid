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

  it("refuses to export a workspace or page the user can't open", async () => {
    const ws = await createWorkspace(alice);
    const page = await createPage(alice, ws, { title: 'Not for Bob' });
    expect((await bob.download('/export/html', { method: 'POST', body: { workspaceId: ws } })).status).toBe(403);
    expect((await bob.download('/export/html', { method: 'POST', body: { rootPageId: page.id } })).status).toBe(403);
    expect((await alice.download('/export/html', { method: 'POST', body: {} })).status).toBe(400);
  });

  it("leaves out pages the user can't open", async () => {
    // bob is a viewer of workspaceId: he sees public pages only.
    const visible = await createPage(alice, workspaceId, { title: 'Visible to members' });
    const secret = await createPage(alice, workspaceId, { title: 'Alice only', visibility: 'PRIVATE' });
    await createPage(alice, workspaceId, { parentId: secret.id, title: 'Alice only child' });

    const asBob = Buffer.from((await bob.download('/export/html', { method: 'POST', body: { workspaceId } })).bytes).toString('utf8');
    expect(asBob).toContain('Visible to members');
    expect(asBob).not.toContain('Alice only');
    expect((await bob.download('/export/html', { method: 'POST', body: { rootPageId: secret.id } })).status).toBe(403);

    const asAlice = Buffer.from((await alice.download('/export/html', { method: 'POST', body: { workspaceId } })).bytes).toString('utf8');
    expect(asAlice).toContain('Alice only child');
    expect(asAlice).toContain(visible.title);
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
    // Upload names are unique and never reused, so browsers keep them, but only privately
    expect(own.cacheControl).toBe('private, max-age=31536000, immutable');
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
    const missing = await alice.download(`/uploads/${privatePage.id}/missing.png`);
    expect(missing.status).toBe(404);
    expect(missing.cacheControl).not.toContain('immutable');
  });
});

// An image shown on a page other than the one it was uploaded to: the page was duplicated, or the
// image pasted from another page. It's served to whoever can read the page it's shown on, once that
// page really has it, whatever has become of the page it was uploaded to.
describe('an image shown on another page than its own', () => {
  const imageDoc = (key: string) => ({ type: 'doc', content: [{ type: 'image', attrs: { src: `/api/uploads/${key}` } }] });
  const uploadTo = async (pageId: string) =>
    (await alice.upload('/uploads', { pageId }, { field: 'image', name: 'dot.png', type: 'image/png', data: PNG })).body.file.key as string;

  it("a duplicated page's images still load after the original is binned, and after the bin is emptied", async () => {
    const original = await createPage(alice, workspaceId);
    const key = await uploadTo(original.id);
    expect((await alice.put(`/pages/${original.id}/content`, { content: imageDoc(key) })).status).toBe(200);
    const copy = (await alice.post(`/pages/${original.id}/duplicate`, {})).body;

    expect((await alice.delete(`/pages/${original.id}`)).status).toBe(200);
    // (By itself, the image's own page is in the bin)
    expect((await alice.download(`/uploads/${key}`)).status).toBe(404);
    const viaCopy = await alice.download(`/uploads/${key}?page=${copy.id}`);
    expect(viaCopy.status).toBe(200);
    expect(Buffer.from(viaCopy.bytes).equals(Buffer.from(PNG))).toBe(true);
    expect((await bob.download(`/uploads/${key}?page=${copy.id}`)).status).toBe(200);

    expect((await alice.request('DELETE', '/pages', { ids: [original.id] })).status).toBe(200);
    expect((await alice.download(`/uploads/${key}?page=${copy.id}`)).status).toBe(200);
  });

  it('an image from a private page, pasted into a shared one, is seen there', async () => {
    const mine = await createPage(alice, workspaceId, { visibility: 'PRIVATE' });
    const key = await uploadTo(mine.id);
    const shared = await createPage(alice, workspaceId);
    expect((await alice.put(`/pages/${shared.id}/content`, { content: imageDoc(key) })).status).toBe(200);
    expect((await bob.download(`/uploads/${key}`)).status).toBe(403);
    expect((await bob.download(`/uploads/${key}?page=${shared.id}`)).status).toBe(200);
  });

  it("not through a page that doesn't have it, or one the person can't read", async () => {
    const mine = await createPage(alice, workspaceId, { visibility: 'PRIVATE' });
    const key = await uploadTo(mine.id);
    // A page without the image: no way in
    const other = await createPage(alice, workspaceId);
    expect((await bob.download(`/uploads/${key}?page=${other.id}`)).status).toBe(403);
    // A page with it that bob can't open: no way in either
    const alsoPrivate = await createPage(alice, workspaceId, { visibility: 'PRIVATE' });
    expect((await alice.put(`/pages/${alsoPrivate.id}/content`, { content: imageDoc(key) })).status).toBe(200);
    expect((await bob.download(`/uploads/${key}?page=${alsoPrivate.id}`)).status).toBe(403);
    // Nor a page in the bin
    const binned = await createPage(alice, workspaceId);
    expect((await alice.put(`/pages/${binned.id}/content`, { content: imageDoc(key) })).status).toBe(200);
    expect((await alice.delete(`/pages/${binned.id}`)).status).toBe(200);
    expect((await bob.download(`/uploads/${key}?page=${binned.id}`)).status).toBe(403);
    // Nor nonsense
    expect((await bob.download(`/uploads/${key}?page=not-a-page`)).status).toBe(403);
  });

  it("an upload's address put into a page in another workspace doesn't open it there, or export it", async () => {
    const mine = await createPage(alice, workspaceId, { visibility: 'PRIVATE' });
    const key = await uploadTo(mine.id);
    // bob's own workspace, where he can write anything
    const bobsWorkspace = await createWorkspace(bob);
    const bobsPage = await createPage(bob, bobsWorkspace);
    expect((await bob.put(`/pages/${bobsPage.id}/content`, { content: imageDoc(key) })).status).toBe(200);
    expect((await bob.download(`/uploads/${key}?page=${bobsPage.id}`)).status).toBe(403);
    const exported = await bob.download('/export/html', { method: 'POST', body: { rootPageId: bobsPage.id } });
    expect(exported.status).toBe(201);
    expect(Buffer.from(exported.bytes).toString('utf8')).not.toContain('data:image/png;base64');
  });
});

describe('fetching addresses people give us', () => {
  // Link previews and "image from URL" run on the server, which can reach Wikid's own services.
  const internal = [
    'http://127.0.0.1:3000/',
    'http://localhost:3000/auth/me',
    'http://api:3000/',
    'http://minio:9000/',
    'http://collab:1234/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://0x7f000001/',
  ];

  it("won't preview a link to an internal address", async () => {
    for (const url of internal) {
      const res = await alice.post('/embeds/link', { url });
      expect(res.status, url).toBe(400);
      expect(res.body.message, url).toMatch(/can't be fetched|Couldn't fetch/);
    }
    expect((await alice.post('/embeds/link', { url: 'file:///etc/passwd' })).status).toBe(400);
  });

  it("won't add an image from an internal address", async () => {
    const page = await createPage(alice, workspaceId);
    for (const url of internal) {
      const res = await alice.post('/uploads/by-url', { url, pageId: page.id });
      expect(res.status, url).toBe(400);
      expect(res.body.message, url).toMatch(/can't be fetched|Couldn't fetch/);
    }
  });

  it('only exports a real page id as PDF', async () => {
    expect((await alice.get('/pages/not-a-page-id/export/pdf')).status).toBe(400);
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
