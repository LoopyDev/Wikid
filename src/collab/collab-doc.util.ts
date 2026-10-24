import * as Y from 'yjs';
import { collabSchema } from './collab-doc.schema';
import { BLOCK_ID_TYPES, normalizeEditorContent } from '../pages/editor-doc.util';

const COLLAB_FRAGMENT = 'default';

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
  repairedState: Buffer | null;
  hadDuplicateIds: boolean;
  hadInvalidIds: boolean;
};

export const normalizeCollabDocState = async (state: Buffer): Promise<CollabDocNormalization> => {
  const { yXmlFragmentToProsemirror, prosemirrorJSONToYXmlFragment } = await import('y-prosemirror');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const title = doc.getText('title').toString().trim() || null;
  const fragment = doc.getXmlFragment(COLLAB_FRAGMENT);
  const pmNode = yXmlFragmentToProsemirror(collabSchema, fragment);
  const json = pmNode?.toJSON ? pmNode.toJSON() : null;
  const { hasDuplicate, hasInvalid } = hasBlockIdIssues(json);
  const normalized = normalizeEditorContent(json ?? null);
  let repairedState: Buffer | null = null;
  if (hasDuplicate || hasInvalid) {
    prosemirrorJSONToYXmlFragment(
      collabSchema,
      { type: normalized.type || 'doc', content: normalized.content },
      fragment
    );
    repairedState = Buffer.from(Y.encodeStateAsUpdate(doc));
  }
  return {
    normalized,
    title,
    repairedState,
    hadDuplicateIds: hasDuplicate,
    hadInvalidIds: hasInvalid,
  };
};

export const editorDocFromYjsState = async (state: Buffer) => {
  const result = await normalizeCollabDocState(state);
  return result.normalized;
};

export const updateCollabTitleState = (state: Buffer, title: string) => {
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
  return Buffer.from(Y.encodeStateAsUpdate(doc));
};
