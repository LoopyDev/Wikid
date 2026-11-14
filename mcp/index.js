#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Wikid's MCP server: lets an AI tool (Claude Code, say) search, read and write pages and database
// rows, as the user it logs in as. Pages are read and changed as Markdown, block by block, so what
// Markdown can't hold (database views, colours) is left as it is; columns and toggles are written as
// "::: columns" and "::: toggle" sections. See README.md here.

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

// A JSON body, or `form` (FormData) for a file upload
async function api(path, { method = 'GET', body, form } = {}, retried = false) {
  if (!sessionCookie) await login();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: form ? { Cookie: sessionCookie } : { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  // The session ran out: log in again, once
  if (res.status === 401 && !retried) {
    sessionCookie = '';
    return api(path, { method, body, form }, true);
  }
  if (!res.ok) throw new Error(`${await errorMessage(res)} (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const text = (value) => ({ content: [{ type: 'text', text: value }] });

// Ids go into API addresses, so only real ids: anything else (a path like "../workspaces/…") could
// reach another part of the API
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`Not a valid id: ${JSON.stringify(value)}`);
  return value;
}

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

// Columns and toggles, which Markdown has no way to write, as Wikid reads and writes them
const SECTIONS =
  'Columns: "::: columns", the first column\'s Markdown, "::: column" before each further column, then ":::". ' +
  'A toggle (a heading that opens to show more): "::: toggle", a heading, what it opens to, then ":::". ' +
  'A quote starting with an emoji ("> 💡 …") is a callout. ' +
  'A link to another page: [words](/doc/<page id>); a mention of one, shown with its icon and title as they are now: [@Title](/doc/<page id>).';

/** A page as Markdown, each block marked with its id, to change one at a time. */
function formatPage(page) {
  return [
    `# ${page.title || 'Untitled page'}`,
    '',
    `Page ${page.id}. Each block is preceded by a comment with its id: rewrite one with update_block, add blocks with insert_blocks, remove one with delete_block. ${SECTIONS}`,
    `Revision ${page.revision} (give it to replace_page).`,
    '',
    page.annotated || '(empty page)',
  ].join('\n');
}

const getPage = (pageId) => api(`/pages/${id(pageId)}/markdown`);

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

// ---- Images ----

const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
};

/**
 * Uploads an image to a page, from a file on this computer or a web address (fetched by Wikid's
 * server, which takes public addresses only). Answers the address to show it at.
 */
async function uploadImage(pageId, { file, url }) {
  if (url) return (await api('/uploads/by-url', { method: 'POST', body: { url, pageId } })).file.url;
  const type = IMAGE_TYPES[extname(file).toLowerCase()];
  if (!type) throw new Error(`Not an image Wikid takes: ${basename(file)} (${Object.keys(IMAGE_TYPES).join(', ')})`);
  let data;
  try {
    data = await readFile(file);
  } catch (err) {
    throw new Error(`Can't read ${file}: ${err.code === 'ENOENT' ? 'no such file' : err.message}`);
  }
  const form = new FormData();
  form.append('image', new Blob([data], { type }), basename(file));
  form.append('pageId', pageId);
  return (await api('/uploads', { method: 'POST', form })).file.url;
}

/** Markdown for an image: brackets and backslashes in its text escaped, an address with spaces in <>. */
function imageMarkdown(src, alt) {
  const text = (alt || '').replace(/\\/g, '\\\\').replace(/[[\]]/g, '\\$&');
  return `![${text}](${/[\s()]/.test(src) ? `<${src}>` : src})`;
}

// ---- Databases ----

/** A database's columns and rows, cells by column name. */
async function getDatabase(pageId) {
  const db = await api(`/pages/${id(pageId)}/database`);
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
    data[findColumn(fields, key).id] = value;
  }
  return data;
}

const choiceValue = (choice) => (typeof choice === 'string' ? choice : choice?.value);

