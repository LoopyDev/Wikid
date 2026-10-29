import { beforeAll, describe, expect, it } from 'vitest';
import { Session, USERS, addMember, createPage, createWorkspace, loginAs, unique } from './helpers';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let alice: Session;
let bob: Session;
let workspaceId: string; // alice owns it, bob is a viewer

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  bob = await loginAs(USERS.bob.email);
  workspaceId = await createWorkspace(alice);
  await addMember(alice, workspaceId, USERS.bob.email, 'VIEWER');
});

/** Creates a database page and returns its page id and the id of its title field ("Name"). */
async function createDatabase(title = unique('Database')) {
  const page = await createPage(alice, workspaceId, { kind: 'DATABASE', title });
  const db = await alice.get(`/pages/${page.id}/database`);
  const titleField = db.body.fields.find((f: any) => f.name === 'Name');
  return { pageId: page.id as string, databaseId: db.body.id as string, titleFieldId: titleField.id as string };
}

const addField = async (pageId: string, body: Record<string, unknown>) => {
  const res = await alice.post(`/pages/${pageId}/database/fields`, body);
  expect(res.status).toBe(201);
  return res.body;
};

describe('databases', () => {
  it('creates a database page with a title field', async () => {
    const title = unique('Tasks');
    const page = await alice.post('/pages', { workspaceId, kind: 'DATABASE', title });
    expect(page.status).toBe(201);
    expect(page.body).toMatchObject({ kind: 'DATABASE', databaseComplianceMode: false });

    const db = await alice.get(`/pages/${page.body.id}/database`);
    expect(db.status).toBe(200);
    expect(db.body).toMatchObject({ pageId: page.body.id, workspaceId, title, complianceMode: false, rows: [], forms: [], views: [] });
    expect(db.body.fields.map((f: any) => [f.name, f.type])).toEqual([['Name', 'TEXT']]);

    // Viewers can read it; documents have no database.
    expect((await bob.get(`/pages/${page.body.id}/database`)).status).toBe(200);
    const doc = await createPage(alice, workspaceId);
    const notDatabase = await alice.get(`/pages/${doc.id}/database`);
    expect(notDatabase.status).toBe(400);
    expect(notDatabase.body.message).toBe('Page is not a database');
  });
});

describe('fields', () => {
  it('adds, renames, moves and deletes fields', async () => {
    const { pageId } = await createDatabase();
    const field = await addField(pageId, { name: '  Status  ', type: 'SELECT', options: { choices: ['Open', 'Done'] } });
    expect(field).toMatchObject({ name: 'Status', type: 'SELECT' });
    expect(field.options.choices).toEqual(['Open', 'Done']);
    expect((await addField(pageId, {})).name).toBe('Field');
    expect((await addField(pageId, { name: 'Odd', type: 'NOT_A_TYPE' })).type).toBe('TEXT');

    const renamed = await alice.patch(`/database-fields/${field.id}`, { name: 'State', position: 10 });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'State', position: '10' });

    expect((await alice.delete(`/database-fields/${field.id}`)).status).toBe(200);
    const fields = (await alice.get(`/pages/${pageId}/database`)).body.fields.map((f: any) => f.id);
    expect(fields).not.toContain(field.id);
    expect((await alice.delete(`/database-fields/${field.id}`)).status).toBe(404);
  });

  it("doesn't let viewers change fields", async () => {
    const { pageId, titleFieldId } = await createDatabase();
    expect((await bob.post(`/pages/${pageId}/database/fields`, { name: 'x' })).status).toBe(403);
    expect((await bob.patch(`/database-fields/${titleFieldId}`, { name: 'x' })).status).toBe(403);
    expect((await bob.delete(`/database-fields/${titleFieldId}`)).status).toBe(403);
  });

  it('removes a deleted field from rows and forms', async () => {
    const { pageId } = await createDatabase();
    const field = await addField(pageId, { name: 'Count', type: 'NUMBER' });
    const row = await alice.post(`/pages/${pageId}/database/rows`, { data: { [field.id]: 3 } });
    const form = await alice.post(`/pages/${pageId}/database/forms`, { name: 'Form', fields: [{ fieldId: field.id }] });
    expect(form.body.fields.map((f: any) => f.fieldId)).toEqual([field.id]);

    await alice.delete(`/database-fields/${field.id}`);
    const db = (await alice.get(`/pages/${pageId}/database`)).body;
    expect(db.rows.find((r: any) => r.id === row.body.id).data[field.id]).toBeUndefined();
    expect(db.forms.find((f: any) => f.id === form.body.id).fields).toEqual([]);
  });
});

