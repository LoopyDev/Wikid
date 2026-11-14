import { beforeAll, describe, expect, it } from 'vitest';
import { Session, USERS, addMember, createPage, createWorkspace, loginAs } from './helpers';
import { appendParagraph, openLiveDocument } from './live';

// A page's content as Markdown, block by block (the MCP server's way in). The conversion itself
// is unit tested in markdown-content.test.ts; writes reaching a page open in the editor are
// tested in the browser (e2e/page-markdown.spec.ts).

let alice: Session;
let bob: Session;
let workspaceId: string; // alice owns it, bob is a viewer

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  bob = await loginAs(USERS.bob.email);
  workspaceId = await createWorkspace(alice);
  await addMember(alice, workspaceId, USERS.bob.email, 'VIEWER');
});

const ids = (body: any) => body.blocks.map((b: any) => b.id);

describe('page content as Markdown', () => {
  it("rewrites a page whole only from the version the writer read, so typing since isn't lost", async () => {
    const page = await createPage(alice, workspaceId);
    const read = (await alice.put(`/pages/${page.id}/markdown`, { markdown: 'First' })).body;
    expect(read.revision).toMatch(/^[0-9a-f]{16,}$/);
    const live = await openLiveDocument(alice, workspaceId, page.id);
    try {
      appendParagraph(live.doc, 'Typed meanwhile');
      await expect.poll(async () => (await alice.get(`/pages/${page.id}/markdown`)).body.markdown).toContain('Typed meanwhile');
      const stale = await alice.put(`/pages/${page.id}/markdown`, { markdown: 'Rewritten', revision: read.revision });
      expect(stale.status).toBe(409);
      expect(stale.body.message).toMatch(/changed since/i);
      const fresh = (await alice.get(`/pages/${page.id}/markdown`)).body;
      expect((await alice.put(`/pages/${page.id}/markdown`, { markdown: 'Rewritten', revision: fresh.revision })).status).toBe(200);
    } finally {
      live.close();
    }
  });

  it('writes a new page from Markdown, and reads it back block by block', async () => {
    const page = await createPage(alice, workspaceId, { title: 'Notes' });
    const markdown = '# Plans\n\nFirst **step**.\n\n- [ ] Buy milk\n- [x] Call Bob';
    const written = await alice.put(`/pages/${page.id}/markdown`, { markdown });
    expect(written.status).toBe(200);
    expect(written.body.markdown).toBe(markdown);

    const read = await alice.get(`/pages/${page.id}/markdown`);
    expect(read.body).toMatchObject({ id: page.id, title: 'Notes', markdown });
    expect(read.body.blocks.map((b: any) => [b.type, b.markdown])).toEqual([
      ['heading', '# Plans'],
      ['paragraph', 'First **step**.'],
      ['taskList', '- [ ] Buy milk\n- [x] Call Bob'],
    ]);
    // Every block has an id of its own
    expect(new Set(ids(read.body)).size).toBe(3);
  });

  it('inserts, rewrites and deletes blocks, leaving the rest as they were', async () => {
    const page = await createPage(alice, workspaceId);
    const start = (await alice.put(`/pages/${page.id}/markdown`, { markdown: 'One\n\nTwo\n\nThree' })).body;
    const [one, two, three] = ids(start);

    const inserted = await alice.post(`/pages/${page.id}/markdown/blocks`, { markdown: 'One and a half', afterId: one });
    expect(inserted.status).toBe(201);
    expect(inserted.body.markdown).toBe('One\n\nOne and a half\n\nTwo\n\nThree');

    const updated = await alice.put(`/pages/${page.id}/markdown/blocks/${two}`, { markdown: '## Two, as a heading' });
    expect(updated.body.markdown).toBe('One\n\nOne and a half\n\n## Two, as a heading\n\nThree');
    // The rewritten block keeps its id; the others are untouched
    expect(ids(updated.body)).toEqual([one, expect.any(String), two, three]);

    const deleted = await alice.delete(`/pages/${page.id}/markdown/blocks/${three}`);
    expect(deleted.body.markdown).toBe('One\n\nOne and a half\n\n## Two, as a heading');
    // And the end of the page
    const appended = await alice.post(`/pages/${page.id}/markdown/blocks`, { markdown: 'Last' });
    expect(appended.body.markdown.endsWith('\n\nLast')).toBe(true);
    // A new block never takes a deleted block's id, so a stale edit to that id can't land on it
    expect(ids(appended.body)).not.toContain(three);
    expect((await alice.put(`/pages/${page.id}/markdown/blocks/${three}`, { markdown: 'Stale edit' })).status).toBe(400);
  });

  it('a whole-page rewrite keeps the ids of blocks it leaves alone or edits', async () => {
    const page = await createPage(alice, workspaceId);
    const [one, two, three] = ids((await alice.put(`/pages/${page.id}/markdown`, { markdown: 'One\n\nTwo\n\nThree' })).body);
    const rewritten = (await alice.put(`/pages/${page.id}/markdown`, { markdown: 'Zero\n\nOne\n\nTwo, changed\n\nThree' })).body;
    expect(ids(rewritten).slice(1)).toEqual([one, two, three]);
    expect(ids(rewritten)[0]).not.toBe(one);
  });

  it('changes a block inside columns, keeps the columns, and won’t rewrite the page whole', async () => {
    const page = await createPage(alice, workspaceId);
    const para = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });
    const content = {
      type: 'doc',
      content: [
        { type: 'columns', content: [{ type: 'column', content: [para('block-1', 'Left')] }, { type: 'column', content: [para('block-2', 'Right')] }] },
        { type: 'databaseView', attrs: { id: 'block-3', pageId: page.id, title: 'Stock' } },
      ],
    };
    expect((await alice.put(`/pages/${page.id}/content`, { content })).status).toBe(200);

    const read = (await alice.get(`/pages/${page.id}/markdown`)).body;
    expect(read.blocks.map((b: any) => [b.id, b.column, b.embed])).toEqual([
      ['block-1', 1, false],
      ['block-2', 2, false],
      ['block-3', null, true],
    ]);

    const updated = await alice.put(`/pages/${page.id}/markdown/blocks/block-2`, { markdown: 'Right, edited' });
    expect(updated.status).toBe(200);
    const stored = (await alice.get(`/pages/${page.id}`)).body.content.content;
    expect(stored[0].type).toBe('columns');
    expect(stored[0].content[1].content[0].content[0].text).toBe('Right, edited');
    expect(stored[1].type).toBe('databaseView');

    // A database view has no Markdown form, and the page as a whole would lose its columns
    expect((await alice.put(`/pages/${page.id}/markdown/blocks/block-3`, { markdown: 'text' })).status).toBe(400);
    const whole = await alice.put(`/pages/${page.id}/markdown`, { markdown: 'Everything' });
    expect(whole.status).toBe(400);
    expect(whole.body.message).toMatch(/block by block/);
  });

  it('notes the change in the page’s history, credited to who made it', async () => {
    const page = await createPage(alice, workspaceId);
    await alice.put(`/pages/${page.id}/markdown`, { markdown: 'Written from outside' });
    const [version] = (await alice.get(`/pages/${page.id}/versions`)).body;
    expect(version.editors).toEqual([{ id: USERS.alice.id, name: USERS.alice.name }]);
  });

  it('lets a viewer read, but not write, and only document pages have Markdown', async () => {
    const page = await createPage(alice, workspaceId);
    await alice.put(`/pages/${page.id}/markdown`, { markdown: 'Shared' });
    expect((await bob.get(`/pages/${page.id}/markdown`)).body.markdown).toBe('Shared');
    expect((await bob.put(`/pages/${page.id}/markdown`, { markdown: 'Mine now' })).status).toBe(403);
    expect((await bob.post(`/pages/${page.id}/markdown/blocks`, { markdown: 'Me too' })).status).toBe(403);

    const database = await createPage(alice, workspaceId, { kind: 'DATABASE' });
    expect((await alice.get(`/pages/${database.id}/markdown`)).status).toBe(400);
    expect((await alice.put(`/pages/${page.id}/markdown`, {})).status).toBe(400);
  });
});