// The colours a choice can be given by name (the app's colours for rows and icons: ROW_COLORS in
// web/src/utils/database/colors.js), or any #rrggbb
const COLOURS = { sky: '#0ea5e9', green: '#22c55e', yellow: '#eab308', orange: '#f97316', red: '#ef4444', purple: '#a855f7', indigo: '#6366f1', teal: '#14b8a6', slate: '#94a3b8' };
/** A colour given (a name, #rrggbb, or null for none) as the app keeps it. */
function colourValue(colour) {
  if (colour === null || colour === undefined || colour === '') return null;
  const given = String(colour).trim().toLowerCase();
  if (COLOURS[given]) return COLOURS[given];
  if (/^#[0-9a-f]{6}$/.test(given)) return given;
  throw new Error(`Not a colour: "${colour}". Colours: ${Object.keys(COLOURS).join(', ')}, or #rrggbb`);
}
/** A colour by its name, if it has one. */
const colourName = (colour) => Object.keys(COLOURS).find((name) => COLOURS[name] === String(colour).toLowerCase()) ?? colour;
const choiceText = (choice) => {
  const value = choiceValue(choice);
  return typeof choice === 'object' && choice?.color ? `${value} (${colourName(choice.color)})` : value;
};

function formatDatabase({ db, fields, rows }) {
  const columns = fields.map((f) => {
    const choices = (f.options?.choices ?? []).filter((c) => choiceValue(c)).map(choiceText);
    const relation = f.options?.relation?.pageId ? `: to database ${f.options.relation.pageId}${f.options.relation.allowMultiple === true ? ', several rows' : ''}` : '';
    return `- ${f.name} (${f.type.toLowerCase()}${choices.length ? `: ${choices.join(', ')}` : relation})`;
  });
  const views = (db.views ?? []).map((view) => formatView(view, fields));
  return [
    `# ${db.title || 'Untitled database'}`,
    '',
    'Columns:',
    ...columns,
    ...(views.length ? ['', 'Views:', ...views] : []),
    '',
    `Rows (${rows.length}):`,
    JSON.stringify(rows, null, 2),
  ].join('\n');
}

// ---- Database views ----

const VIEW_TYPES = ['table', 'board', 'gallery', 'list'];
const NO_VALUE = new Set(['is_empty', 'is_not_empty', 'is_checked', 'is_unchecked', 'is_me', 'is_not_me']);
// The filters each type of column has, as the app offers them (operatorsForFieldType in
// web/src/utils/database/views.js)
const OPERATORS = {
  'text, url': ['is', 'is_not', 'contains', 'not_contains', 'is_empty', 'is_not_empty'],
  number: ['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  date: ['is', 'is_not', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty'],
  select: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  'multi_select, relation': ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  person: ['is_me', 'is_not_me', 'contains', 'not_contains', 'is_empty', 'is_not_empty'],
  checkbox: ['is_checked', 'is_unchecked'],
};
const operatorsFor = (type) => {
  const kind = String(type).toLowerCase();
  const key = Object.keys(OPERATORS).find((types) => types.split(', ').includes(kind));
  return OPERATORS[key ?? 'text, url'];
};
const OPERATOR_WORDS = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  not_contains: "doesn't contain",
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  before: 'is before',
  after: 'is after',
  on_or_before: 'is on or before',
  on_or_after: 'is on or after',
  is_checked: 'is checked',
  is_unchecked: 'is unchecked',
  is_me: 'is me',
  is_not_me: "isn't me",
};

/** A view in a line: its type, then what it shows and how. */
function formatView(view, fields) {
  const config = view.config ?? {};
  const nameOf = (fieldId) => fields.find((f) => f.id === fieldId)?.name ?? fieldId;
  const parts = [];
  // A rule still waiting for its value (just added in the app) filters nothing
  const rules = (config.filters?.rules ?? []).filter((r) => NO_VALUE.has(r.operator) || String(r.value ?? '').trim() !== '');
  if (rules.length) {
    const join = config.filters.match === 'OR' ? ' or ' : ' and ';
    const rule = (r) => `${nameOf(r.fieldId)} ${OPERATOR_WORDS[r.operator] ?? r.operator}${NO_VALUE.has(r.operator) ? '' : ` ${JSON.stringify(r.value)}`}`;
    parts.push(`rows where ${rules.map(rule).join(join)}`);
  }
  if (config.sorts?.length) parts.push(`sorted by ${config.sorts.map((sort) => `${nameOf(sort.fieldId)}${sort.direction === 'desc' ? ' (descending)' : ''}`).join(', ')}`);
  if (config.groupFieldId) parts.push(`grouped by ${nameOf(config.groupFieldId)}`);
  if (config.cardColorFieldId) parts.push(`cards coloured by ${nameOf(config.cardColorFieldId)}`);
  if (config.hiddenFieldIds?.length) parts.push(`hiding ${config.hiddenFieldIds.map(nameOf).join(', ')}`);
  return `- ${view.name} (${String(view.type).toLowerCase()})${parts.length ? `: ${parts.join('; ')}` : ''}`;
}

function findView(db, view) {
  const views = db.views ?? [];
  const found = views.find((v) => v.id === view) ?? views.find((v) => sameName(v.name, view));
  if (!found) throw new Error(`No view "${view}". Views: ${views.map((v) => v.name).join(', ') || 'none'}`);
  return found;
}

