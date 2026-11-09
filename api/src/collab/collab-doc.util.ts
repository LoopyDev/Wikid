import * as Y from 'yjs';
// A static import compiles to require(), so y-prosemirror shares this file's copy of Yjs. A dynamic
// import() would load Yjs's ESM build as well, and the two copies fail each other's type checks.
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirror } from 'y-prosemirror';
import { collabSchema } from './collab-doc.schema';
import { BLOCK_ID_TYPES, normalizeEditorContent } from '../pages/editor-doc.util';

const COLLAB_FRAGMENT = 'default';

// A document's state, for storing in CollabDoc.state. Yjs types it as any Uint8Array, and Prisma's
// Bytes need one backed by a plain ArrayBuffer, which the copy is.
export type CollabState = Uint8Array<ArrayBuffer>;
export const encodeCollabState = (doc: Y.Doc): CollabState => new Uint8Array(Y.encodeStateAsUpdate(doc));

const hasBlockIdIssues = (node: any) => {
  const seen = new Set<string>();
  let hasDuplicate = false;
  let hasInvalid = false;

  const visit = (value: any) => {
    if (!value || hasDuplicate) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object') return;
    const type = value.type;
    if (type && BLOCK_ID_TYPES.includes(type)) {
      const id = value.attrs?.id;
      const valid = typeof id === 'string' && /^block-\d+$/.test(id);
      if (!valid) {
        hasInvalid = true;
      } else if (seen.has(id)) {
        hasDuplicate = true;
      } else {
        seen.add(id);
      }
    }
    if (Array.isArray(value.content)) {
      value.content.forEach(visit);
    }
  };

  visit(node);
  return { hasDuplicate, hasInvalid };
};

export type CollabDocNormalization = {
  normalized: ReturnType<typeof normalizeEditorContent>;
  title: string | null;
  repairedState: CollabState | null;
  hadDuplicateIds: boolean;
  hadInvalidIds: boolean;
};

export const normalizeCollabDocState = async (state: Uint8Array): Promise<CollabDocNormalization> => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const title = doc.getText('title').toString().trim() || null;
  const fragment = doc.getXmlFragment(COLLAB_FRAGMENT);
  const pmNode = yXmlFragmentToProsemirror(collabSchema, fragment);
  const json = pmNode?.toJSON ? pmNode.toJSON() : null;
  const { hasDuplicate, hasInvalid } = hasBlockIdIssues(json);
  const normalized = normalizeEditorContent(json ?? null);
  let repairedState: CollabState | null = null;
  if (hasDuplicate || hasInvalid) {
    prosemirrorJSONToYXmlFragment(
      collabSchema,
      { type: normalized.type || 'doc', content: normalized.content },
      fragment
    );
    repairedState = encodeCollabState(doc);
  }
  return {
    normalized,
    title,
    repairedState,
    hadDuplicateIds: hasDuplicate,
    hadInvalidIds: hasInvalid,
  };
};

/**
 * The change that turns a live document's content into `content` (page content blocks), as a Yjs
 * update to apply to it. Only what differs changes, so blocks left alone keep their place, and
 * edits made meanwhile by others merge with it.
 */
export const contentUpdateForState = (state: Uint8Array, content: unknown[]): Uint8Array => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const before = Y.encodeStateVector(doc);
  prosemirrorJSONToYXmlFragment(collabSchema, { type: 'doc', content }, doc.getXmlFragment(COLLAB_FRAGMENT));
  return Y.encodeStateAsUpdate(doc, before);
};

// What the web app's editor keeps in a live document besides its content: whether it has been
// filled for the first time (so no browser fills it again)
const COLLAB_META = 'wikidMeta';

// As the web app judges it (useCollabSeeding's hasTiptapContent): text that isn't blank, or a block
// other than a paragraph with nothing in it
const hasText = (node: any): boolean => {
  if (!node) return false;
  if (node.type === 'text') return typeof node.text === 'string' && node.text.trim().length > 0;
  const content = Array.isArray(node.content) ? node.content : [];
  if (content.length > 0) return content.some(hasText);
  return !!node.type && node.type !== 'doc' && node.type !== 'paragraph';
};

/**
 * A page's live document as it starts: its saved content and title, filled in on the server, so it's
 * the same whoever opens it first (and however many at once), and not one browser's to undo. Null
 * for a page with nothing in it yet, or content the live document can't hold (a browser fills those).
 */
export const initialStateFromContent = (content: unknown, title: string | null | undefined): CollabState | null => {
  const blocks = normalizeEditorContent(content ?? null).content;
  if (!blocks.some(hasText)) return null;
  try {
    const doc = new Y.Doc();
    doc.transact(() => {
      prosemirrorJSONToYXmlFragment(collabSchema, { type: 'doc', content: blocks }, doc.getXmlFragment(COLLAB_FRAGMENT));
      if (title) doc.getText('title').insert(0, title);
      doc.getMap(COLLAB_META).set('initialized', true);
    });
    return encodeCollabState(doc);
  } catch {
    return null;
  }
};

export const editorDocFromYjsState = async (state: Uint8Array) => {
  const result = await normalizeCollabDocState(state);
  return result.normalized;
};

/** The change that sets a live document's title, as a Yjs update to apply to it; null if it's that already. */
export const titleUpdateForState = (state: Uint8Array, title: string): Uint8Array | null => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const text = doc.getText('title');
  const current = text.toString();
  if (current === title) return null;
  const before = Y.encodeStateVector(doc);
  doc.transact(() => {
    if (current) text.delete(0, current.length);
    if (title) text.insert(0, title);
  });
  return Y.encodeStateAsUpdate(doc, before);
};

export const updateCollabTitleState = (state: Uint8Array, title: string) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const text = doc.getText('title');
  const current = text.toString();
  if (current === title) return null;
  doc.transact(() => {
    if (current) {
      text.delete(0, current.length);
    }
    if (title) {
      text.insert(0, title);
    }
  }, 'title-server');
  return encodeCollabState(doc);
};
