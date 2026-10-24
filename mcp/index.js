#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = process.env.WIKID_API_URL || 'http://localhost:3000';
const EMAIL = process.env.WIKID_EMAIL || '';
const PASSWORD = process.env.WIKID_PASSWORD || '';

if (!EMAIL || !PASSWORD) {
  process.stderr.write('Warning: WIKID_EMAIL / WIKID_PASSWORD not set. API calls will fail.\n');
}

let USER_ID = '';
let sessionCookie = '';

async function login() {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Wikid login failed: ${(await res.text()) || res.statusText}`);
  const setCookie = res.headers.get('set-cookie') || '';
  sessionCookie = setCookie.split(';')[0];
  USER_ID = (await res.json()).user.id;
}

async function req(path, options = {}, retried = false) {
  if (!sessionCookie) await login();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, ...(options.headers || {}) },
  });
  if (res.status === 401 && !retried) {
    sessionCookie = '';
    return req(path, options, true);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') p.append(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Flatten blocks to readable plain text */
function blocksToText(blocks) {
  if (!blocks || !Array.isArray(blocks)) return '';
  const lines = [];
  for (const block of blocks) {
    const text = extractText(block);
    if (text) lines.push(text);
  }
  return lines.join('\n');
}

function extractText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractText).join('');
  }
  return '';
}

const server = new McpServer({ name: 'wikid', version: '1.0.0' });

server.tool(
  'list_workspaces',
  'List all Wikid workspaces available to the current user',
  {},
  async () => {
    const data = await req(`/workspaces${qs({ userId: USER_ID })}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  'list_pages',
  'List all pages in a workspace',
  {
    workspaceId: z.string().describe('Workspace ID'),
  },
  async ({ workspaceId }) => {
    const data = await req(`/pages${qs({ workspaceId, userId: USER_ID })}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  'get_page',
  'Get a page and its full content',
  {
    pageId: z.string().describe('Page ID'),
    format: z.enum(['json', 'text']).optional().default('text').describe('Return raw JSON blocks or plain text'),
  },
  async ({ pageId, format }) => {
    const [page, blocks] = await Promise.all([
      req(`/pages/${pageId}${qs({ userId: USER_ID })}`),
      req(`/pages/${pageId}/blocks${qs({ userId: USER_ID })}`),
    ]);
    const content = format === 'text'
      ? `# ${page.title}\n\n${blocksToText(blocks)}`
      : JSON.stringify({ page, blocks }, null, 2);
    return { content: [{ type: 'text', text: content }] };
  },
);

server.tool(
  'get_database',
  'Get a database page with its field schema and all rows',
  {
    pageId: z.string().describe('Page ID of the database'),
  },
  async ({ pageId }) => {
    const data = await req(`/pages/${pageId}/database${qs({ userId: USER_ID })}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  'create_page',
  'Create a new page in a workspace',
  {
    title: z.string().describe('Page title'),
    workspaceId: z.string().describe('Workspace ID'),
    parentId: z.string().optional().describe('Parent page ID (optional)'),
  },
  async ({ title, workspaceId, parentId }) => {
    const data = await req('/pages', {
      method: 'POST',
      body: JSON.stringify({ title, workspaceId, parentId, userId: USER_ID }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  'update_page_title',
  'Rename a page',
  {
    pageId: z.string().describe('Page ID'),
    title: z.string().describe('New title'),
  },
  async ({ pageId, title }) => {
    const data = await req(`/pages/${pageId}${qs({ userId: USER_ID })}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