describe('page mentions in Markdown', () => {
  const mentionOf = (pageId: string) => ({ type: 'pageMention', attrs: { pageId } });
  const mentionsIn = (doc: any): string[] => {
    const found: string[] = [];
    const walk = (node: any) => {
      if (node?.type === 'pageMention') found.push(node.attrs?.pageId);
      (node?.content || []).forEach(walk);
    };
    walk(doc);
    return found;
  };

  it("reads as a link to the page with its title now, and keeps being a mention when written back", async () => {
    const target = await createPage(alice, workspaceId, { title: 'Onboarding' });
    const page = await createPage(alice, workspaceId);
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, mentionOf(target.id)] }] };
    expect((await alice.put(`/pages/${page.id}/content`, { content })).status).toBe(200);
    expect((await alice.get(`/pages/${page.id}/markdown`)).body.markdown).toBe(`See [@Onboarding](/doc/${target.id})`);
    // The title as it is now, not as it was when mentioned
    await alice.patch(`/pages/${target.id}`, { title: 'Onboarding, renamed' });
    expect((await alice.get(`/pages/${page.id}/markdown`)).body.markdown).toBe(`See [@Onboarding, renamed](/doc/${target.id})`);
    // Written back (the MCP server's way): still a mention, whatever the words in the brackets
    const written = await alice.put(`/pages/${page.id}/markdown`, { markdown: `Read [@anything](/doc/${target.id}) and [this](/doc/${target.id}).` });
    expect(written.status).toBe(200);
    const saved = (await alice.get(`/pages/${page.id}/content`)).body;
    expect(mentionsIn(saved)).toEqual([target.id]);
  });

  it("shows someone else's private page as a private page, not by its title", async () => {
    const secret = await createPage(alice, workspaceId, { title: 'Alice only', visibility: 'PRIVATE' });
    const page = await createPage(alice, workspaceId);
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [mentionOf(secret.id)] }] };
    expect((await alice.put(`/pages/${page.id}/content`, { content })).status).toBe(200);
    expect((await alice.get(`/pages/${page.id}/markdown`)).body.markdown).toBe(`[@Alice only](/doc/${secret.id})`);
    const asBob = (await bob.get(`/pages/${page.id}/markdown`)).body.markdown as string;
    expect(asBob).toBe(`[@Private page](/doc/${secret.id})`);
    expect(asBob).not.toContain('Alice only');
  });
});

