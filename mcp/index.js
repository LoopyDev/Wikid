#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Wikid's MCP server: lets an AI tool (Claude Code, say) search, read and write pages and database
// rows, as the user it logs in as. Pages are read and changed as Markdown, block by block, so what
// Markdown can't hold (columns, database views) is left as it is. See README.md here.

const API_BASE = (process.env.WIKID_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const EMAIL = process.env.WIKID_EMAIL || '';
const PASSWORD = process.env.WIKID_PASSWORD || '';

if (!EMAIL || !PASSWORD) {
  process.stderr.write('Warning: WIKID_EMAIL / WIKID_PASSWORD not set. API calls will fail.\n');
}

let sessionCookie = '';

async function login() {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Wikid login failed: ${await errorMessage(res)}`);
  sessionCookie = (res.headers.get('set-cookie') || '').split(';')[0];
}

async function errorMessage(res) {
  const text = await res.text();
  try {
    const message = JSON.parse(text).message;
    return Array.isArray(message) ? message.join('; ') : message || text || res.statusText;
  } catch {
    return text || res.statusText;
  }
}

async function api(path, { method = 'GET', body } = {}, retried = false) {
  if (!sessionCookie) await login();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // The session ran out: log in again, once
  if (res.status === 401 && !retried) {
    sessionCookie = '';
    return api(path, { method, body }, true);
  }
  if (!res.ok) throw new Error(`${await errorMessage(res)} (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const text = (value) => ({ content: [{ type: 'text', text: value }] });

/** A tool that reports a failure as an error the AI can read, rather than crashing the call. */
function tool(name, description, schema, run) {
  server.tool(name, description, schema, async (args) => {
    try {
      return text(await run(args));
    } catch (err) {
      return { isError: true, ...text(err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---- Pages as text ----

/** A page as Markdown, each block marked with its id and where it is, to change one at a time. */
function formatPage(page) {
  const lines = [
    `# ${page.title || 'Untitled page'}`,
    '',
    `Page ${page.id}. Each block below is marked with its id: rewrite one with update_block, add blocks with insert_blocks, remove one with delete_block.`,
    '',
  ];
  for (const block of page.blocks) {
    const where = [block.column ? `in column ${block.column}` : null, block.parentId ? `inside ${block.parentId}` : null].filter(Boolean);
    const notes = block.embed ? ["no Markdown form: can be deleted, not rewritten"] : block.exact ? [] : ['rewriting it loses formatting Markdown can’t hold'];
    lines.push(`<!-- ${[block.id ?? 'no id', ...where, ...notes].join(' · ')} -->`, block.markdown || '(empty)', '');
  }
  return lines.join('\n').trimEnd();
}

const getPage = (pageId) => api(`/pages/${pageId}/markdown`);

function pageTree(pages) {
  const listed = new Set(pages.map((p) => p.id));
  // Top level: no parent, or one not in the list (private to someone else, say)
  const parentOf = (page) => (page.parentId && listed.has(page.parentId) ? page.parentId : null);
  const lines = [];
  const walk = (parentId, depth) => {
    const list = pages.filter((p) => parentOf(p) === parentId).sort((a, b) => Number(a.position) - Number(b.position));
    for (const page of list) {
      const icon = page.icon && !String(page.icon).startsWith('icon:') ? `${page.icon} ` : '';
      const kind = page.kind === 'DATABASE' ? ' · database' : '';
      lines.push(`${'  '.repeat(depth)}- ${icon}${page.title || 'Untitled'} (${page.id})${kind}`);
      walk(page.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join('\n') || 'No pages.';
}

// ---- Databases ----

/** A database's columns and rows, cells by column name. */
async function getDatabase(pageId) {
  const db = await api(`/pages/${pageId}/database`);
  const fields = db.fields ?? [];
  const rows = (db.rows ?? []).map((row) => {
    const cells = {};
    for (const field of fields) {
      const value = row.data?.[field.id];
      if (value !== undefined && value !== null && value !== '') cells[field.name] = value;
    }
    return { id: row.id, ...(row.pageId ? { pageId: row.pageId } : {}), cells };
  });
  return { db, fields, rows };
}

/** Cell values by column name (or id) as the row data the API takes, by column id. */
function cellsById(fields, values) {
  const data = {};
  for (const [key, value] of Object.entries(values)) {
    const field = fields.find((f) => f.id === key) ?? fields.find((f) => f.name.toLowerCase() === key.toLowerCase());
    if (!field) throw new Error(`No column "${key}". Columns: ${fields.map((f) => f.name).join(', ')}`);
    data[field.id] = value;
  }
  return data;
}

function formatDatabase({ db, fields, rows }) {
  const columns = fields.map((f) => {
    const choices = (f.options?.choices ?? []).map((c) => (typeof c === 'string' ? c : c.value)).filter(Boolean);
    return `- ${f.name} (${f.type.toLowerCase()}${choices.length ? `: ${choices.join(', ')}` : ''})`;
  });
  return [`# ${db.title || 'Untitled database'}`, '', 'Columns:', ...columns, '', `Rows (${rows.length}):`, JSON.stringify(rows, null, 2)].join('\n');
}

// ---- Tools ----

const server = new McpServer({ name: 'wikid', version: '2.0.0' });

tool('list_workspaces', 'List the Wikid workspaces you can see, with their ids.', {}, async () => {
  const memberships = await api('/workspaces');
  return memberships.map((m) => `- ${m.workspace?.name ?? m.name} (${m.workspace?.id ?? m.id}) · ${String(m.role ?? '').toLowerCase()}`).join('\n') || 'No workspaces.';
});

tool('list_pages', 'List the pages in a workspace as a tree, with their ids. Pages marked "database" are databases: use get_database.', { workspaceId: z.string().describe('Workspace id') }, async ({ workspaceId }) =>
  pageTree(await api(`/pages?workspaceId=${encodeURIComponent(workspaceId)}`)),
);

tool(
  'search',
  'Search page titles, page text and database rows you can see, across workspaces.',
  { query: z.string().describe('Words to look for'), limit: z.number().int().min(1).max(50).optional().describe('At most this many results (default 20)') },
  async ({ query, limit }) => {
    const { results } = await api(`/search?q=${encodeURIComponent(query)}${limit ? `&limit=${limit}` : ''}`);
    if (!results.length) return 'Nothing found.';
    return results
      .map((r) => {
        const what = r.type === 'row' ? `row in ${r.databaseTitle}` : 'page';
        const snippet = r.snippet ? `\n  ${r.snippet.replace(/\[\[\[|\]\]\]/g, '**')}` : '';
        return `- ${r.title} (${what}; page ${r.pageId}; workspace ${r.workspaceName})${snippet}`;
      })
      .join('\n');
  },
);

tool('get_page', 'Read a page as Markdown, each block marked with its id. For a database page, use get_database.', { pageId: z.string().describe('Page id') }, async ({ pageId }) =>
  formatPage(await getPage(pageId)),
);

tool(
  'create_page',
  'Create a page, with content written as Markdown. Headings, lists, to-dos, code, tables, quotes and images are kept; a quote starting with an emoji ("> 💡 …") becomes a callout.',
  {
    workspaceId: z.string().describe('Workspace id'),
    title: z.string().describe('Page title'),
    markdown: z.string().optional().describe('The page content, as Markdown'),
    parentId: z.string().optional().describe('Put it under this page (default: the top of the workspace)'),
  },
  async ({ workspaceId, title, markdown, parentId }) => {
    const page = await api('/pages', { method: 'POST', body: { workspaceId, title, parentId, kind: 'DOC', setupStatus: 'COMPLETE' } });
    const written = markdown ? await api(`/pages/${page.id}/markdown`, { method: 'PUT', body: { markdown } }) : await getPage(page.id);
    return `Created.\n\n${formatPage(written)}`;
  },
);

tool(
  'insert_blocks',
  'Add blocks, written as Markdown, to a page: after or before a block (by id), or at the end.',
  {
    pageId: z.string().describe('Page id'),
    markdown: z.string().describe('The blocks to add, as Markdown'),
    afterId: z.string().optional().describe('Add them after this block'),
    beforeId: z.string().optional().describe('Add them before this block'),
  },
  async ({ pageId, markdown, afterId, beforeId }) =>
    formatPage(await api(`/pages/${pageId}/markdown/blocks`, { method: 'POST', body: { markdown, afterId, beforeId } })),
);

tool(
  'update_block',
  'Rewrite one block of a page (by id) from Markdown; it can become several blocks. A list or table is rewritten whole. Blocks with no Markdown form (database views and the like) can’t be rewritten.',
  { pageId: z.string().describe('Page id'), blockId: z.string().describe('Block id, from get_page'), markdown: z.string().describe('The block’s new content, as Markdown') },
  async ({ pageId, blockId, markdown }) =>
    formatPage(await api(`/pages/${pageId}/markdown/blocks/${encodeURIComponent(blockId)}`, { method: 'PUT', body: { markdown } })),
);

tool('delete_block', 'Delete one block of a page (by id).', { pageId: z.string().describe('Page id'), blockId: z.string().describe('Block id, from get_page') }, async ({ pageId, blockId }) =>
  formatPage(await api(`/pages/${pageId}/markdown/blocks/${encodeURIComponent(blockId)}`, { method: 'DELETE' })),
);

tool(
  'replace_page',
  'Rewrite a whole page from Markdown. Refused when the page has blocks Markdown can’t hold (columns, database views, colours, image sizes): change it block by block then.',
  { pageId: z.string().describe('Page id'), markdown: z.string().describe('The whole page, as Markdown') },
  async ({ pageId, markdown }) => formatPage(await api(`/pages/${pageId}/markdown`, { method: 'PUT', body: { markdown } })),
);

tool('rename_page', 'Rename a page.', { pageId: z.string().describe('Page id'), title: z.string().describe('New title') }, async ({ pageId, title }) => {
  await api(`/pages/${pageId}`, { method: 'PATCH', body: { title } });
  return `Renamed to "${title}".`;
});

tool('get_database', 'Read a database: its columns (with a select’s choices) and its rows, cells by column name.', { pageId: z.string().describe('Page id of the database') }, async ({ pageId }) =>
  formatDatabase(await getDatabase(pageId)),
);

tool(
  'add_database_row',
  'Add a row to a database. Cells by column name: text, a number, a date (YYYY-MM-DD), true/false for a checkbox, a choice for a select, a list of choices for a multi-select.',
  { pageId: z.string().describe('Page id of the database'), cells: z.record(z.string(), z.unknown()).describe('Cell values by column name') },
  async ({ pageId, cells }) => {
    const { fields } = await getDatabase(pageId);
    const row = await api(`/pages/${pageId}/database/rows`, { method: 'POST', body: { data: cellsById(fields, cells) } });
    return `Added row ${row.id}.`;
  },
);

tool(
  'update_database_row',
  'Change cells of a database row (by id); cells not given stay as they are. Cells by column name, as for add_database_row.',
  { pageId: z.string().describe('Page id of the database'), rowId: z.string().describe('Row id, from get_database'), cells: z.record(z.string(), z.unknown()).describe('Cell values by column name') },
  async ({ pageId, rowId, cells }) => {
    const { db, fields } = await getDatabase(pageId);
    const row = (db.rows ?? []).find((r) => r.id === rowId);
    if (!row) throw new Error(`No row ${rowId} in this database`);
    // The API takes the row's cells whole, so the change goes onto what's there
    await api(`/database-rows/${rowId}`, { method: 'PATCH', body: { data: { ...(row.data ?? {}), ...cellsById(fields, cells) } } });
    return `Updated row ${rowId}.`;
  },
);

await server.connect(new StdioServerTransport());