/** A filter as the API keeps it, refused if its column can't be filtered that way. */
function viewFilter(fields, { column, operator, value }) {
  const field = findColumn(fields, column);
  const operators = operatorsFor(field.type);
  if (!operators.includes(operator)) throw new Error(`A ${field.type.toLowerCase()} column like "${field.name}" can be filtered by: ${operators.join(', ')}`);
  if (NO_VALUE.has(operator)) return { fieldId: field.id, operator, value: null };
  if (value === undefined || value === null || String(value).trim() === '') throw new Error(`Filtering "${field.name}" by ${operator} needs a value`);
  let given = typeof value === 'number' ? value : String(value).trim();
  if (field.type === 'NUMBER' && !Number.isFinite(Number(given))) throw new Error(`Filtering "${field.name}" needs a number, not "${given}"`);
  if (field.type === 'DATE' && !/^\d{4}-\d{2}-\d{2}/.test(String(given))) throw new Error(`Filtering "${field.name}" needs a date (YYYY-MM-DD), not "${given}"`);
  if (HAS_CHOICES.has(field.type.toLowerCase())) {
    const choices = (field.options?.choices ?? []).map(choiceValue).filter(Boolean);
    const choice = choices.find((c) => sameName(c, String(given)));
    if (!choice) throw new Error(`No choice "${given}" in "${field.name}". Choices: ${choices.join(', ') || 'none'}`);
    given = choice;
  }
  return { fieldId: field.id, operator, value: given };
}

/** A view's type and settings as the API takes them, from those given (others left as they are). */
function viewBody(fields, view, { name, type, filters, match, sorts, groupBy, colourBy, hide }) {
  const body = {};
  if (name !== undefined) {
    if (!name.trim()) throw new Error('Give the view a name');
    body.name = name.trim();
  }
  const kind = type === undefined ? String(view?.type ?? 'TABLE').toLowerCase() : String(type).trim().toLowerCase();
  if (!VIEW_TYPES.includes(kind)) throw new Error(`Not a view type: "${type}". Types: ${VIEW_TYPES.join(', ')}`);
  if (type !== undefined) body.type = kind.toUpperCase();
  const config = { ...(view?.config ?? {}) };
  if (filters !== undefined) config.filters = { match: config.filters?.match ?? 'AND', rules: filters.map((filter) => viewFilter(fields, filter)) };
  if (match !== undefined) config.filters = { rules: [], ...config.filters, match: match === 'any' ? 'OR' : 'AND' };
  if (sorts !== undefined) config.sorts = sorts.map(({ column, direction }) => ({ fieldId: findColumn(fields, column).id, direction: direction === 'desc' ? 'desc' : 'asc' }));
  if (hide !== undefined) config.hiddenFieldIds = hide.map((column) => findColumn(fields, column).id);
  if (groupBy !== undefined && groupBy !== null && groupBy !== '') {
    const field = findColumn(fields, groupBy);
    if (field.type !== 'SELECT') throw new Error(`A board is grouped by a select column's choices; "${field.name}" is ${field.type.toLowerCase()}`);
    if (kind !== 'board') throw new Error('Only a board is grouped: give type board');
    config.groupFieldId = field.id;
  } else if (groupBy !== undefined || (type !== undefined && kind !== 'board')) {
    config.groupFieldId = null;
  } else if (kind === 'board' && (!view || (type !== undefined && !config.groupFieldId))) {
    // A board new, or just made one, as in the app: grouped by the first select
    config.groupFieldId = fields.find((f) => f.type === 'SELECT')?.id ?? null;
  }
  const hasCards = kind === 'board' || kind === 'gallery';
  if (colourBy !== undefined && colourBy !== null && colourBy !== '' && !hasCards) throw new Error("Only a board's or gallery's cards are coloured: give type board or gallery");
  if (colourBy === undefined && type !== undefined && !hasCards && config.cardColorFieldId) config.cardColorFieldId = null;
  if (colourBy !== undefined) {
    if (colourBy === null || colourBy === '') config.cardColorFieldId = null;
    else {
      const field = findColumn(fields, colourBy);
      if (!HAS_CHOICES.has(field.type.toLowerCase())) throw new Error(`Cards are coloured by a select or multi_select column's choices; "${field.name}" is ${field.type.toLowerCase()}`);
      config.cardColorFieldId = field.id;
    }
  }
  if ([filters, match, sorts, hide, groupBy, colourBy, type].some((part) => part !== undefined)) body.config = config;
  return body;
}