describe('"Link to page" blocks in Markdown', () => {
  // As the "Sub-page" slash command makes one: a copy of the new page's title, "Untitled page"
  const linkTo = (pageId: string, title = 'Untitled page') => ({ type: 'pageLink', attrs: { pageId, title, icon: '' } });
  const markdownOf = async (session: Session, pageId: string) => (await session.get(`/pages/${pageId}/markdown`)).body;

  it('reads as a link to the page, with its title as it is now, not the copy the block saved', async () => {
    const target = await createPage(alice, workspaceId, { title: 'Gallery' });
    const page = await createPage(alice, workspaceId);
    expect((await alice.put(`/pages/${page.id}/content`, { content: { type: 'doc', content: [linkTo(target.id)] } })).status).toBe(200);
    expect((await markdownOf(alice, page.id)).markdown).toBe(`[Link to page: Gallery](/doc/${target.id})`);
    await alice.patch(`/pages/${target.id}`, { title: 'Image Gallery Options' });
    const read = await markdownOf(alice, page.id);
    expect(read.markdown).toBe(`[Link to page: Image Gallery Options](/doc/${target.id})`);
    // The same in the block-by-block form the MCP server reads
    expect(read.annotated).toContain(`[Link to page: Image Gallery Options](/doc/${target.id})`);
  });

  it("shows someone else's private page as a private page, and a block with no page chosen as such", async () => {
    const secret = await createPage(alice, workspaceId, { title: 'Alice only', visibility: 'PRIVATE' });
    const page = await createPage(alice, workspaceId);
    const content = { type: 'doc', content: [linkTo(secret.id, 'Alice only'), linkTo('', '')] };
    expect((await alice.put(`/pages/${page.id}/content`, { content })).status).toBe(200);
    const asBob = (await markdownOf(bob, page.id)).markdown as string;
    expect(asBob).toBe(`[Link to page: Private page](/doc/${secret.id})\n\n[Link to page: no page chosen]`);
    expect(asBob).not.toContain('Alice only');
  });

  it('is written back as a "Link to page" block, and a deleted page reads as deleted', async () => {
    const target = await createPage(alice, workspaceId, { title: 'Logo [draft]' });
    const page = await createPage(alice, workspaceId);
    expect((await alice.put(`/pages/${page.id}/markdown`, { markdown: `Intro\n\n[Link to page: anything](/doc/${target.id})` })).status).toBe(200);
    const saved = (await alice.get(`/pages/${page.id}/content`)).body;
    expect(saved.content[1]).toMatchObject({ type: 'pageLink', attrs: { pageId: target.id } });
    // A reader's stand-in for the title isn't saved as it
    expect((await alice.post(`/pages/${page.id}/markdown/blocks`, { markdown: `[Link to page: Private page](/doc/${target.id})` })).status).toBe(201);
    const added = (await alice.get(`/pages/${page.id}/content`)).body.content.at(-1);
    expect(added).toMatchObject({ type: 'pageLink', attrs: { pageId: target.id, title: '' } });
    await alice.delete(`/pages/${page.id}/markdown/blocks/${added.attrs.id}`);
    // Read again, it's the same line, the title escaped
    expect((await markdownOf(alice, page.id)).markdown).toBe(`Intro\n\n[Link to page: Logo \\[draft\\]](/doc/${target.id})`);

    // Changing it is refused without its title (a stale or private one) in the message
    const blockId = saved.content[1].attrs.id;
    const refused = await alice.put(`/pages/${page.id}/markdown/blocks/${blockId}`, { markdown: 'Text' });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('[Link to page]');

    await alice.delete(`/pages/${target.id}`);
    expect((await markdownOf(alice, page.id)).markdown).toBe(`Intro\n\n[Link to page: Deleted page](/doc/${target.id})`);
  });
});
