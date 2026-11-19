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
    // (On the server before the copy's made: it copies what the server has)
    await live.sent();

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

describe('duplicating a page with a database in it', () => {
  /** A database (under `parentId`) with a select, a relation to its own rows, a board, a form and two rows with pages. */
  async function database(parentId: string) {
    const db = (await createPage(alice, workspaceId, { title: 'Tasks', kind: 'DATABASE', parentId })).id as string;
    const name = (await alice.get(`/pages/${db}/database`)).body.fields.find((f: any) => f.name === 'Name').id;
    const status = (await alice.post(`/pages/${db}/database/fields`, { name: 'Status', type: 'SELECT', options: { choices: [{ value: 'To do', color: '#ff0000' }, { value: 'Done' }] } })).body.id;
    const blockedBy = (await alice.post(`/pages/${db}/database/fields`, { name: 'Blocked by', type: 'RELATION', options: { relation: { pageId: db, allowMultiple: true } } })).body.id;
    const first = (await alice.post(`/pages/${db}/database/rows`, { data: { [name]: 'Write', [status]: 'To do' } })).body;
    const second = (await alice.post(`/pages/${db}/database/rows`, { data: { [name]: 'Test', [status]: 'Done', [blockedBy]: [first.id] } })).body;
    // What's written on a row's page comes too
    const rowPage = first.pageId ?? (await alice.post(`/database-rows/${first.id}/page`, { pageId: db })).body.page.id;
    expect((await alice.put(`/pages/${rowPage}/markdown`, { markdown: 'Notes on writing' })).status).toBe(200);
    expect((await alice.post(`/pages/${db}/database/views`, { name: 'Board', type: 'BOARD', config: { groupFieldId: status, sorts: [{ fieldId: name, direction: 'asc' }] } })).status).toBe(201);
    expect((await alice.post(`/pages/${db}/database/forms`, { name: 'New task', fields: [{ fieldId: name }, { fieldId: status }] })).status).toBe(201);
    return { db, name, status, blockedBy, first, second };
  }
  const copiedDatabase = async (copyId: string) => {
    const db = (await children(copyId)).find((p) => p.kind === 'DATABASE');
    return (await alice.get(`/pages/${db.id}/database`)).body;
  };

  it('copies its columns, views, forms and rows, each row with its page, all pointing at the copy', async () => {
    const parent = await createPage(alice, workspaceId, { title: unique('Project') });
    const original = await database(parent.id);
    const copy = (await alice.post(`/pages/${parent.id}/duplicate`, {})).body;
    const copied = await copiedDatabase(copy.id);

    const fieldNamed = (name: string) => copied.fields.find((f: any) => f.name === name);
    expect(copied.fields.map((f: any) => f.name)).toEqual(['Name', 'Status', 'Blocked by']);
    expect(copied.fields.map((f: any) => f.id)).not.toContain(original.status);
    expect(fieldNamed('Status').options.choices.map((c: any) => [c.value, c.color ?? null])).toEqual([['To do', '#ff0000'], ['Done', null]]);
    // Its relation is to its own rows (the copy's), as the original's is to its own
    expect(fieldNamed('Blocked by').options.relation.pageId).toBe(copied.pageId);

    const rows = copied.rows.map((r: any) => ({ name: r.data[fieldNamed('Name').id], status: r.data[fieldNamed('Status').id], blockedBy: r.data[fieldNamed('Blocked by').id], id: r.id, pageId: r.pageId }));
    expect(rows.map((r: any) => [r.name, r.status])).toEqual([['Write', 'To do'], ['Test', 'Done']]);
    expect(rows[1].blockedBy.map((link: any) => link.id ?? link)).toEqual([rows[0].id]);
    expect(rows[0].id).not.toBe(original.first.id);
    const page = (await alice.get(`/pages/${rows[0].pageId}/markdown`)).body.markdown;
    expect(page).toContain('Notes on writing');

    const view = copied.views.find((v: any) => v.name === 'Board');
    expect(view.config.groupFieldId).toBe(fieldNamed('Status').id);
    expect(view.config.sorts).toEqual([{ fieldId: fieldNamed('Name').id, direction: 'asc' }]);
    expect(JSON.stringify(copied.forms[0].fields)).toContain(fieldNamed('Status').id);
    expect(JSON.stringify(copied.forms[0].fields)).not.toContain(original.status);

    // The original's as it was
    const before = (await alice.get(`/pages/${original.db}/database`)).body;
    expect(before.rows.map((r: any) => r.id)).toEqual([original.first.id, original.second.id]);
  });

  it('copies only its columns, views and forms when asked', async () => {
    const parent = await createPage(alice, workspaceId, { title: unique('Template') });
    await database(parent.id);
    const copy = (await alice.post(`/pages/${parent.id}/duplicate`, { rows: false })).body;
    const copied = await copiedDatabase(copy.id);
    expect(copied.fields.map((f: any) => f.name)).toEqual(['Name', 'Status', 'Blocked by']);
    expect(copied.views.map((v: any) => v.name)).toContain('Board');
    expect(copied.rows).toEqual([]);
  });

  it('a relation between two databases copied together joins their copies', async () => {
    const parent = await createPage(alice, workspaceId, { title: unique('Team') });
    const people = (await createPage(alice, workspaceId, { title: 'People', kind: 'DATABASE', parentId: parent.id })).id as string;
    const tasks = (await createPage(alice, workspaceId, { title: 'Tasks', kind: 'DATABASE', parentId: parent.id })).id as string;
    const personName = (await alice.get(`/pages/${people}/database`)).body.fields.find((f: any) => f.name === 'Name').id;
    const ann = (await alice.post(`/pages/${people}/database/rows`, { data: { [personName]: 'Ann' } })).body;
    const owner = (await alice.post(`/pages/${tasks}/database/fields`, { name: 'Owner', type: 'RELATION', options: { relation: { pageId: people, allowMultiple: true } } })).body.id;
    await alice.post(`/pages/${tasks}/database/rows`, { data: { [owner]: [ann.id] } });

    const copy = (await alice.post(`/pages/${parent.id}/duplicate`, {})).body;
    const copiedPages = await children(copy.id);
    const copiedPeople = (await alice.get(`/pages/${copiedPages.find((p) => p.title === 'People').id}/database`)).body;
    const copiedTasks = (await alice.get(`/pages/${copiedPages.find((p) => p.title === 'Tasks').id}/database`)).body;
    const copiedOwner = copiedTasks.fields.find((f: any) => f.name === 'Owner');
    expect(copiedOwner.options.relation.pageId).toBe(copiedPeople.pageId);
    expect(copiedTasks.rows[0].data[copiedOwner.id].map((link: any) => link.id ?? link)).toEqual([copiedPeople.rows[0].id]);
  });

  it("copies what's under a row's page too", async () => {
    const parent = await createPage(alice, workspaceId, { title: unique('Notes') });
    const { first } = await database(parent.id);
    const rowPage = first.pageId ?? (await alice.get(`/pages/${(await children(parent.id))[0].id}/database`)).body.rows[0].pageId;
    await createPage(alice, workspaceId, { title: 'Meeting notes', parentId: rowPage });

    const copy = (await alice.post(`/pages/${parent.id}/duplicate`, {})).body;
    const copied = await copiedDatabase(copy.id);
    const copiedRowPage = copied.rows.find((r: any) => r.pageId && r.pageId !== rowPage).pageId;
    expect((await children(copiedRowPage)).map((p) => p.title)).toEqual(['Meeting notes']);
  });

  it("copies a compliance database's structure, never its records; refused while compliance is off", async () => {
    const admin = await loginAs(USERS.admin.email);
    const parent = await createPage(alice, workspaceId, { title: unique('Register') });
    const db = (await createPage(alice, workspaceId, { title: 'Assets', kind: 'DATABASE', parentId: parent.id, complianceMode: true })).id;
    const name = (await alice.get(`/pages/${db}/database`)).body.fields[0].id;
    await alice.post(`/pages/${db}/database/rows`, { data: { [name]: 'Laptop' } });

    const copy = (await alice.post(`/pages/${parent.id}/duplicate`, {})).body;
    const copied = await copiedDatabase(copy.id);
    expect(copied.complianceMode).toBe(true);
    expect(copied.rows).toEqual([]);

    expect((await admin.patch('/admin/settings', { complianceEnabled: false })).status).toBe(200);
    try {
      const refused = await alice.post(`/pages/${parent.id}/duplicate`, {});
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/turned off/);
    } finally {
      await admin.patch('/admin/settings', { complianceEnabled: true });
    }
  });
});
