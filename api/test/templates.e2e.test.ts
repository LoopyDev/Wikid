import { beforeAll, describe, expect, it } from 'vitest';
import { Session, USERS, addMember, createPage, createWorkspace, loginAs, unique } from './helpers';

// Page templates through the API. What a template may hold is unit tested in templates.test.ts.

let alice: Session;
let bob: Session;
let workspaceId: string; // alice owns it, bob is a viewer

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  bob = await loginAs(USERS.bob.email);
  workspaceId = await createWorkspace(alice);
  await addMember(alice, workspaceId, USERS.bob.email, 'VIEWER');
});

const templates = async (session: Session, ws = workspaceId) => (await session.get(`/templates?workspaceId=${ws}`)).body;
const markdownOf = async (session: Session, id: string) => (await session.get(`/pages/${id}/markdown`)).body.markdown as string;
const listed = async (session: Session, ws = workspaceId) => ((await session.get(`/pages?workspaceId=${ws}`)).body as any[]).map((p) => p.id);

describe('page templates', () => {
  it('offers the built-in ones, and makes a page from one', async () => {
    const { builtIn, workspace } = await templates(alice);
    expect(builtIn.map((t: any) => t.title)).toEqual(['Meeting notes', 'Project brief', 'How-to guide', 'Decision record']);
    expect(workspace).toEqual([]);

    const made = await alice.post(`/templates/builtin:meeting-notes/use`, { workspaceId });
    expect(made.status).toBe(201);
    const page = (await alice.get(`/pages/${made.body.id}`)).body;
    expect(page).toMatchObject({ title: 'Meeting notes', icon: '🗓️', isTemplate: false });
    expect(await markdownOf(alice, made.body.id)).toContain('## Actions\n\n- [ ] Who does what, by when');
    expect(await listed(alice)).toContain(made.body.id);
  });

  it('saves a page as a workspace template, with its subpage, images as placeholders, and nothing of one workspace', async () => {
    const title = unique('Site visit');
    const source = await createPage(alice, workspaceId, { title });
    const content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Notes from the visit.' }] },
        { type: 'image', attrs: { src: '/api/uploads/x/a.png', alt: 'The north wall' } },
        { type: 'databaseView', attrs: { pageId: source.id, title: 'Snags' } },
      ],
    };
    await alice.put(`/pages/${source.id}/content`, { content });
    await alice.post('/pages', { workspaceId, title: 'Follow-up', parentId: source.id });

    const saved = await alice.post('/templates', { scope: 'workspace', workspaceId, fromPageId: source.id });
    expect(saved.status).toBe(201);
    expect(saved.body.notes).toEqual([
      '1 image became an image placeholder, saying what it showed',
      'Left out, as they belong to one workspace: 1 database view',
    ]);
    expect(await markdownOf(alice, saved.body.id)).toBe('Notes from the visit.\n\n[Image to add: The north wall]');

    // A template, not a page: listed as one, not in the page tree or search
    const { workspace } = await templates(alice);
    expect(workspace).toEqual([expect.objectContaining({ id: saved.body.id, title, scope: 'workspace', subpageCount: 1 })]);
    expect(await listed(alice)).not.toContain(saved.body.id);
    const found = (await alice.get(`/search?q=${encodeURIComponent('visit')}`)).body.results.map((r: any) => r.pageId);
    expect(found).not.toContain(saved.body.id);

    // Used under a page: the page and its subpage
    const parent = await createPage(alice, workspaceId, { title: 'Visits' });
    const made = await alice.post(`/templates/${saved.body.id}/use`, { workspaceId, parentId: parent.id });
    const pages = (await alice.get(`/pages?workspaceId=${workspaceId}`)).body as any[];
    const root = pages.find((p) => p.id === made.body.id);
    expect(root).toMatchObject({ parentId: parent.id, title, isTemplate: false });
    expect(pages.filter((p) => p.parentId === made.body.id).map((p) => p.title)).toEqual(['Follow-up']);
  });

  it("keeps someone's own templates with them, offered in every workspace", async () => {
    const created = await alice.post('/templates', { scope: 'personal', workspaceId, title: unique('My checklist'), fromTemplateId: 'builtin:how-to-guide' });
    expect(created.status).toBe(201);
    const other = await createWorkspace(alice);
    const { personal } = await templates(alice, other);
    expect(personal.map((t: any) => t.id)).toContain(created.body.id);
    // Used in the other workspace
    const made = await alice.post(`/templates/${created.body.id}/use`, { workspaceId: other });
    expect(made.body.workspaceId).toBe(other);
    expect(await markdownOf(alice, made.body.id)).toContain('## Steps');
    // Not someone else's
    expect((await templates(bob)).personal.map((t: any) => t.id)).not.toContain(created.body.id);
  });

  it('makes a new page that has no type yet from a template, where it is, and a private page at the top', async () => {
    const parent = await createPage(alice, workspaceId, { title: 'Meetings' });
    const fresh = (await alice.post('/pages', { workspaceId, parentId: parent.id, title: 'Untitled page', setupStatus: 'PENDING' })).body;
    const made = await alice.post('/templates/builtin:meeting-notes/use', { pageId: fresh.id });
    expect(made.body.id).toBe(fresh.id);
    expect((await alice.get(`/pages/${fresh.id}`)).body).toMatchObject({ title: 'Meeting notes', icon: '🗓️', setupStatus: 'COMPLETE', kind: 'DOC', parentId: parent.id });
    expect(await markdownOf(alice, fresh.id)).toContain('## Actions');
    // Only once: it's a page with content now
    expect((await alice.post('/templates/builtin:meeting-notes/use', { pageId: fresh.id })).status).toBe(409);

    const mine = await alice.post('/templates/builtin:how-to-guide/use', { workspaceId, visibility: 'PRIVATE' });
    expect((await alice.get(`/pages/${mine.body.id}`)).body).toMatchObject({ visibility: 'PRIVATE', parentId: null });
  });

  it("lists a workspace's templates with its pages when asked, and a subpage of a template is part of it", async () => {
    const template = (await alice.post('/templates', { scope: 'workspace', workspaceId, title: unique('Runbook') })).body;
    const sub = (await alice.post('/pages', { workspaceId, parentId: template.id, title: 'Rollback' })).body;
    expect(sub.isTemplate).toBe(true);
    expect(await listed(alice)).not.toContain(sub.id);
    const all = ((await alice.get(`/pages?workspaceId=${workspaceId}&includeTemplates=true`)).body as any[]).map((p) => p.id);
    expect(all).toEqual(expect.arrayContaining([template.id, sub.id]));
    expect((await templates(alice)).personalWorkspaceId).toEqual(expect.any(String));
  });

  it('lets a viewer see the templates but not make pages or templates with them', async () => {
    expect((await templates(bob)).builtIn.length).toBeGreaterThan(0);
    expect((await bob.post('/templates/builtin:project-brief/use', { workspaceId })).status).toBe(403);
    expect((await bob.post('/templates', { scope: 'workspace', workspaceId, title: 'Mine' })).status).toBe(403);
  });

  it("lets the workspace's owner hide a built-in template there, for everyone, and show it again", async () => {
    expect((await templates(alice)).canManage).toBe(true);
    expect((await templates(bob)).canManage).toBe(false);
    expect((await bob.post('/templates/builtin:decision-record/hide', { workspaceId })).status).toBe(403);

    expect((await alice.post('/templates/builtin:decision-record/hide', { workspaceId })).status).toBe(201);
    for (const session of [alice, bob]) {
      const { builtIn, hiddenBuiltIn } = await templates(session);
      expect(builtIn.map((t: any) => t.id)).not.toContain('builtin:decision-record');
      expect(hiddenBuiltIn.map((t: any) => t.id)).toEqual(['builtin:decision-record']);
    }
    // Still there in other workspaces
    expect((await templates(alice, await createWorkspace(alice))).builtIn).toHaveLength(4);
    // Anyone can still copy a hidden one to their own
    expect((await bob.post('/templates', { scope: 'personal', workspaceId, fromTemplateId: 'builtin:decision-record' })).status).toBe(201);
    // Only built-in ones
    const own = (await alice.post('/templates', { scope: 'workspace', workspaceId, title: unique('Ours') })).body;
    expect((await alice.post(`/templates/${own.id}/hide`, { workspaceId })).status).toBe(404);

    expect((await alice.post('/templates/builtin:decision-record/show', { workspaceId })).status).toBe(201);
    expect((await templates(bob)).builtIn).toHaveLength(4);
  });

  it('copies full width, a page\'s own setting, to the template and to pages made from it', async () => {
    const source = await createPage(alice, workspaceId, { title: unique('Wide board') });
    expect((await alice.patch(`/pages/${source.id}`, { fullWidth: true })).body.fullWidth).toBe(true);
    const template = (await alice.post('/templates', { scope: 'workspace', workspaceId, fromPageId: source.id })).body;
    expect((await alice.get(`/pages/${template.id}`)).body.fullWidth).toBe(true);
    const made = (await alice.post(`/templates/${template.id}/use`, { workspaceId })).body;
    expect((await alice.get(`/pages/${made.id}`)).body.fullWidth).toBe(true);
    const fresh = (await alice.post('/pages', { workspaceId, title: 'Untitled page', setupStatus: 'PENDING' })).body;
    await alice.post(`/templates/${template.id}/use`, { pageId: fresh.id });
    expect((await alice.get(`/pages/${fresh.id}`)).body.fullWidth).toBe(true);
    // A viewer can't change it
    expect((await bob.patch(`/pages/${source.id}`, { fullWidth: false })).status).toBe(403);
  });

  it("can't be made through the page endpoint, and a deleted one goes to the Bin", async () => {
    const page = (await alice.post('/pages', { workspaceId, title: 'Sneaky', isTemplate: true })).body;
    expect((await alice.get(`/pages/${page.id}`)).body.isTemplate).toBe(false);

    const template = (await alice.post('/templates', { scope: 'workspace', workspaceId, title: unique('Old') })).body;
    expect((await alice.delete(`/pages/${template.id}`)).status).toBe(200);
    expect((await templates(alice)).workspace.map((t: any) => t.id)).not.toContain(template.id);
    const bin = ((await alice.get(`/pages?workspaceId=${workspaceId}&state=bin`)).body as any[]).map((p) => p.id);
    expect(bin).toContain(template.id);
  });
});
