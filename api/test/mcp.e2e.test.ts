import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { API_URL, DEMO_PASSWORD, Session, USERS, createWorkspace, loginAs } from './helpers';

// The MCP server (mcp/index.js), run as an AI tool runs it: a separate process spoken to over
// stdio, logged in as Alice, against the running stack.

let client: Client;
let alice: Session;
let workspaceId: string;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: result.content.map((c) => c.text).join('\n'), isError: !!result.isError };
};
// Block ids in get_page's output, in order
const blockIds = (text: string) => [...text.matchAll(/<!-- (block-[A-Za-z0-9_-]+)/g)].map((m) => m[1]);
const pageIdIn = (text: string) => text.match(/Page ([0-9a-f-]{36})\./)?.[1] as string;

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  workspaceId = await createWorkspace(alice);
  client = new Client({ name: 'wikid-test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve(__dirname, '../../mcp/index.js')],
      env: { ...process.env, WIKID_API_URL: API_URL, WIKID_EMAIL: USERS.alice.email, WIKID_PASSWORD: DEMO_PASSWORD } as Record<string, string>,
    }),
  );
});

afterAll(async () => {
  await client?.close();
});

describe('MCP server', () => {
  it('offers its tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_database_column', 'add_database_row', 'add_image', 'create_database', 'create_database_view', 'create_page',
      'delete_block', 'delete_database_column', 'delete_database_view', 'get_database', 'get_page', 'insert_blocks', 'list_pages',
      'list_workspaces', 'rename_page', 'replace_page', 'search', 'update_block', 'update_database_column', 'update_database_row',
      'update_database_view',
    ]);
  });

  it('writes a page from Markdown, reads it back, and changes it block by block', async () => {
    const created = await call('create_page', { workspaceId, title: 'Trip plan', markdown: '# Packing\n\n- [ ] Passport\n- [ ] Charger\n\nBook the train.' });
    expect(created.isError).toBe(false);
    const pageId = pageIdIn(created.text);

    const read = await call('get_page', { pageId });
    expect(read.text).toContain('# Trip plan');
    expect(read.text).toContain('- [ ] Passport\n- [ ] Charger');
    const [heading, list, train] = blockIds(read.text);

    await call('update_block', { pageId, blockId: train, markdown: 'Book the **train** and the hotel.' });
    await call('insert_blocks', { pageId, markdown: '> 💡 Leave by 8.', afterId: heading });
    await call('delete_block', { pageId, blockId: list });
    await call('rename_page', { pageId, title: 'Trip' });

    const after = (await alice.get(`/pages/${pageId}/markdown`)).body;
    expect(after.title).toBe('Trip');
    expect(after.markdown).toBe('# Packing\n\n> 💡 Leave by 8.\n\nBook the **train** and the hotel.');
  });

  it('uploads an image from a file, in place of an image placeholder, keeping what it said', async () => {
    // A 1×1 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'wikid-mcp-')), 'north wall.png');
    await writeFile(file, png);
    const created = await call('create_page', { workspaceId, title: 'Site visit', markdown: 'Intro\n\n[Image to add: The north wall]\n\nOutro' });
    const pageId = pageIdIn(created.text);
    const [, placeholder] = blockIds(created.text);

    const added = await call('add_image', { pageId, file, replaceId: placeholder });
    expect(added.isError).toBe(false);
    const stored = (await alice.get(`/pages/${pageId}`)).body.content.content;
    expect(stored.map((n: any) => n.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(stored[1].attrs).toMatchObject({ alt: 'The north wall', src: expect.stringMatching(new RegExp(`/uploads/${pageId}/.+\\.png$`)) });
    // Served to someone who can see the page
    const served = await alice.get(stored[1].attrs.src.replace(/^.*\/uploads\//, '/uploads/'));
    expect(served.status).toBe(200);

    expect((await call('add_image', { pageId, file: path.join(path.dirname(file), 'missing.png') })).text).toMatch(/no such file/);
    expect((await call('add_image', { pageId, file, url: 'https://example.com/a.png' })).text).toBe('Give either file or url');
  });

  it("refuses an id that isn't one, so it can't reach another part of the API", async () => {
    const victim = pageIdIn((await call('create_page', { workspaceId, title: 'Keep me', markdown: 'Still here.' })).text);
    for (const [tool, args] of [
      ['get_page', { pageId: '../auth/me?' }],
      ['delete_block', { pageId: `../pages/${victim}?x=`, blockId: 'block-1' }],
      ['list_pages', { workspaceId: `${workspaceId}&x=` }],
    ] as const) {
      const result = await call(tool, args);
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/not a valid id/i);
    }
    expect((await alice.get(`/pages/${victim}`)).body.isDeleted).toBe(false);
  });

  it('makes columns and toggles, and shows them as it reads the page', async () => {
    const markdown = '::: columns\n**Before**\n::: column\n**After**\n:::\n\n::: toggle\n## Details\n\nThe small print.\n:::';
    const created = await call('create_page', { workspaceId, title: 'Compare', markdown });
    const pageId = pageIdIn(created.text);
    const stored = (await alice.get(`/pages/${pageId}`)).body.content.content;
    expect(stored.map((n: any) => n.type)).toEqual(['columns', 'toggleHeading']);
    expect(stored[0].content).toHaveLength(2);

    const read = await call('get_page', { pageId });
    expect(read.text).toMatch(/::: columns\n<!-- block-[a-z0-9]+ -->\n\*\*Before\*\*\n\n::: column\n<!-- block-[a-z0-9]+ -->\n\*\*After\*\*\n:::/);
    expect((await alice.get(`/pages/${pageId}/markdown`)).body.markdown).toBe(markdown.replace('**Before**\n::: column', '**Before**\n\n::: column'));

    // A mistake in a section comes back as a message
    const broken = await call('insert_blocks', { pageId, markdown: '::: columns\nUnclosed' });
    expect(broken.isError).toBe(true);
    expect(broken.text).toMatch(/isn't closed/);
  });

  it('lists pages and workspaces, and finds pages by their text', async () => {
    const created = await call('create_page', { workspaceId, title: 'Glossary', markdown: 'A zettelkasten is a box of notes.' });
    const pageId = pageIdIn(created.text);
    expect((await call('list_workspaces')).text).toContain(`(${workspaceId})`);
    expect((await call('list_pages', { workspaceId })).text).toContain(`- Glossary (${pageId})`);
    // Page text is searchable once it's been stored
    await expect.poll(async () => (await call('search', { query: 'zettelkasten' })).text, { timeout: 15_000 }).toContain(`page ${pageId}`);
  });

  it('refuses to rewrite a page whole when Markdown would lose something, saying why', async () => {
    const created = await call('create_page', { workspaceId, title: 'Mixed' });
    const pageId = pageIdIn(created.text);
    const content = { type: 'doc', content: [{ type: 'databaseView', attrs: { id: 'block-1', pageId, title: 'Stock' } }] };
    await alice.put(`/pages/${pageId}/content`, { content });
    expect((await call('get_page', { pageId })).text).toContain('[Database view: Stock]');
    const revision = (await call('get_page', { pageId })).text.match(/Revision ([0-9a-f]+)/)?.[1];
    const refused = await call('replace_page', { pageId, markdown: 'Everything', revision });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/block by block/);
  });

  it('adds and changes database rows by column name, keeping the cells not given', async () => {
    const database = (await alice.post('/pages', { workspaceId, title: 'Stock', kind: 'DATABASE' })).body;
    await alice.post(`/pages/${database.id}/database/fields`, { name: 'Count', type: 'NUMBER' });
    await alice.post(`/pages/${database.id}/database/fields`, { name: 'Shelf', type: 'TEXT' });

    const added = await call('add_database_row', { pageId: database.id, cells: { Name: 'Bolts', Count: 40, Shelf: 'A2' } });
    expect(added.isError).toBe(false);
    const rowId = added.text.match(/row ([0-9a-f-]{36})/)?.[1] as string;
    await call('update_database_row', { pageId: database.id, rowId, cells: { count: 35 } });

    const read = await call('get_database', { pageId: database.id });
    expect(read.text).toContain('- Count (number)');
    const rows = JSON.parse(read.text.slice(read.text.indexOf('[')));
    expect(rows).toEqual([expect.objectContaining({ id: rowId, cells: { Name: 'Bolts', Count: 35, Shelf: 'A2' } })]);

    const unknown = await call('add_database_row', { pageId: database.id, cells: { Colour: 'red' } });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('No column "Colour"');
  });

  it("refuses database cells that don't fit their column, saying why, and changes nothing", async () => {
    const database = (await alice.post('/pages', { workspaceId, title: 'Orders', kind: 'DATABASE' })).body;
    await alice.post(`/pages/${database.id}/database/fields`, { name: 'Count', type: 'NUMBER' });
    await alice.post(`/pages/${database.id}/database/fields`, { name: 'Due', type: 'DATE' });
    await alice.post(`/pages/${database.id}/database/fields`, { name: 'Done', type: 'CHECKBOX' });
    await alice.post(`/pages/${database.id}/database/fields`, { name: 'Owner', type: 'PERSON' });
    await alice.post(`/pages/${database.id}/database/fields`, { name: 'Status', type: 'SELECT', options: { choices: [{ value: 'Open' }, { value: 'Shipped' }] } });

    const added = await call('add_database_row', { pageId: database.id, cells: { Name: 'Bolts', Count: 4, Due: '2026-12-01', Done: false, Status: 'open' } });
    expect(added.isError).toBe(false);
    const rowId = added.text.match(/row ([0-9a-f-]{36})/)?.[1] as string;
    const cells = async () => JSON.parse((await call('get_database', { pageId: database.id })).text.split('Rows (1):')[1])[0].cells;
    // A choice in another case is the choice
    expect(await cells()).toEqual({ Name: 'Bolts', Count: 4, Due: '2026-12-01', Done: false, Status: 'Open' });

    for (const [column, value, says] of [
      ['Status', 'Lost', /Status.*Open, Shipped/],
      ['Count', 'abc', /Count.*number/],
      ['Due', 'next tuesday', /Due.*YYYY-MM-DD/],
      ['Due', '03/04/2026', /Due.*YYYY-MM-DD/],
      ['Done', 'maybe', /Done.*true or false/],
      ['Owner', 'Somebody', /Owner/],
      ['Owner', '00000000-0000-4000-8000-000000000000', /Owner/],
    ] as const) {
      const refused = await call('update_database_row', { pageId: database.id, rowId, cells: { [column]: value } });
      expect(refused.isError, `${column}: ${value}`).toBe(true);
      expect(refused.text).toMatch(says);
    }
    const refusedAdd = await call('add_database_row', { pageId: database.id, cells: { Name: 'Nuts', Count: 'lots' } });
    expect(refusedAdd.isError).toBe(true);
    // Nothing changed, nothing added
    expect(await cells()).toEqual({ Name: 'Bolts', Count: 4, Due: '2026-12-01', Done: false, Status: 'Open' });
  });

  it('makes a database with its columns, and adds, renames, gives choices to and deletes columns', async () => {
    const created = await call('create_database', {
      workspaceId,
      title: 'Tracker',
      columns: [
        { name: 'Category', type: 'select', choices: ['Feature', 'Bug'] },
        { name: 'Done', type: 'checkbox' },
      ],
    });
    expect(created.isError).toBe(false);
    const pageId = created.text.match(/Database ([0-9a-f-]{36})/)?.[1] as string;
    const columns = async () => (await call('get_database', { pageId })).text.split('Rows')[0];
    expect(await columns()).toContain('- Category (select: Feature, Bug)');
    expect(await columns()).toContain('- Done (checkbox)');

    // A column added; choices added to one (a choice there already, in another case, isn't twice)
    expect((await call('add_database_column', { pageId, name: 'Area', type: 'multi_select', choices: ['Editor'] })).isError).toBe(false);
    expect((await call('update_database_column', { pageId, column: 'category', addChoices: ['Question', 'bug'] })).isError).toBe(false);
    expect(await columns()).toContain('- Category (select: Feature, Bug, Question)');
    // Renamed, and rows written by the new name
    expect((await call('update_database_column', { pageId, column: 'Area', name: 'Areas' })).isError).toBe(false);
    const added = await call('add_database_row', { pageId, cells: { Name: 'Links', Category: 'Question', Areas: ['Editor'], Done: true } });
    expect(added.isError).toBe(false);

    // Deleting needs confirm, and never the title column
    const unconfirmed = await call('delete_database_column', { pageId, column: 'Done' });
    expect(unconfirmed.isError).toBe(true);
    expect(unconfirmed.text).toMatch(/confirm/);
    expect((await call('delete_database_column', { pageId, column: 'Done', confirm: true })).isError).toBe(false);
    const title = await call('delete_database_column', { pageId, column: 'Name', confirm: true });
    expect(title.isError).toBe(true);
    expect(title.text).toMatch(/title/i);
    const read = await call('get_database', { pageId });
    expect(read.text).not.toContain('- Done (checkbox)');
    expect(JSON.parse(read.text.split('Rows (1):')[1])[0].cells).toEqual({ Name: 'Links', Category: 'Question', Areas: ['Editor'] });
  });

  it("refuses a column it couldn't use: a name taken, a type it doesn't know, choices for a column that has none", async () => {
    const pageId = (await call('create_database', { workspaceId, title: 'Refusals' })).text.match(/Database ([0-9a-f-]{36})/)?.[1] as string;
    for (const [args, says] of [
      [{ name: 'name', type: 'text' }, /already/],
      [{ name: 'Link', type: 'formula' }, /type/],
      [{ name: 'Notes', type: 'text', choices: ['A'] }, /choices/],
    ] as const) {
      const refused = await call('add_database_column', { pageId, ...args });
      expect(refused.isError, JSON.stringify(args)).toBe(true);
      expect(refused.text).toMatch(says);
    }
    expect((await call('update_database_column', { pageId, column: 'Nope', name: 'X' })).text).toMatch(/No column "Nope"/);
    // The app's own spelling of a type is taken
    expect((await call('add_database_column', { pageId, name: 'Tags', type: 'Multi-select', choices: ['A'] })).isError).toBe(false);
    expect((await call('add_database_column', { pageId, name: 'More tags', type: 'multiselect' })).isError).toBe(false);

    // A bad column refuses the whole database: none is made
    const title = `Half built ${Date.now()}`;
    const refused = await call('create_database', { workspaceId, title, columns: [{ name: 'Fine', type: 'text' }, { name: 'Link', type: 'formula' }] });
    expect(refused.isError).toBe(true);
    const toNothing = await call('create_database', { workspaceId, title, columns: [{ name: 'Link', type: 'relation', relatesTo: '00000000-0000-4000-8000-000000000000' }] });
    expect(toNothing.isError).toBe(true);
    expect(toNothing.text).toMatch(/No database/);
    expect((await call('list_pages', { workspaceId })).text).not.toContain(title);
  });

  it('makes a relation column, to the rows of another database', async () => {
    const dbId = (text: string) => text.match(/Database ([0-9a-f-]{36})/)?.[1] as string;
    const people = dbId((await call('create_database', { workspaceId, title: 'People' })).text);
    const tasks = dbId((await call('create_database', { workspaceId, title: 'Tasks' })).text);
    const ada = (await call('add_database_row', { pageId: people, cells: { Name: 'Ada' } })).text.match(/row ([0-9a-f-]{36})/)?.[1];

    expect((await call('add_database_column', { pageId: tasks, name: 'Owner', type: 'relation', relatesTo: people })).isError).toBe(false);
    const written = await call('add_database_row', { pageId: tasks, cells: { Name: 'Write', Owner: [ada] } });
    expect(written.isError, written.text).toBe(false);
    const read = await call('get_database', { pageId: tasks });
    expect(read.text).toContain(`- Owner (relation: to database ${people})`);
    // A relation with no allowMultiple (as the app has made them) holds several
    expect((await call('add_database_column', { pageId: tasks, name: 'Helpers', type: 'relation', relatesTo: people, multiple: true })).isError).toBe(false);
    expect((await call('get_database', { pageId: tasks })).text).toContain(`- Helpers (relation: to database ${people}, several rows)`);
    expect(JSON.parse(read.text.split('Rows (1):')[1])[0].cells.Owner).toEqual({ id: ada, label: 'Ada' });

    // Not without a database to link to, nor to a page that isn't one, nor a relation's options on another type
    const doc = (await call('create_page', { workspaceId, title: 'Just a page' })).text.match(/Page ([0-9a-f-]{36})/)?.[1];
    for (const [args, says] of [
      [{ name: 'Lead', type: 'relation' }, /relatesTo/],
      [{ name: 'Lead', type: 'relation', relatesTo: doc }, /not found/i],
      [{ name: 'Lead', type: 'text', relatesTo: people }, /relation/],
    ] as const) {
      const refused = await call('add_database_column', { pageId: tasks, ...args });
      expect(refused.isError, JSON.stringify(args)).toBe(true);
      expect(refused.text).toMatch(says);
    }
  });

  it("changes a column's type and renames or removes choices, the cells following", async () => {
    const pageId = (await call('create_database', {
      workspaceId,
      title: 'Changes',
      columns: [{ name: 'Amount', type: 'text' }, { name: 'Status', type: 'select', choices: ['Open', 'Done', 'Later'] }],
    })).text.match(/Database ([0-9a-f-]{36})/)?.[1] as string;
    await call('add_database_row', { pageId, cells: { Name: 'A', Amount: '12', Status: 'Open' } });
    await call('add_database_row', { pageId, cells: { Name: 'B', Amount: 'about ten', Status: 'Done' } });
    const cells = async () => JSON.parse((await call('get_database', { pageId })).text.split(/Rows \(\d+\):/)[1]).map((row: any) => row.cells);

    const typed = await call('update_database_column', { pageId, column: 'Amount', type: 'number' });
    expect(typed.isError, typed.text).toBe(false);
    expect(typed.text).toMatch(/1 kept aside/);
    expect((await cells()).map((c: any) => c.Amount)).toEqual([12, undefined]);

    const choices = await call('update_database_column', { pageId, column: 'Status', renameChoices: { Open: 'In progress' }, removeChoices: ['Done'], addChoices: ['Blocked'] });
    expect(choices.isError, choices.text).toBe(false);
    expect((await call('get_database', { pageId })).text).toContain('- Status (select: In progress, Later, Blocked)');
    expect((await cells()).map((c: any) => c.Status)).toEqual(['In progress', undefined]);

    // A choice that isn't there, or a name another has, is refused before anything changes
    for (const [args, says] of [
      [{ renameChoices: { Nope: 'X' } }, /No choice "Nope"/],
      [{ renameChoices: { Later: 'blocked' } }, /already/],
      [{ removeChoices: ['Nope'] }, /No choice "Nope"/],
      // A removed choice's name isn't free: its cells would quietly become the renamed one's
      [{ removeChoices: ['Later'], renameChoices: { Blocked: 'Later' } }, /already/],
      [{ relatesTo: pageId }, /relatesTo/],
    ] as const) {
      const refused = await call('update_database_column', { pageId, column: 'Status', ...args });
      expect(refused.isError, JSON.stringify(args)).toBe(true);
      expect(refused.text).toMatch(says);
    }
    expect((await call('update_database_column', { pageId, column: 'Name', type: 'number' })).isError).toBe(true);
  });

  it('makes, changes and deletes views: filtered, sorted, grouped, with columns hidden', async () => {
    const pageId = (await call('create_database', {
      workspaceId,
      title: 'Tracker with views',
      columns: [
        { name: 'Status', type: 'select', choices: ['To do', 'Done'] },
        { name: 'Later', type: 'checkbox' },
        { name: 'Notes', type: 'text' },
      ],
    })).text.match(/Database ([0-9a-f-]{36})/)?.[1] as string;

    const made = await call('create_database_view', {
      pageId,
      name: 'Open',
      filters: [{ column: 'status', operator: 'is_not', value: 'Done' }, { column: 'Later', operator: 'is_unchecked' }],
      sorts: [{ column: 'Name' }, { column: 'Status', direction: 'desc' }],
      hide: ['Notes'],
    });
    expect(made.isError, made.text).toBe(false);
    expect((await call('create_database_view', { pageId, name: 'Board', type: 'board', groupBy: 'Status' })).isError).toBe(false);

    const views = async () => (await call('get_database', { pageId })).text;
    let text = await views();
    expect(text).toContain('- Open (table): rows where Status is not "Done" and Later is unchecked; sorted by Name, Status (descending); hiding Notes');
    expect(text).toContain('- Board (board): grouped by Status');
    // A new board without groupBy is grouped by the first select, as in the app; a table isn't
    expect((await call('create_database_view', { pageId, name: 'Board 2', type: 'board' })).isError).toBe(false);
    expect(await views()).toContain('- Board 2 (board): grouped by Status');
    expect((await call('update_database_view', { pageId, view: 'Board 2', type: 'table' })).isError).toBe(false);
    expect(await views()).toContain('- Board 2 (table)\n');
    // and made a board again, grouped again
    expect((await call('update_database_view', { pageId, view: 'Board 2', type: 'board' })).isError).toBe(false);
    expect(await views()).toContain('- Board 2 (board): grouped by Status');

    // What isn't given stays as it was
    const changed = await call('update_database_view', { pageId, view: 'open', name: 'Open work', match: 'any', hide: [] });
    expect(changed.isError, changed.text).toBe(false);
    text = await views();
    expect(text).toContain('- Open work (table): rows where Status is not "Done" or Later is unchecked; sorted by Name, Status (descending)');
    expect(text).not.toContain('hiding Notes');

    expect((await call('delete_database_view', { pageId, view: 'Board' })).isError).toBe(false);
    expect(await views()).not.toContain('- Board (board)');
  });

  it("refuses a view it couldn't show: an operator its column hasn't, a value missing, a choice that isn't, grouping by text", async () => {
    const pageId = (await call('create_database', {
      workspaceId,
      title: 'View refusals',
      columns: [
        { name: 'Status', type: 'select', choices: ['To do', 'Done'] },
        { name: 'Notes', type: 'text' },
        { name: 'Tags', type: 'multi_select', choices: ['A'] },
        { name: 'Points', type: 'number' },
        { name: 'Due', type: 'date' },
      ],
    })).text.match(/Database ([0-9a-f-]{36})/)?.[1] as string;
    for (const [args, says] of [
      [{ type: 'board', groupBy: 'Tags' }, /select/],
      [{ filters: [{ column: 'Points', operator: 'gt', value: 'ten' }] }, /number/],
      [{ filters: [{ column: 'Due', operator: 'before', value: 'next friday' }] }, /date/],
      [{ filters: [{ column: 'Status', operator: 'gt', value: '1' }] }, /Status.*is, is_not/],
      [{ filters: [{ column: 'Notes', operator: 'contains' }] }, /value/],
      [{ filters: [{ column: 'Status', operator: 'is', value: 'Doing' }] }, /No choice "Doing"/],
      [{ filters: [{ column: 'Nope', operator: 'is_empty' }] }, /No column "Nope"/],
      [{ type: 'board', groupBy: 'Notes' }, /select/],
      [{ type: 'table', groupBy: 'Status' }, /board/],
      [{ type: 'calendar' }, /table, board, gallery, list/],
    ] as const) {
      const refused = await call('create_database_view', { pageId, name: 'X', ...args });
      expect(refused.isError, JSON.stringify(args)).toBe(true);
      expect(refused.text).toMatch(says);
    }
    expect((await call('update_database_view', { pageId, view: 'Nope', name: 'Y' })).text).toMatch(/No view "Nope"/);
  });
});
