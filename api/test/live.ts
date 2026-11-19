import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { API_URL, Session } from './helpers';

// A page's live document, opened over the collab server as the editor opens it.

const COLLAB_URL = API_URL.replace(/^http/, 'ws').replace(/\/api$/, '/collab');

/**
 * Opens a page's live document and keeps it open; `paragraphs()` reads what it holds. A database's
 * document (its columns and rows) with `{ database: true }`.
 */
export async function openLiveDocument(session: Session, workspaceId: string, pageId: string, { database = false } = {}) {
  const token = (await session.post('/collab/token', { workspaceId })).body.token as string;
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: COLLAB_URL });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `ws:${workspaceId}:${database ? 'db:' : ''}${pageId}`, document: doc, token });
  provider.attach();
  await new Promise<void>((resolve) => provider.on('synced', () => resolve()));
  return {
    doc,
    // Each block's text, read from its text items (without the formatting)
    paragraphs: () =>
      doc
        .getXmlFragment('default')
        .toArray()
        .map((node) =>
          node instanceof Y.XmlElement
            ? node
                .toArray()
                .map((child) => (child instanceof Y.XmlText ? child.toDelta().map((op: { insert: unknown }) => (typeof op.insert === 'string' ? op.insert : '')).join('') : ''))
                .join('')
            : '',
        ),
    title: () => doc.getText('title').toString(),
    /**
     * Until the server has every change made here so far. A change made through the API meanwhile
     * finds the server's copy as it was: one to a database whose columns or row it hasn't got yet
     * goes to the database only, and what's sent from here after brings the old values back.
     */
    sent: async (timeout = 10_000) => {
      const started = Date.now();
      while (provider.hasUnsyncedChanges) {
        if (Date.now() - started > timeout) throw new Error(`The server hadn't confirmed this live document's changes after ${timeout}ms (not got, or refused)`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    close: () => {
      provider.destroy();
      socket.destroy();
    },
  };
}

/** Adds a paragraph to the end of a live document, as typing in the editor does. */
export const appendParagraph = (doc: Y.Doc, text: string) => {
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment('default').push([paragraph]);
};

/**
 * Fills a database's live document from the database (`GET /pages/:id/database`), as the app does
 * when it first opens it, and waits until the server has it: an API change made before then goes
 * to the database only, and the fill arriving after brings the old values back.
 */
export async function fillFromDatabase(live: { doc: Y.Doc; sent: () => Promise<void> }, db: { fields: any[]; rows: any[] }) {
  live.doc.transact(() => {
    for (const field of db.fields) {
      live.doc.getMap('fields').set(field.id, new Y.Map(Object.entries({ name: field.name, type: field.type, options: field.options })));
      live.doc.getArray('fieldOrder').push([field.id]);
    }
    for (const row of db.rows) {
      live.doc.getMap('rows').set(row.id, new Y.Map<any>([['data', new Y.Map(Object.entries(row.data))]]));
      live.doc.getArray('rowOrder').push([row.id]);
    }
  });
  await live.sent();
}
