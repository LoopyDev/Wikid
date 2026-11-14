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