const viewSchema = {
  type: z.string().optional().describe(`View type: ${VIEW_TYPES.join(', ')} (default table)`),
  filters: z
    .array(z.object({ column: z.string(), operator: z.string(), value: z.union([z.string(), z.number()]).optional() }))
    .optional()
    .describe(
      `Rows shown: each a column, an operator and (for most) a value: a choice for a select, a number, a date (YYYY-MM-DD). Operators by column type: ${Object.entries(OPERATORS)
        .map(([types, operators]) => `${types}: ${operators.join(', ')}`)
        .join('; ')}.`,
    ),
  match: z.enum(['all', 'any']).optional().describe('Whether rows match all the filters (default) or any of them'),
  sorts: z.array(z.object({ column: z.string(), direction: z.enum(['asc', 'desc']).optional() })).optional().describe('Sorted by these columns, in order'),
  groupBy: z.string().nullable().optional().describe("For a board: the select column whose choices are its columns (a new board: the first select)"),
  colourBy: z.string().nullable().optional().describe("For a board or gallery: a select or multi_select column whose choices' colours its cards take (null: none)"),
  hide: z.array(z.string()).optional().describe('Columns the view hides'),
};

// The column types these tools make: not "linked from" (shown in the app, from a relation)
const COLUMN_TYPES = ['text', 'number', 'date', 'checkbox', 'select', 'multi_select', 'url', 'person', 'relation'];
const HAS_CHOICES = new Set(['select', 'multi_select']);
// "Multi-select", "multi select", "multiselect": all multi_select
const columnType = (type) => COLUMN_TYPES.find((t) => t.replace('_', '') === String(type).trim().toLowerCase().replace(/[\s_-]/g, ''));
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

const choiceSchema = z.union([
  z.string(),
  z.object({ value: z.string(), colour: z.string().nullable().optional().describe(`A colour: ${Object.keys(COLOURS).join(', ')}, or #rrggbb`) }),
]);

const columnSchema = {
  name: z.string().describe('Column name'),
  type: z.string().describe(`Column type: ${COLUMN_TYPES.join(', ')}`),
  choices: z.array(choiceSchema).optional().describe('For a select or multi_select: its choices, in order'),
  relatesTo: z.string().optional().describe('For a relation: the page id of the database whose rows it links to'),
  multiple: z.boolean().optional().describe('For a relation: whether a cell can link to more than one row (default: one)'),
};

/** The column of a database by id or name (any case). */
function findColumn(fields, column) {
  const field = fields.find((f) => f.id === column) ?? fields.find((f) => sameName(f.name, column));
  if (!field) throw new Error(`No column "${column}". Columns: ${fields.map((f) => f.name).join(', ')}`);
  return field;
}

/** The choices given (names, or { value, colour }), after those there (any case), each once. */
function withChoices(existing, added) {
  const choices = [...existing];
  const taken = new Set(existing.map((c) => String(choiceValue(c)).toLowerCase()));
  for (const choice of added) {
    const value = String(choiceValue(choice) ?? '').trim();
    if (!value || taken.has(value.toLowerCase())) continue;
    taken.add(value.toLowerCase());
    choices.push({ value, color: typeof choice === 'object' ? colourValue(choice.colour) : null });
  }
  return choices;
}

/** The column the API is to make, refused if the database (its column names given) can't have it. */
function newColumn(names, { name, type, choices, relatesTo, multiple }) {
  const kind = columnType(type);
  if (!kind) throw new Error(`Not a column type these tools make: "${type}". Types: ${COLUMN_TYPES.join(', ')}`);
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Give the column a name');
  if (names.some((n) => sameName(n, trimmed))) throw new Error(`There's already a column "${trimmed}"`);
  if (choices?.length && !HAS_CHOICES.has(kind)) throw new Error(`Only a select or multi_select column has choices, not ${kind}`);
  if (kind === 'relation' && !relatesTo) throw new Error('A relation needs relatesTo: the page id of the database it links to');
  if ((relatesTo || multiple !== undefined) && kind !== 'relation') throw new Error(`Only a relation column has relatesTo and multiple, not ${kind}`);
  const options =
    kind === 'relation'
      ? { relation: { pageId: id(relatesTo), allowMultiple: multiple === true } }
      : HAS_CHOICES.has(kind)
        ? { choices: withChoices([], choices ?? []) }
        : {};
  return { name: trimmed, type: kind.toUpperCase(), options };
}

const addColumn = (pageId, column) => api(`/pages/${id(pageId)}/database/fields`, { method: 'POST', body: column });

/** The column each row's title is in: the one marked so, or else (as the API has it) the first. */
const titleColumn = (fields) =>
  fields.find((f) => f.options?.source === 'page') ?? [...fields].sort((a, b) => Number(a.position) - Number(b.position))[0];

// ---- Tools ----

const server = new McpServer({ name: 'wikid', version: '2.0.0' });