describe('rows', () => {
  it('stores values according to the field types', async () => {
    const { pageId, titleFieldId } = await createDatabase();
    const num = await addField(pageId, { name: 'Number', type: 'NUMBER' });
    const check = await addField(pageId, { name: 'Done', type: 'CHECKBOX' });
    const date = await addField(pageId, { name: 'Due', type: 'DATE' });
    const select = await addField(pageId, { name: 'Status', type: 'SELECT', options: { choices: ['Open', 'Done'] } });
    const multi = await addField(pageId, { name: 'Tags', type: 'MULTI_SELECT', options: { choices: ['a', 'b'] } });

    const res = await alice.post(`/pages/${pageId}/database/rows`, {
      data: {
        [titleFieldId]: '  First  ',
        [num.id]: '42',
        [check.id]: 'yes',
        [date.id]: '2026-01-31',
        [select.id]: 'Open',
        [multi.id]: 'a, b, c',
        unknownField: 'dropped',
      },
    });
    expect(res.status).toBe(201);
    // A row with a title gets its own page straight away.
    expect(res.body.pageId).toEqual(expect.any(String));
    expect(res.body.data).toEqual({
      __pageId: res.body.pageId,
      [titleFieldId]: 'First',
      [num.id]: 42,
      [check.id]: true,
      [date.id]: '2026-01-31',
      [select.id]: 'Open',
      [multi.id]: ['a', 'b'],
    });

    const invalid = await alice.post(`/pages/${pageId}/database/rows`, {
      data: { [num.id]: 'not a number', [select.id]: 'Unknown', [date.id]: 'never' },
    });
    expect(invalid.body.data).toEqual({});
  });

  it('updates, orders and deletes rows', async () => {
    const { pageId, titleFieldId } = await createDatabase();
    const first = (await alice.post(`/pages/${pageId}/database/rows`, { data: { [titleFieldId]: 'A' } })).body;
    const second = (await alice.post(`/pages/${pageId}/database/rows`, { data: { [titleFieldId]: 'B' } })).body;
    expect(Number(second.position)).toBeGreaterThan(Number(first.position));

    // Rows with a page come back together with the page.
    const updated = await alice.patch(`/database-rows/${first.id}`, { data: { [titleFieldId]: 'A2' } });
    expect(updated.status).toBe(200);
    expect(updated.body.row.data[titleFieldId]).toBe('A2');
    expect(updated.body.page).toMatchObject({ id: first.pageId, title: 'A2' });

    const untitled = (await alice.post(`/pages/${pageId}/database/rows`, { data: {} })).body;
    expect(untitled.pageId).toBeNull();
    const untitledUpdate = await alice.patch(`/database-rows/${untitled.id}`, { position: 5 });
    expect(untitledUpdate.status).toBe(200);

    expect((await alice.delete(`/database-rows/${first.id}`)).status).toBe(200);
    const rows = (await alice.get(`/pages/${pageId}/database`)).body.rows.map((r: any) => r.id);
    expect(rows).toEqual([second.id, untitled.id]);
    expect((await alice.patch(`/database-rows/${first.id}`, { data: {} })).status).toBe(404);
  });

  it("doesn't let viewers change rows", async () => {
    const { pageId } = await createDatabase();
    const row = (await alice.post(`/pages/${pageId}/database/rows`, { data: {} })).body;
    expect((await bob.post(`/pages/${pageId}/database/rows`, { data: {} })).status).toBe(403);
    expect((await bob.patch(`/database-rows/${row.id}`, { data: {} })).status).toBe(403);
    expect((await bob.delete(`/database-rows/${row.id}`)).status).toBe(403);
  });

  it('opens a row as a page and keeps the title in sync both ways', async () => {
    const { pageId, titleFieldId } = await createDatabase();
    const row = (await alice.post(`/pages/${pageId}/database/rows`, { data: { [titleFieldId]: 'Row title' } })).body;

    const opened = await alice.post(`/database-rows/${row.id}/page`, {});
    expect(opened.status).toBe(201);
    expect(opened.body.row.pageId).toBe(opened.body.page.id);
    expect(opened.body.page).toMatchObject({ parentId: pageId, title: 'Row title' });
    // Opening again returns the same page.
    expect((await alice.post(`/database-rows/${row.id}/page`, {})).body.page.id).toBe(opened.body.page.id);

    await alice.patch(`/pages/${opened.body.page.id}`, { title: 'Renamed page' });
    const db = (await alice.get(`/pages/${pageId}/database`)).body;
    expect(db.rows.find((r: any) => r.id === row.id).data[titleFieldId]).toBe('Renamed page');

    await alice.patch(`/database-rows/${row.id}`, { data: { [titleFieldId]: 'Renamed row' } });
    expect((await alice.get(`/pages/${opened.body.page.id}`)).body.title).toBe('Renamed row');
  });
});

