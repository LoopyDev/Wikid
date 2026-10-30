import 'dotenv/config';
import { Server } from '@hocuspocus/server';
import { Logger } from '@hocuspocus/extension-logger';
import { Database } from '@hocuspocus/extension-database';
import jwt from 'jsonwebtoken';
import * as Y from 'yjs';
import type { IncomingMessage } from 'http';

const port = Number(process.env.COLLAB_PORT) || 1234;
const host = process.env.COLLAB_HOST || '0.0.0.0';
const jwtSecret = process.env.COLLAB_JWT_SECRET;
const collabApiUrl = process.env.COLLAB_API_URL || 'http://localhost:3000';
const collabApiSecret = process.env.COLLAB_API_SECRET;
const storeDebounceMs = Number(process.env.COLLAB_STORE_DEBOUNCE_MS) || 2000;
const storeMaxDebounceMs = Number(process.env.COLLAB_STORE_MAX_DEBOUNCE_MS) || 10000;

if (!collabApiSecret) {
  throw new Error('COLLAB_API_SECRET is not set');
}

type WorkspaceDoc = {
  scope: 'ws' | 'user';
  workspaceId?: string;
  userId?: string;
  pageId: string;
};

type AuthContext = {
  userId: string;
  workspaceIds: string[];
};

type TokenClaims = {
  sub?: string;
  name?: string;
  workspaceIds?: string[];
};

const parseDocumentName = (documentName: string | undefined | null): WorkspaceDoc | null => {
  const raw = String(documentName || '').trim();
  const parts = raw.split(':');
  if (parts.length < 3) return null;
  const [scope, second, third, fourth] = parts;
  let pageId = third;
  if (parts.length === 4 && third === 'db') {
    pageId = fourth;
  }
  if (!pageId) return null;
  if (scope === 'ws' && second) {
    return { scope: 'ws', workspaceId: second, pageId };
  }
  if (scope === 'user' && second) {
    return { scope: 'user', userId: second, pageId };
  }
  return null;
};

// Each workspace has an events document that carries only stateless messages ("pages changed")
// to everyone with the workspace open. It holds no content, so it's never loaded or saved.
const EVENTS_DOC_ID = 'events';
const eventsDocumentName = (workspaceId: string) => `ws:${workspaceId}:${EVENTS_DOC_ID}`;
// A database's document, `ws:<workspace>:db:<page>`: its workspace and page, or null
const parseDatabaseDocumentName = (documentName: string | undefined | null) => {
  const parts = String(documentName || '').trim().split(':');
  if (parts.length !== 4 || parts[0] !== 'ws' || parts[2] !== 'db' || !parts[1] || !parts[3]) return null;
  return { workspaceId: parts[1], pageId: parts[3] };
};

const isEventsDocument = (documentName: string | undefined | null) => {
  const doc = parseDocumentName(documentName);
  return doc?.scope === 'ws' && doc.pageId === EVENTS_DOC_ID;
};

const verifyToken = (token: string | undefined | null, doc: WorkspaceDoc): AuthContext => {
  if (!jwtSecret) {
    throw new Error('COLLAB_JWT_SECRET is not set');
  }
  if (!token) {
    throw new Error('Missing auth token');
  }
  let claims: TokenClaims;
  try {
    claims = jwt.verify(token, jwtSecret) as TokenClaims;
  } catch (err) {
    throw new Error(`Invalid auth token: ${(err as Error).message}`);
  }
  const userId = claims.sub;
  const workspaceIds = Array.isArray(claims.workspaceIds) ? claims.workspaceIds.map(String) : [];
  if (!userId) {
    throw new Error('Token missing subject (sub)');
  }
  if (doc.scope === 'user' && doc.userId && doc.userId !== userId) {
    throw new Error('User access denied for this document');
  }
  if (doc.scope === 'ws' && doc.workspaceId && !workspaceIds.includes(doc.workspaceId)) {
    throw new Error('Workspace access denied');
  }
  return { userId, workspaceIds };
};

const requireApiSecret = () => {
  if (!collabApiSecret) {
    throw new Error('COLLAB_API_SECRET is not set');
  }
};

type FetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