tool('list_workspaces', 'List the Wikid workspaces you can see, with their ids.', {}, async () => {
  const memberships = await api('/workspaces');
  return memberships.map((m) => `- ${m.workspace?.name ?? m.name} (${m.workspace?.id ?? m.id}) · ${String(m.role ?? '').toLowerCase()}`).join('\n') || 'No workspaces.';
});

tool('list_pages', 'List the pages in a workspace as a tree, with their ids. Pages marked "database" are databases: use get_database.', { workspaceId: z.string().describe('Workspace id') }, async ({ workspaceId }) =>
  pageTree(await api(`/pages?workspaceId=${id(workspaceId)}`)),
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
  `Create a page, with content written as Markdown: headings, lists, to-dos, code, tables, quotes and images. ${SECTIONS}`,
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
  `Add blocks, written as Markdown, to a page: after or before a block (by id), or at the end. Next to a block in a column, they go in that column. ${SECTIONS}`,
  {
    pageId: z.string().describe('Page id'),
    markdown: z.string().describe('The blocks to add, as Markdown'),
    afterId: z.string().optional().describe('Add them after this block'),
    beforeId: z.string().optional().describe('Add them before this block'),
  },
  async ({ pageId, markdown, afterId, beforeId }) =>
    formatPage(await api(`/pages/${id(pageId)}/markdown/blocks`, { method: 'POST', body: { markdown, afterId, beforeId } })),
);

tool(
  'update_block',
  `Rewrite one block of a page (by id) from Markdown; it can become several blocks. A list or table is rewritten whole. Blocks with no Markdown form (database views and the like) can’t be rewritten. ${SECTIONS}`,
  { pageId: z.string().describe('Page id'), blockId: z.string().describe('Block id, from get_page'), markdown: z.string().describe('The block’s new content, as Markdown') },
  async ({ pageId, blockId, markdown }) =>
    formatPage(await api(`/pages/${id(pageId)}/markdown/blocks/${encodeURIComponent(blockId)}`, { method: 'PUT', body: { markdown } })),
);

tool('delete_block', 'Delete one block of a page (by id).', { pageId: z.string().describe('Page id'), blockId: z.string().describe('Block id, from get_page') }, async ({ pageId, blockId }) =>
  formatPage(await api(`/pages/${id(pageId)}/markdown/blocks/${encodeURIComponent(blockId)}`, { method: 'DELETE' })),
);

tool(
  'replace_page',
  `Rewrite a whole page from Markdown, given the revision get_page showed. Refused when the page has changed since (someone may be typing in it: read it again and rewrite what it has now), or has things Markdown can’t hold (database views, colours, image sizes, column widths): change it block by block then. ${SECTIONS}`,
  {
    pageId: z.string().describe('Page id'),
    markdown: z.string().describe('The whole page, as Markdown'),
    revision: z.string().describe('The revision get_page showed for the page'),
  },
  async ({ pageId, markdown, revision }) => formatPage(await api(`/pages/${id(pageId)}/markdown`, { method: 'PUT', body: { markdown, revision } })),
);

tool(
  'add_image',
  'Put an image on a page, from a file on this computer or a public web address. It is uploaded to Wikid and served from there. ' +
    'It goes after or before a block (by id), in place of one, or at the end. To fill an image placeholder (shown by get_page as "[Image to add: …]"), give its id as replaceId: what it said becomes the image\'s description, unless you give one.',
  {
    pageId: z.string().describe('Page id'),
    file: z.string().optional().describe('Full path of an image file on this computer (PNG, JPEG, GIF, WebP, AVIF, SVG or HEIC)'),
    url: z.string().optional().describe('Or a public web address of an image'),
    alt: z.string().optional().describe('What the image shows, for people who can’t see it'),
    afterId: z.string().optional().describe('Put it after this block'),
    beforeId: z.string().optional().describe('Put it before this block'),
    replaceId: z.string().optional().describe('Put it in place of this block, such as an image placeholder'),
  },
  async ({ pageId, file, url, alt, afterId, beforeId, replaceId }) => {
    if (!file === !url) throw new Error('Give either file or url');
    if ([afterId, beforeId, replaceId].filter(Boolean).length > 1) throw new Error('Give at most one of afterId, beforeId and replaceId');
    let description = alt;
    if (replaceId && description === undefined) {
      // Filling an image placeholder: what it said goes in
      const block = (await getPage(pageId)).blocks?.find((b) => b.id === replaceId);
      if (!block) throw new Error(`No block ${replaceId} on this page`);
      if (block.type === 'imagePlaceholder') description = block.markdown.replace(/^\[Image to add:?\s*/, '').replace(/\]$/, '').replace(/\\([\\[\]])/g, '$1').trim();
    }
    const src = await uploadImage(pageId, { file, url });
    const markdown = imageMarkdown(src, description);
    const page = replaceId
      ? await api(`/pages/${id(pageId)}/markdown/blocks/${encodeURIComponent(replaceId)}`, { method: 'PUT', body: { markdown } })
      : await api(`/pages/${id(pageId)}/markdown/blocks`, { method: 'POST', body: { markdown, afterId, beforeId } });
    return `Added the image.\n\n${formatPage(page)}`;
  },
);

