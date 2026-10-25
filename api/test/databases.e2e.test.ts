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
});

describe('forms', () => {
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
});

describe('compliance mode', () => {
  it('turns compliance mode on for a database', async () => {
    const { pageId } = await createDatabase();
    const res = await alice.patch(`/pages/${pageId}/database`, { complianceMode: true });
    expect(res.status).toBe(200);
    expect((await alice.get(`/pages/${pageId}/database`)).body.complianceMode).toBe(true);
  });
});
