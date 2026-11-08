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
      'add_database_row', 'create_page', 'delete_block', 'get_database', 'get_page', 'insert_blocks',
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