tool('rename_page', 'Rename a page.', { pageId: z.string().describe('Page id'), title: z.string().describe('New title') }, async ({ pageId, title }) => {
  await api(`/pages/${id(pageId)}`, { method: 'PATCH', body: { title } });
  return `Renamed to "${title}".`;
});

tool('get_database', 'Read a database: its columns (with a select’s choices) and its rows, cells by column name.', { pageId: z.string().describe('Page id of the database') }, async ({ pageId }) =>
  formatDatabase(await getDatabase(pageId)),
);

tool(
  'add_database_row',
  'Add a row to a database. Cells by column name: text, a number, a date (YYYY-MM-DD), true/false for a checkbox, a choice for a select, a list of choices for a multi-select, user ids for a person, row ids for a relation; null clears a cell. A value that doesn’t fit its column is refused, and nothing is saved.',
  { pageId: z.string().describe('Page id of the database'), cells: z.record(z.string(), z.unknown()).describe('Cell values by column name') },
  async ({ pageId, cells }) => {
    const { fields } = await getDatabase(pageId);
    const row = await api(`/pages/${id(pageId)}/database/rows`, { method: 'POST', body: { data: cellsById(fields, cells), strict: true } });
    return `Added row ${row.id}.`;
  },
);

tool(
  'update_database_row',
  'Change cells of a database row (by id); cells not given stay as they are. Cells by column name, as for add_database_row. In a compliance database, give a reason: the change is kept in the record’s audit trail.',
  {
    pageId: z.string().describe('Page id of the database'),
    rowId: z.string().describe('Row id, from get_database'),
    cells: z.record(z.string(), z.unknown()).describe('Cell values by column name'),
    reason: z.string().optional().describe('Why the record changes (required in a compliance database)'),
  },
  async ({ pageId, rowId, cells, reason }) => {
    const { db, fields } = await getDatabase(pageId);
    const row = (db.rows ?? []).find((r) => r.id === rowId);
    if (!row) throw new Error(`No row ${rowId} in this database`);
    // The API takes the row's cells whole, so the change goes onto what's there
    await api(`/database-rows/${id(rowId)}`, { method: 'PATCH', body: { data: { ...(row.data ?? {}), ...cellsById(fields, cells) }, strict: true, ...(reason ? { reason } : {}) } });
    return `Updated row ${rowId}.`;
  },
);

tool(
  'create_database',
  `Create a database page, with a "Name" column (each row's title) and any others given. Column types: ${COLUMN_TYPES.join(', ')}.`,
  {
    workspaceId: z.string().describe('Workspace id'),
    title: z.string().describe('Database title'),
    parentId: z.string().optional().describe('Put it under this page (default: the top of the workspace)'),
    columns: z.array(z.object(columnSchema)).optional().describe('Columns after Name, in order'),
  },
  async ({ workspaceId, title, parentId, columns = [] }) => {
    // Every column checked before anything is made, so a bad one doesn't leave half a database
    const names = ['Name'];
    const made = columns.map((column) => {
      const made = newColumn(names, column);
      names.push(made.name);
      return made;
    });
    for (const { options } of made) {
      if (!options.relation) continue;
      const target = await api(`/pages/${options.relation.pageId}/database`).catch(() => null);
      if (!target || (target.workspaceId && target.workspaceId !== workspaceId)) throw new Error(`No database ${options.relation.pageId} in this workspace for a relation to link to`);
    }
    const page = await api('/pages', { method: 'POST', body: { workspaceId: id(workspaceId), title, parentId: parentId ? id(parentId) : undefined, kind: 'DATABASE', setupStatus: 'COMPLETE' } });
    for (const column of made) await addColumn(page.id, column);
    return `Database ${page.id} created.\n\n${formatDatabase(await getDatabase(page.id))}`;
  },
);