describe('relations', () => {
  it('links rows across databases and reports backlinks', async () => {
    const people = await createDatabase(unique('People'));
    const tasks = await createDatabase(unique('Tasks'));
    const person = (await alice.post(`/pages/${people.pageId}/database/rows`, { data: { [people.titleFieldId]: 'Ada' } })).body;

    const relation = await addField(tasks.pageId, { name: 'Owner', type: 'RELATION', options: { relation: { pageId: people.pageId } } });
    expect(relation.options.relation).toMatchObject({ pageId: people.pageId, allowMultiple: false });

    const task = await alice.post(`/pages/${tasks.pageId}/database/rows`, {
      data: { [tasks.titleFieldId]: 'Write tests', [relation.id]: person.id },
    });
    expect(task.status).toBe(201);
    expect(JSON.stringify(task.body.data[relation.id])).toContain(person.id);

    const backlinks = await alice.get(`/database-rows/${person.id}/backlinks`);
    expect(backlinks.status).toBe(200);
    expect(backlinks.body.rowId).toBe(person.id);
    expect(JSON.stringify(backlinks.body.backlinks)).toContain(task.body.id);
  });

  it('works out a "Linked from" column from relations pointing here, leaving out databases the user cannot open', async () => {
    const people = await createDatabase(unique('People'));
    const tasks = await createDatabase(unique('Tasks'));
    const ada = (await alice.post(`/pages/${people.pageId}/database/rows`, { data: { [people.titleFieldId]: 'Ada' } })).body;
    const owner = await addField(tasks.pageId, { name: 'Owner', type: 'RELATION', options: { relation: { pageId: people.pageId } } });
    const task = (await alice.post(`/pages/${tasks.pageId}/database/rows`, { data: { [tasks.titleFieldId]: 'Write tests', [owner.id]: ada.id } })).body;
    const linkedFrom = await addField(people.pageId, {
      name: 'Tasks',
      type: 'LINKED_FROM',
      options: { linkedFrom: { pageId: tasks.pageId, fieldId: owner.id } },
    });
    expect(linkedFrom).toMatchObject({ type: 'LINKED_FROM', options: { linkedFrom: { pageId: tasks.pageId, fieldId: owner.id } } });

    // Alice's private database links to Ada too
    const secret = await createPage(alice, workspaceId, { kind: 'DATABASE', title: unique('Secret'), visibility: 'PRIVATE' });
    const secretDb = (await alice.get(`/pages/${secret.id}/database`)).body;
    const secretTitle = secretDb.fields.find((f: any) => f.name === 'Name').id;
    const secretOwner = await addField(secret.id, { name: 'Owner', type: 'RELATION', options: { relation: { pageId: people.pageId } } });
    await alice.post(`/pages/${secret.id}/database/rows`, { data: { [secretTitle]: 'Hidden task', [secretOwner.id]: ada.id } });

    const relationsFor = async (session: Session) => {
      const res = await session.get(`/pages/${people.pageId}/database/incoming-relations`);
      expect(res.status).toBe(200);
      return res.body.relations.map((r: any) => `${r.databasePageId}:${r.fieldId}`);
    };
    expect(await relationsFor(alice)).toEqual(expect.arrayContaining([`${tasks.pageId}:${owner.id}`, `${secret.id}:${secretOwner.id}`]));
    const bobSees = await relationsFor(bob);
    expect(bobSees).toContain(`${tasks.pageId}:${owner.id}`);
    expect(bobSees).not.toContain(`${secret.id}:${secretOwner.id}`);

    const linkedRows = (session: Session, sourcePageId: string, fieldId: string) =>
      session.get(`/pages/${people.pageId}/database/linked-rows?sourcePageId=${sourcePageId}&fieldId=${fieldId}`);
    const fromTasks = await linkedRows(bob, tasks.pageId, owner.id);
    expect(fromTasks.status).toBe(200);
    expect(fromTasks.body.rows[ada.id]).toEqual([{ rowId: task.id, rowPageId: task.pageId ?? null, title: 'Write tests', color: null }]);
    expect((await linkedRows(alice, secret.id, secretOwner.id)).body.rows[ada.id]).toHaveLength(1);
    expect((await linkedRows(bob, secret.id, secretOwner.id)).body.rows).toEqual({});
    // A field that isn't a relation pointing here shows nothing
    expect((await linkedRows(alice, tasks.pageId, tasks.titleFieldId)).body.rows).toEqual({});
  });

  it("gives each row's current title, for relations pointing at a database", async () => {
    const people = await createDatabase(unique('People'));
    const ada = (await alice.post(`/pages/${people.pageId}/database/rows`, { data: { [people.titleFieldId]: 'Ada' } })).body;
    const titles = await bob.get(`/pages/${people.pageId}/database/row-titles`);
    expect(titles.status).toBe(200);
    expect(titles.body.rows).toEqual([{ id: ada.id, pageId: ada.pageId ?? null, title: 'Ada', color: null }]);

    const secret = await createPage(alice, workspaceId, { kind: 'DATABASE', title: unique('Secret'), visibility: 'PRIVATE' });
    expect((await alice.get(`/pages/${secret.id}/database/row-titles`)).status).toBe(200);
    expect((await bob.get(`/pages/${secret.id}/database/row-titles`)).status).toBe(403);
  });

  it('requires a valid relation target in the same workspace', async () => {
    const { pageId } = await createDatabase();
    const missing = await alice.post(`/pages/${pageId}/database/fields`, { name: 'Rel', type: 'RELATION' });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe('Relation target is required.');
    const unknown = await alice.post(`/pages/${pageId}/database/fields`, {
      name: 'Rel',
      type: 'RELATION',
      options: { relation: { pageId: MISSING_ID } },
    });
    expect(unknown.status).toBe(404);

    const otherWorkspace = await createWorkspace(alice);
    const elsewhere = await createPage(alice, otherWorkspace, { kind: 'DATABASE' });
    const crossWorkspace = await alice.post(`/pages/${pageId}/database/fields`, {
      name: 'Rel',
      type: 'RELATION',
      options: { relation: { pageId: elsewhere.id } },
    });
    expect(crossWorkspace.status).toBe(400);
    expect(crossWorkspace.body.message).toBe('Relation target must be in the same workspace.');
  });
});

