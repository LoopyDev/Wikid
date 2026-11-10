import { beforeAll, describe, expect, it } from 'vitest';
import { Session, USERS, addMember, createPage, createWorkspace, loginAs, unique } from './helpers';

// Who may do what to someone else's pages, and what uploads and exports may carry. Alice owns the
// workspace; Bob is an editor in it.

let alice: Session;
let bob: Session;
let workspaceId: string;
let bobsOwn: string;

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  bob = await loginAs(USERS.bob.email);
  workspaceId = await createWorkspace(alice);
  await addMember(alice, workspaceId, USERS.bob.email, 'EDITOR');
  bobsOwn = await createWorkspace(bob);
});

const uploadUrl = (url: string) => url.replace(/^.*?\/uploads\//, '/uploads/');

describe('uploads', () => {
  it("serves an uploaded SVG so that a script in it can't run on the wiki's address", async () => {
    const page = await createPage(alice, workspaceId);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const up = await bob.upload('/uploads', { pageId: page.id }, { field: 'image', name: 'x.svg', type: 'image/svg+xml', data: svg });
    expect(up.status).toBe(201);
    const served = await alice.download(uploadUrl(up.body.file.url));
    expect(served.status).toBe(200);
    expect(served.headers.get('content-security-policy') || '').toContain('sandbox');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it("serves a 3D scan as a plain download, whatever type it was sent as", async () => {
    const page = await createPage(alice, workspaceId);
    const html = new TextEncoder().encode('<script>alert(1)</script>');
    const up = await bob.upload('/uploads', { pageId: page.id }, { field: 'image', name: 'scan.spz', type: 'text/html', data: html });
    expect(up.status).toBe(201);
    const served = await alice.download(uploadUrl(up.body.file.url));
    expect(served.contentType).toBe('application/octet-stream');
    expect(served.headers.get('content-security-policy') || '').toContain('sandbox');
  });

  it('takes the image types pages show, under their usual names, and refuses others', async () => {
    const page = await createPage(alice, workspaceId);
    const jpg = await bob.upload('/uploads', { pageId: page.id }, { field: 'image', name: 'a.jpg', type: 'image/jpg', data: new Uint8Array([0xff, 0xd8, 0xff]) });
    expect(jpg.status).toBe(201);
    expect((await alice.download(uploadUrl(jpg.body.file.url))).contentType).toBe('image/jpeg');
    const tiff = await bob.upload('/uploads', { pageId: page.id }, { field: 'image', name: 'a.tiff', type: 'image/tiff', data: new Uint8Array([1, 2]) });
    expect(tiff.status).toBe(400);
  });
});

describe("someone else's pages", () => {
  it("doesn't let an editor make someone else's page private, though they can their own", async () => {
    const alices = await createPage(alice, workspaceId, { title: unique('Team notes') });
    expect((await bob.patch(`/pages/${alices.id}/visibility`, { visibility: 'PRIVATE' })).status).toBe(403);
    expect((await alice.get(`/pages/${alices.id}`)).status).toBe(200);
    const bobs = await createPage(bob, workspaceId, { title: unique('Bob draft') });
    expect((await bob.patch(`/pages/${bobs.id}/visibility`, { visibility: 'PRIVATE' })).status).toBe(200);
  });

  it("doesn't let an editor take other people's pages under their own page private or out of the workspace", async () => {
    const bobs = await createPage(bob, workspaceId, { title: unique('Bob parent') });
    const alicesChild = await createPage(alice, workspaceId, { title: unique('Alice child'), parentId: bobs.id });
    expect((await bob.patch(`/pages/${bobs.id}/visibility`, { visibility: 'PRIVATE' })).status).toBe(403);
    expect((await bob.patch(`/pages/${bobs.id}/workspace`, { targetWorkspaceId: bobsOwn })).status).toBe(403);
    const child = (await alice.get(`/pages/${alicesChild.id}`)).body;
    expect(child).toMatchObject({ visibility: 'PUBLIC', workspaceId });
  });

  it("doesn't let an editor move the owner's page out of the workspace, nor anyone move another's private page", async () => {
    const alices = await createPage(alice, workspaceId, { title: unique('Handbook') });
    expect((await bob.patch(`/pages/${alices.id}/workspace`, { targetWorkspaceId: bobsOwn })).status).toBe(403);
    expect((await alice.get(`/pages/${alices.id}`)).body.workspaceId).toBe(workspaceId);

    // Bob's own page moves; with Alice's private page under it, it doesn't
    const bobs = await createPage(bob, workspaceId, { title: unique('Bob page') });
    const secret = await createPage(alice, workspaceId, { title: unique('Alice secret'), visibility: 'PRIVATE' });
    expect((await alice.patch('/pages/reorder', { parentId: bobs.id, orderedIds: [secret.id] })).status).toBe(200);
    expect((await bob.patch(`/pages/${bobs.id}/workspace`, { targetWorkspaceId: bobsOwn })).status).toBe(403);
    expect((await alice.get(`/pages/${secret.id}`)).body.workspaceId).toBe(workspaceId);
    const lone = await createPage(bob, workspaceId, { title: unique('Bob lone page') });
    expect((await bob.patch(`/pages/${lone.id}/workspace`, { targetWorkspaceId: bobsOwn })).status).toBe(200);
  });

  it('only deletes pages for good from the Bin', async () => {
    const page = await createPage(alice, workspaceId, { title: unique('Still in use') });
    // (Deleting for good is the owner's: see pages.e2e.test.ts)
    expect((await alice.delete('/pages', { ids: [page.id] })).status).toBe(400);
    expect((await alice.get(`/pages/${page.id}`)).status).toBe(200);
    expect((await alice.delete(`/pages/${page.id}`)).status).toBe(200);
    expect((await alice.delete('/pages', { ids: [page.id] })).status).toBe(200);
  });

  it("deletes what's still in the Bin when someone else restored one of the pages meanwhile", async () => {
    const gone = await createPage(alice, workspaceId, { title: unique('Gone') });
    const back = await createPage(alice, workspaceId, { title: unique('Back') });
    await alice.delete(`/pages/${gone.id}`);
    await alice.delete(`/pages/${back.id}`);
    expect((await bob.patch(`/pages/${back.id}/restore`, {})).status).toBe(200);
    expect((await alice.delete('/pages', { ids: [gone.id, back.id] })).status).toBe(200);
    expect((await alice.get(`/pages/${gone.id}`)).status).toBe(404);
    expect((await alice.get(`/pages/${back.id}`)).status).toBe(200);
  });

  it("doesn't let a page be put under a private page its mover can't see", async () => {
    const secret = await createPage(alice, workspaceId, { title: unique('Alice only'), visibility: 'PRIVATE' });
    const bobs = await createPage(bob, workspaceId, { title: unique('Bob note') });
    expect((await bob.patch('/pages/reorder', { parentId: secret.id, orderedIds: [bobs.id] })).status).toBe(403);
  });

  it("doesn't list a template someone keeps private to other members", async () => {
    const template = (await alice.post('/templates', { scope: 'workspace', workspaceId, title: unique('Alice private template') })).body;
    expect((await alice.patch(`/pages/${template.id}/visibility`, { visibility: 'PRIVATE' })).status).toBe(200);
    const listed = (await bob.get(`/templates?workspaceId=${workspaceId}`)).body.workspace.map((t: any) => t.id);
    expect(listed).not.toContain(template.id);
    expect((await alice.get(`/templates?workspaceId=${workspaceId}`)).body.workspace.map((t: any) => t.id)).toContain(template.id);
  });
});

describe('members', () => {
  it("doesn't let the invite form change an existing member's role, so an owner can't demote themselves out", async () => {
    const workspace = await createWorkspace(alice);
    expect((await alice.post(`/workspaces/${workspace}/members`, { email: USERS.alice.email, role: 'VIEWER' })).status).toBe(409);
    const members = (await alice.get(`/workspaces/${workspace}/members`)).body as any[];
    expect(members.find((m) => (m.user?.id ?? m.userId) === USERS.alice.id)?.role).toBe('OWNER');
    // Adding someone again as what they already are is fine (a double click, say)
    expect((await alice.post(`/workspaces/${workspace}/members`, { email: USERS.alice.email, role: 'OWNER' })).status).toBe(201);
  });
});

describe('exports', () => {
  it('leaves out links that would run a script', async () => {
    const page = await createPage(alice, workspaceId, { title: unique('Links') });
    const link = (href: string, text: string) => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href, target: '_self' } }] });
    const content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [link('javascript:alert(1)', 'bad'), { type: 'text', text: ' ' }, link('https://example.com', 'good')] },
        { type: 'paragraph', content: [link('data:text/html,<script>alert(1)</script>', 'also bad')] },
        { type: 'paragraph', content: [link(' JaVaScRiPt:alert(1)', 'sneaky'), { type: 'text', text: ' ' }, link('www.example.org', 'no scheme')] },
      ],
    };
    expect((await alice.put(`/pages/${page.id}/content`, { content })).status).toBe(200);
    const exported = await alice.download('/export/html', { method: 'POST', body: { rootPageId: page.id } });
    const html = new TextDecoder().decode(exported.bytes);
    expect(html).toContain('https://example.com');
    expect(html).not.toMatch(/href="\s*javascript:/i);
    expect(html).not.toMatch(/href="\s*data:/i);
    // A link with no scheme is still a link
    expect(html).toContain('href="www.example.org"');
  });
});