tool(
  'add_database_column',
  `Add a column to a database, after the others. Types: ${COLUMN_TYPES.join(', ')}. A select or multi_select can be given its choices; a relation links to the rows of another database in the workspace (relatesTo), one per cell or several (multiple).`,
  { pageId: z.string().describe('Page id of the database'), ...columnSchema },
  async ({ pageId, ...column }) => {
    const { fields } = await getDatabase(pageId);
    const field = await addColumn(pageId, newColumn(fields.map((f) => f.name), column));
    return `Added column "${field.name}".`;
  },
);

tool(
  'update_database_column',
  "Change a database column: rename it, change its type, or add, rename, remove and colour a select's choices. The cells follow: on a type change each is converted, and one that doesn't fit is kept aside (shown greyed in Wikid until replaced; changing the type back brings it back); a renamed choice is renamed in every cell, and a removed one is kept aside the same way. In a compliance database, where each record changed needs a reason, only the name, added choices and colours change here.",
  {
    pageId: z.string().describe('Page id of the database'),
    column: z.string().describe('The column, by name or id'),
    name: z.string().optional().describe('Its new name'),
    type: z.string().optional().describe(`Its new type: ${COLUMN_TYPES.join(', ')}. A select made from another type gets a choice for each value in it`),
    relatesTo: z.string().optional().describe('Changing to a relation: the page id of the database whose rows it links to'),
    multiple: z.boolean().optional().describe('Changing to a relation: whether a cell can link to more than one row'),
    addChoices: z.array(choiceSchema).optional().describe('Choices to add, at the end (those there already are left as they are)'),
    renameChoices: z.record(z.string(), z.string()).optional().describe('Choices to rename, old name to new'),
    removeChoices: z.array(z.string()).optional().describe('Choices to remove'),
    colourChoices: z
      .record(z.string(), z.string().nullable())
      .optional()
      .describe(`Choices' colours, by choice name: ${Object.keys(COLOURS).join(', ')}, #rrggbb, or null for none`),
  },
  async ({ pageId, column, name, type, relatesTo, multiple, addChoices, renameChoices, removeChoices, colourChoices }) => {
    const { fields } = await getDatabase(pageId);
    const field = findColumn(fields, column);
    const body = {};
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Give the column a name');
      if (fields.some((f) => f.id !== field.id && sameName(f.name, trimmed))) throw new Error(`There's already a column "${trimmed}"`);
      body.name = trimmed;
    }
    const options = field.options && typeof field.options === 'object' ? field.options : {};
    let moving = false;
    if (type !== undefined) {
      const kind = columnType(type);
      if (!kind) throw new Error(`Not a column type these tools make: "${type}". Types: ${COLUMN_TYPES.join(', ')}`);
      if (kind.toUpperCase() !== field.type) {
        if (field.id === titleColumn(fields)?.id) throw new Error(`"${field.name}" is the title column (each row's title); it stays text`);
        if (kind === 'relation' && !relatesTo) throw new Error('A relation needs relatesTo: the page id of the database it links to');
        body.type = kind.toUpperCase();
        // A relation's options; otherwise Wikid's (a select keeps its choices to a multi-select)
        if (kind === 'relation') body.options = { relation: { pageId: id(relatesTo), allowMultiple: multiple === true } };
        moving = true;
      }
    }
    if ((relatesTo !== undefined || multiple !== undefined) && body.type !== 'RELATION') {
      throw new Error("relatesTo and multiple are for changing a column to a relation; a relation's target is changed in Wikid");
    }
    const renames = Object.entries(renameChoices ?? {});
    const colours = Object.entries(colourChoices ?? {});
    if (addChoices?.length || renames.length || removeChoices?.length || colours.length) {
      const kind = String(body.type ?? field.type).toLowerCase();
      if (!HAS_CHOICES.has(kind)) throw new Error(`Only a select or multi_select column has choices; "${field.name}" is ${kind}`);
      if (body.type && (renames.length || removeChoices?.length || colours.length)) throw new Error('Change the type first, then rename, remove or colour its choices');
      let choices = (body.options?.choices ?? options.choices ?? []).map((c) => (typeof c === 'string' ? { value: c, color: null } : c));
      const find = (value) => {
        const choice = choices.find((c) => sameName(String(c.value), value));
        if (!choice) throw new Error(`No choice "${value}" in "${field.name}". Choices: ${choices.map((c) => c.value).join(', ') || 'none'}`);
        return choice;
      };
      const removing = new Set((removeChoices ?? []).map((value) => find(value).value));
      const renaming = new Map(renames.map(([from, to]) => [find(from).value, to.trim()]));
      for (const [from, to] of renaming) {
        if (!to) throw new Error(`Give "${from}" a new name`);
        // Not even a removed one's: its cells would quietly become this one's
        if (choices.some((c) => c.value !== from && sameName(String(c.value), to))) throw new Error(`There's already a choice "${to}"`);
      }
      choices = withChoices(
        choices.filter((c) => !removing.has(c.value)).map((c) => (renaming.has(c.value) ? { ...c, value: renaming.get(c.value) } : c)),
        addChoices ?? []
      );
      // Colours by the choices' names as they are after the renames and additions
      const colouring = new Map();
      for (const [name, colour] of colours) {
        const choice = choices.find((c) => sameName(String(c.value), name));
        if (!choice) throw new Error(`No choice "${name}" in "${field.name}". Choices: ${choices.map((c) => c.value).join(', ') || 'none'}`);
        if (colouring.has(choice.value)) throw new Error(`"${choice.value}" is given two colours`);
        colouring.set(choice.value, colourValue(colour));
      }
      choices = choices.map((c) => (colouring.has(c.value) ? { ...c, color: colouring.get(c.value) } : c));
      body.options = { ...(body.options ?? options), choices };
      if (renaming.size || removing.size) {
        body.renames = Object.fromEntries([...renaming].filter(([from, to]) => from !== to));
        moving = true;
      }
    }
    if (!Object.keys(body).length) throw new Error('Give a new name or type, or choices to add, rename, remove or colour');
    if (!moving) {
      await api(`/database-fields/${id(field.id)}`, { method: 'PATCH', body });
      return `Updated column "${body.name ?? field.name}".`;
    }
    const { changed, kept } = await api(`/database-fields/${id(field.id)}/change`, { method: 'POST', body });
    const keptNote = kept ? `, ${kept} kept aside (they didn't fit)` : '';
    return `Updated column "${body.name ?? field.name}": ${changed} cell${changed === 1 ? '' : 's'} changed${keptNote}.`;
  },
);