const collabApiFetch = async (path: string, options: FetchOptions = {}) => {
  requireApiSecret();
  const headers = { ...(options.headers || {}) };
  headers.Authorization = `Bearer ${collabApiSecret}`;
  if (!headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${collabApiUrl}${path}`, { ...options, headers });
  return res;
};

const fetchDocState = async (documentName: string | undefined | null) => {
  if (!documentName) return null;
  try {
    const res = await collabApiFetch(`/collab/docs?documentName=${encodeURIComponent(documentName)}`, { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn('Collab fetch failed', { documentName, status: res.status });
      return null;
    }
    const json = await res.json();
    if (!json?.state) return null;
    return Buffer.from(json.state, 'base64');
  } catch (err) {
    console.warn('Collab fetch error', { documentName, error: err });
    return null;
  }
};

const storeDocState = async (documentName: string | undefined | null, state: Buffer) => {
  if (!documentName) return;
  try {
    const res = await collabApiFetch('/collab/docs', {
      method: 'PUT',
      body: JSON.stringify({ documentName, state: Buffer.from(state).toString('base64') }),
    });
    if (!res.ok) {
      console.warn('Collab store failed', { documentName, status: res.status });
    }
  } catch (err) {
    console.warn('Collab store error', { documentName, error: err });
  }
};

const requestMaterialize = async (documentName: string | undefined | null) => {
  if (!documentName) return;
  try {
    const res = await collabApiFetch('/collab/docs/materialize', {
      method: 'POST',
      body: JSON.stringify({ documentName }),
    });
    if (!res.ok) {
      console.warn('Collab materialize request failed', { documentName, status: res.status });
    }
  } catch (err) {
    console.warn('Collab materialize request error', { documentName, error: err });
  }
};

const readRequestBody = async (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(data));
    request.on('error', (err) => reject(err));
  });

const readJsonBody = async (request: IncomingMessage) => {
  const raw = await readRequestBody(request);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
};

const isAuthorizedRequest = (request: IncomingMessage) => {
  const header = String(request.headers.authorization || '').trim();
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return !!token && token === collabApiSecret;
};

const getRequestPath = (request: IncomingMessage) => {
  if (!request.url) return '';
  try {
    return new URL(request.url, 'http://localhost').pathname;
  } catch (err) {
    return '';
  }
};

const normalizeRowData = (value: any) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const applyRowUpdate = (document: Y.Doc, rowId: string, data: Record<string, any>, pageId?: string | null, createdBy?: string | null) => {
  const rowsMap = document.getMap('rows');
  const rowOrder = document.getArray('rowOrder');
  const storedRow = rowsMap.get(rowId);
  let rowMap: Y.Map<any>;
  if (storedRow instanceof Y.Map) {
    rowMap = storedRow;
  } else {
    rowMap = new Y.Map();
    if (storedRow && typeof storedRow === 'object' && !Array.isArray(storedRow)) {
      Object.entries(storedRow).forEach(([key, value]) => {
        rowMap.set(key, value);
      });
    }
    rowsMap.set(rowId, rowMap);
  }
  const storedData = rowMap.get('data');
  let dataMap: Y.Map<any>;
  if (storedData instanceof Y.Map) {
    dataMap = storedData;
  } else {
    dataMap = new Y.Map();
    if (storedData && typeof storedData === 'object' && !Array.isArray(storedData)) {
      Object.entries(storedData).forEach(([key, value]) => {
        dataMap.set(key, value);
      });
    }
    rowMap.set('data', dataMap);
  }
  const nextData = normalizeRowData(data);
  const nextKeys = new Set(Object.keys(nextData));
  dataMap.forEach((_value, key) => {
    const stringKey = String(key);
    if (!nextKeys.has(stringKey)) {
      dataMap.delete(stringKey);
    }
  });
  Object.entries(nextData).forEach(([key, value]) => {
    dataMap.set(key, value);
  });
  if (pageId) {
    rowMap.set('pageId', pageId);
  } else {
    rowMap.delete('pageId');
  }
  // Who added the row, once: never changed after
  if (createdBy && !rowMap.get('createdBy')) rowMap.set('createdBy', createdBy);
  const order = rowOrder.toArray().map((id) => String(id));
  if (!order.includes(rowId)) {
    rowOrder.push([rowId]);
  }
};

const applyRowDelete = (document: Y.Doc, rowId: string) => {
  const rowsMap = document.getMap('rows');
  const rowOrder = document.getArray('rowOrder');
  rowsMap.delete(rowId);
  const order = rowOrder.toArray().map((id) => String(id));
  for (let index = order.length - 1; index >= 0; index -= 1) {
    if (order[index] === rowId) {
      rowOrder.delete(index, 1);
    }
  }
};

const server = new Server({
  name: 'wikid-collab',
  port,
  address: host,
  timeout: 30_000,
  debounce: storeDebounceMs,
  maxDebounce: storeMaxDebounceMs,
  quiet: true,
  extensions: [
    new Logger(),
    new Database({
      fetch: async ({ documentName }) => {
        if (isEventsDocument(documentName)) return null;
        return fetchDocState(documentName);
      },
      store: async ({ documentName, state, instance }) => {
        if (isEventsDocument(documentName)) return;
        await storeDocState(documentName, state);
        // Tell the workspace a database changed, once saved, so a "Linked from" column showing
        // its links elsewhere can catch up
        const database = parseDatabaseDocumentName(documentName);
        const events = database ? instance.documents.get(eventsDocumentName(database.workspaceId)) : null;
        if (database && events) {
          events.broadcastStateless(JSON.stringify({ type: 'database-changed', workspaceId: database.workspaceId, pageId: database.pageId }));
        }
      },
    }),
  ],
  async onAuthenticate({ token, documentName }) {
    const doc = parseDocumentName(documentName);
    if (!doc) {
      throw new Error('Invalid document name');
    }
    const ctx = verifyToken(token, doc);
    console.log('[auth ok]', { documentName, userId: ctx.userId, workspaceIds: ctx.workspaceIds });
    return ctx;
  },
  async onRequest({ request, response, instance }) {
    const path = getRequestPath(request);
    if (
      path !== '/collab/push/db-row' &&
      path !== '/collab/push/db-row-delete' &&
      path !== '/collab/flush' &&
      path !== '/collab/broadcast'
    ) {
      return;
    }
    if (!isAuthorizedRequest(request)) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
      throw null;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      throw null;
    }
    let body = null;
    try {
      body = await readJsonBody(request);
    } catch (err) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
      throw null;
    }
    // Broadcast: send a message to everyone with a workspace open (see EVENTS_DOC_ID)
    if (path === '/collab/broadcast') {
      const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId.trim() : '';
      const message = body?.message;
      if (!workspaceId || !message || typeof message !== 'object') {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: 'workspaceId and message are required' }));
        throw null;
      }
      // Only loaded while someone is connected; with nobody listening there's nothing to do.
      const document = instance.documents.get(eventsDocumentName(workspaceId));
      if (document) {
        document.broadcastStateless(JSON.stringify(message));
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, delivered: !!document }));
      throw null;
    }
    // Flush: force-persist documents to DB immediately (used before export)
    if (path === '/collab/flush') {
      const documentNames: string[] = Array.isArray(body?.documentNames)
        ? body.documentNames.filter((n: any) => typeof n === 'string' && n.trim())
        : [];
      if (!documentNames.length) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: 'documentNames array is required' }));
        throw null;
      }
      let flushed = 0;
      for (const docName of documentNames) {
        try {
          const conn = await instance.openDirectConnection(docName, { source: 'flush' });
          const document = conn.document;
          if (document) {
            const state = Buffer.from(Y.encodeStateAsUpdate(document));
            await storeDocState(docName, state);
            flushed++;
          }
          await conn.disconnect();
        } catch {
          // Document not in memory; skip — DB already has the latest
        }
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, flushed }));
      throw null;
    }
    const documentName = typeof body?.documentName === 'string' ? body.documentName.trim() : '';
    if (!documentName || !parseDocumentName(documentName)) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: 'Invalid documentName' }));
      throw null;
    }
    const connection = await instance.openDirectConnection(documentName, { source: 'api' });
    try {
      if (path === '/collab/push/db-row-delete') {
        const rowId = typeof body?.rowId === 'string' ? body.rowId.trim() : '';
        if (!rowId) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: 'rowId is required' }));
          throw null;
        }
        await connection.transact((document) => {
          applyRowDelete(document, rowId);
        });
      } else {
        const rowId =
          typeof body?.rowId === 'string'
            ? body.rowId.trim()
            : typeof body?.row?.id === 'string'
            ? body.row.id.trim()
            : '';
        const data = body?.data ?? body?.row?.data ?? {};
        const pageId =
          typeof body?.pageId === 'string'
            ? body.pageId.trim()
            : typeof body?.row?.pageId === 'string'
            ? body.row.pageId.trim()
            : null;
        const createdBy =
          typeof body?.createdBy === 'string' && /^[0-9a-fA-F-]{36}$/.test(body.createdBy.trim()) ? body.createdBy.trim() : null;
        if (!rowId) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: 'rowId is required' }));
          throw null;
        }
        await connection.transact((document) => {
          applyRowUpdate(document, rowId, data, pageId, createdBy);
        });
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    } finally {
      await connection.disconnect();
    }
    throw null;
  },
  async onConnect({ socketId, documentName, context }) {
    const doc = parseDocumentName(documentName);
    if (!doc) {
      throw new Error('Invalid document name');
    }
    const ctx = context as AuthContext | undefined;
    // Auth already verified in onAuthenticate; just log for observability.
    console.log('collab connected', { connectionId: socketId, documentName, userId: ctx?.userId, allowed: ctx?.workspaceIds });
  },
  async onDisconnect({ socketId, documentName, clientsCount }) {
    console.log('collab disconnected', socketId);
    if (clientsCount === 0 && !isEventsDocument(documentName)) {
      await requestMaterialize(documentName);
    }
  },
  async onStoreDocument({ document, documentName }) {
    // Broadcast a stateless "stored" event so clients can mark the doc as saved.
    try {
      const payload = JSON.stringify({ type: 'stored', documentName, at: Date.now() });
      document.broadcastStateless(payload);
    } catch (err) {
      console.warn('Failed to broadcast store event', { documentName, error: (err as Error)?.message || err });
    }
  },
});

server.listen();
console.log(`Hocuspocus server listening on ws://${host}:${port}`);