describe('views', () => {
  it('creates, updates and deletes views', async () => {
    const { pageId } = await createDatabase();
    const view = await alice.post(`/pages/${pageId}/database/views`, { name: 'Board', type: 'BOARD' });
    expect(view.status).toBe(201);
    expect(view.body).toMatchObject({ name: 'Board', type: 'BOARD' });
    expect(view.body.config).toMatchObject({ sorts: [], hiddenFieldIds: [] });

    const updated = await alice.patch(`/database-views/${view.body.id}`, { name: 'Kanban' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Kanban');
    expect((await alice.get(`/pages/${pageId}/database`)).body.views.map((v: any) => v.name)).toEqual(['Kanban']);

    expect((await bob.delete(`/database-views/${view.body.id}`)).status).toBe(403);
    expect((await alice.delete(`/database-views/${view.body.id}`)).status).toBe(200);
    expect((await alice.get(`/pages/${pageId}/database`)).body.views).toEqual([]);
    expect((await alice.patch(`/database-views/${view.body.id}`, { name: 'x' })).status).toBe(404);
  });

  it("keeps a gallery's card columns and how many of a cover's linked rows to show, tidied", async () => {
    const { pageId, titleFieldId } = await createDatabase();
    const notes = await addField(pageId, { name: 'Notes', type: 'TEXT' });
    const view = await alice.post(`/pages/${pageId}/database/views`, {
      name: 'Cards',
      type: 'GALLERY',
      config: { cardFieldIds: [notes.id, MISSING_ID, notes.id, 7], coverMaxItems: 500 },
    });
    expect(view.status).toBe(201);
    expect(view.body.config).toMatchObject({ cardFieldIds: [notes.id], coverMaxItems: 50 });

    const cleared = await alice.patch(`/database-views/${view.body.id}`, { config: { cardFieldIds: 'all', coverMaxItems: 0 } });
    expect(cleared.body.config).toMatchObject({ cardFieldIds: null, coverMaxItems: null });
    const chosen = await alice.patch(`/database-views/${view.body.id}`, { config: { cardFieldIds: [], coverMaxItems: 4, cardFieldId: titleFieldId } });
    expect(chosen.body.config).toMatchObject({ cardFieldIds: [], coverMaxItems: 4, cardFieldId: titleFieldId });
  });
});

describe('forms', () => {
  it("fills a date field in with today when it's set to, from the submitter's own date if it's near", async () => {
    const { pageId, titleFieldId } = await createDatabase();
    const received = await addField(pageId, { name: 'Received', type: 'DATE' });
    const form = await alice.post(`/pages/${pageId}/database/forms`, {
      name: 'Intake',
      fields: [{ fieldId: titleFieldId, required: true }, { fieldId: received.id, auto: { type: 'today' } }],
    });
    expect(form.status).toBe(201);
    expect(form.body.fields[1].auto).toEqual({ type: 'today' });
    // Only for date fields
    const onText = await alice.post(`/pages/${pageId}/database/forms`, { name: 'Other', fields: [{ fieldId: titleFieldId, auto: { type: 'today' } }] });
    expect(onText.body.fields[0].auto).toBeUndefined();

    const serverToday = new Date().toISOString().slice(0, 10);
    const dayFrom = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const submit = async (sent?: string) =>
      (await alice.post(`/database-forms/${form.body.id}/submit`, { data: { [titleFieldId]: 'Entry', ...(sent ? { [received.id]: sent } : {}) } })).body.data[received.id];
    // The submitter's own date, a day either side of the server's (time zones)
    expect(await submit(dayFrom(1))).toBe(dayFrom(1));
    expect(await submit(dayFrom(-1))).toBe(dayFrom(-1));
    // Anything else, or nothing, is the server's today
    expect(await submit('2001-01-01')).toBe(serverToday);
    expect(await submit('not a date')).toBe(serverToday);
    expect(await submit()).toBe(serverToday);
  });

  it("turns a date away that's later than today when the form says no future", async () => {
    const { pageId, titleFieldId } = await createDatabase();
    const happened = await addField(pageId, { name: 'Happened', type: 'DATE' });
    const form = await alice.post(`/pages/${pageId}/database/forms`, {
      name: 'Incident',
      fields: [{ fieldId: titleFieldId, noFuture: true }, { fieldId: happened.id, noFuture: true }],
    });
    expect(form.status).toBe(201);
    // Only kept on date fields
    expect(form.body.fields.map((f: any) => f.noFuture)).toEqual([undefined, true]);

    const dayFrom = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const submit = (date: string) =>
      alice.post(`/database-forms/${form.body.id}/submit`, { data: { [titleFieldId]: 'Entry', [happened.id]: date } });
    expect((await submit(dayFrom(-30))).status).toBe(201);
    // A day ahead is allowed, for people ahead of the server's time zone
    expect((await submit(dayFrom(1))).status).toBe(201);
    const later = await submit(dayFrom(3));
    expect(later.status).toBe(400);
    expect(later.body.message).toContain('Happened');
  });

  it('creates a form, reads it and submits entries', async () => {
    const { pageId, titleFieldId } = await createDatabase();
    const count = await addField(pageId, { name: 'Count', type: 'NUMBER' });
    const form = await alice.post(`/pages/${pageId}/database/forms`, {
      name: 'Report',
      fields: [{ fieldId: titleFieldId, required: true }, { fieldId: count.id }, { fieldId: MISSING_ID }],
    });
    expect(form.status).toBe(201);
    expect(form.body.fields.map((f: any) => [f.fieldId, f.required])).toEqual([
      [titleFieldId, true],
      [count.id, false],
    ]);

    const read = await bob.get(`/database-forms/${form.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ id: form.body.id, name: 'Report', databasePageId: pageId, databaseRowCount: 0 });

    const missing = await alice.post(`/database-forms/${form.body.id}/submit`, { data: { [count.id]: 1 } });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe('Missing required fields: Name');

    const submitted = await alice.post(`/database-forms/${form.body.id}/submit`, {
      data: { [titleFieldId]: 'Entry', [count.id]: '7' },
    });
    expect(submitted.status).toBe(201);
    expect(submitted.body.data).toEqual({ __pageId: submitted.body.pageId, [titleFieldId]: 'Entry', [count.id]: 7 });

    // An update-mode form edits an existing row instead of adding one.
    const editForm = await alice.post(`/pages/${pageId}/database/forms`, {
      name: 'Edit',
      fields: [{ fieldId: titleFieldId }, { fieldId: count.id }],
      config: { mode: 'update' },
    });
    expect(editForm.status).toBe(201);
    const noRow = await alice.post(`/database-forms/${editForm.body.id}/submit`, { data: { [count.id]: 1 } });
    expect(noRow.status).toBe(400);
    expect(noRow.body.message).toBe('rowId is required');
    const edited = await alice.post(`/database-forms/${editForm.body.id}/submit`, {
      rowId: submitted.body.id,
      data: { [titleFieldId]: 'Edited', [count.id]: 8 },
    });
    expect(edited.status).toBe(201);
    const rows = (await alice.get(`/pages/${pageId}/database`)).body.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toMatchObject({ [titleFieldId]: 'Edited', [count.id]: 8 });
  });

  it('renames and deletes forms', async () => {
    const { pageId } = await createDatabase();
    const form = (await alice.post(`/pages/${pageId}/database/forms`, { name: 'Form' })).body;
    const renamed = await alice.patch(`/database-forms/${form.id}`, { name: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Renamed');
    expect((await bob.patch(`/database-forms/${form.id}`, { name: 'x' })).status).toBe(403);
    expect((await alice.delete(`/database-forms/${form.id}`)).status).toBe(200);
    expect((await alice.get(`/database-forms/${form.id}`)).status).toBe(404);
  });

  it('keeps both changes when the fields and the settings are saved at the same time', async () => {
    // Both live in one column; overlapping saves used to overwrite each other's half.
    const { pageId, titleFieldId } = await createDatabase();
    for (let i = 0; i < 5; i += 1) {
      const form = (await alice.post(`/pages/${pageId}/database/forms`, { name: 'Form', fields: [{ fieldId: titleFieldId }] })).body;
      const message = `Thanks ${i}`;
      const [fields, config] = await Promise.all([
        alice.patch(`/database-forms/${form.id}`, { fields: [{ fieldId: titleFieldId, required: true }] }),
        alice.patch(`/database-forms/${form.id}`, { config: { successMessage: message } }),
      ]);
      expect([fields.status, config.status]).toEqual([200, 200]);
      const stored = (await alice.get(`/pages/${pageId}/database`)).body.forms.find((f: any) => f.id === form.id);
      expect(stored.fields.fields.find((f: any) => f.fieldId === titleFieldId)?.required).toBe(true);
      expect(stored.fields.config?.successMessage).toBe(message);
    }
  });
});

describe('compliance mode', () => {
  it('turns compliance mode on for a database', async () => {
    const { pageId } = await createDatabase();
    const res = await alice.patch(`/pages/${pageId}/database`, { complianceMode: true });
    expect(res.status).toBe(200);
    expect((await alice.get(`/pages/${pageId}/database`)).body.complianceMode).toBe(true);
  });
});
