import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Session, USERS, addMember, createPage, createWorkspace, loginAs, paragraphTexts, unique } from './helpers';
import { appendParagraph, openLiveDocument } from './live';

// Duplicating a page: what's on it now (not the stored copy, minutes behind), with its icon, width
// and subpages, next to the original.

let alice: Session;
let viewer: Session;
let workspaceId: string;
const open: Array<{ close: () => void }> = [];

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  viewer = await loginAs(USERS.bob.email);
  workspaceId = await createWorkspace(alice);
  await addMember(alice, workspaceId, USERS.bob.email, 'VIEWER');
});

afterAll(() => open.forEach((live) => live.close()));

const children = async (parentId: string) =>
  ((await alice.get(`/pages?workspaceId=${workspaceId}`)).body as any[]).filter((p) => p.parentId === parentId).sort((a, b) => Number(a.position) - Number(b.position));

describe('duplicating a page', () => {
  it('copies what the page has now, its icon and width, and its subpages, next to the original', async () => {
    const parent = await createPage(alice, workspaceId, { title: unique('Parent') });
    const original = await createPage(alice, workspaceId, { title: 'Handbook', parentId: parent.id });
    const after = await createPage(alice, workspaceId, { title: 'After', parentId: parent.id });
    await alice.patch(`/pages/${original.id}`, { icon: '📘', fullWidth: true });
    const chapter = await createPage(alice, workspaceId, { title: 'Chapter', parentId: original.id });
    await createPage(alice, workspaceId, { title: 'Section', parentId: chapter.id });
    const live = await openLiveDocument(alice, workspaceId, original.id);
    open.push(live);
    appendParagraph(live.doc, 'Typed just now');

    const res = await alice.post(`/pages/${original.id}/duplicate`, {});
    expect(res.status).toBe(201);
    const copy = res.body;
    expect(copy).toMatchObject({ title: 'Handbook copy', icon: '📘', fullWidth: true, parentId: parent.id });
    expect((await children(parent.id)).map((p) => p.title)).toEqual(['Handbook', 'Handbook copy', 'After']);
    void after;

    const content = (await alice.get(`/pages/${copy.id}`)).body.content;
    expect(paragraphTexts(content)).toContain('Typed just now');
    // Its own block ids, so links and synced blocks to the original still go there
    const ids = (doc: any) => (doc.content ?? []).map((node: any) => node.attrs?.id);
    const originalIds = ids((await alice.get(`/pages/${original.id}`)).body.content);
    expect(ids(content).filter((id: string) => originalIds.includes(id))).toEqual([]);

    const copiedChapter = (await children(copy.id)).map((p) => p.title);
    expect(copiedChapter).toEqual(['Chapter']);
    const chapterCopy = (await children(copy.id))[0];
    expect((await children(chapterCopy.id)).map((p) => p.title)).toEqual(['Section']);
  });

  it("isn't for viewers", async () => {
    const page = await createPage(alice, workspaceId, { title: unique('Locked') });
    expect((await viewer.post(`/pages/${page.id}/duplicate`, {})).status).toBe(403);
  });
});
