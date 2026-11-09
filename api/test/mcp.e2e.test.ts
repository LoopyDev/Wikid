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
const blockIds = (text: string) => [...text.matchAll(/<!-- (block-\d+)/g)].map((m) => m[1]);
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
      'add_database_row', 'add_image', 'create_page', 'delete_block', 'get_database', 'get_page', 'insert_blocks',
      'list_pages', 'list_workspaces', 'rename_page', 'replace_page', 'search', 'update_block', 'update_database_row',
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
    expect(read.text).toMatch(/::: columns\n<!-- block-\d+ -->\n\*\*Before\*\*\n\n::: column\n<!-- block-\d+ -->\n\*\*After\*\*\n:::/);
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
    const refused = await call('replace_page', { pageId, markdown: 'Everything' });
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
});