tool(
  'create_database_view',
  "Add a view to a database: a table, board, gallery or list of its rows, filtered, sorted, (a board) grouped by a select, and (a board or gallery) its cards coloured by a select's choices. get_database lists the views there.",
  { pageId: z.string().describe('Page id of the database'), name: z.string().describe('View name'), ...viewSchema },
  async ({ pageId, ...given }) => {
    const { fields } = await getDatabase(pageId);
    const body = viewBody(fields, null, given);
    const view = await api(`/pages/${id(pageId)}/database/views`, { method: 'POST', body: { type: 'TABLE', config: {}, ...body } });
    return `Added view "${view.name}".`;
  },
);

tool(
  'update_database_view',
  'Change a database view (by name or id): its name, type, filters, sorts, grouping, card colours or hidden columns. What isn’t given stays as it was; a list given (filters, sorts, hide) replaces the one there. Someone with the database open sees the change when they open it again.',
  { pageId: z.string().describe('Page id of the database'), view: z.string().describe('The view, by name or id'), name: z.string().optional().describe('Its new name'), ...viewSchema },
  async ({ pageId, view, ...given }) => {
    const { db, fields } = await getDatabase(pageId);
    const found = findView(db, view);
    const body = viewBody(fields, found, given);
    if (!Object.keys(body).length) throw new Error('Give something to change: name, type, filters, match, sorts, groupBy or hide');
    await api(`/database-views/${id(found.id)}`, { method: 'PATCH', body });
    return `Updated view "${body.name ?? found.name}".`;
  },
);

tool(
  'delete_database_view',
  'Delete a database view (by name or id). Its rows stay: a view only shows them.',
  { pageId: z.string().describe('Page id of the database'), view: z.string().describe('The view, by name or id') },
  async ({ pageId, view }) => {
    const { db } = await getDatabase(pageId);
    const found = findView(db, view);
    await api(`/database-views/${id(found.id)}`, { method: 'DELETE' });
    return `Deleted view "${found.name}".`;
  },
);

tool(
  'delete_database_column',
  "Delete a database column and every row's cell in it, which can't be undone. Give confirm: true. The title column (Name) can't be deleted.",
  {
    pageId: z.string().describe('Page id of the database'),
    column: z.string().describe('The column, by name or id'),
    confirm: z.boolean().optional().describe('true, to delete it and its cells'),
  },
  async ({ pageId, column, confirm }) => {
    const { fields } = await getDatabase(pageId);
    const field = findColumn(fields, column);
    if (field.id === titleColumn(fields)?.id) throw new Error(`"${field.name}" is the title column (each row's title), so it can't be deleted`);
    if (confirm !== true) throw new Error(`Deleting "${field.name}" deletes every row's cell in it, which can't be undone: give confirm: true`);
    await api(`/database-fields/${id(field.id)}`, { method: 'DELETE' });
    return `Deleted column "${field.name}".`;
  },
);

await server.connect(new StdioServerTransport());
