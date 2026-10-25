import { ySyncPluginKey } from '@tiptap/y-tiptap';

// Small helpers shared by the editor extensions and TiptapEditor.vue.

export const isEmptyParagraph = (node) => {
  if (!node) return false;
  if (node.type?.name !== 'paragraph') return false;
  return node.content?.size === 0;
};

export const findColumnAncestor = (state, pos) => {
  if (!state || typeof pos !== 'number') return null;
  const $pos = state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node?.type?.name === 'column') {
      return { node, pos: $pos.before(depth) };
    }
  }
  return null;
};

export const SYNCED_FROM_ATTR = 'syncedFrom';

export const ORIGIN_META_KEY = 'wikidOrigin';

// Changes from other collaborators arrive as one transaction that replaces the whole
// document; y-prosemirror restores the local selection itself. Selection "repair"
// plugins must leave these alone, or they move the cursor using stale positions.
export const isRemoteCollabChange = (tr) => !!tr.getMeta(ySyncPluginKey)?.isChangeOrigin;

export const summarizeSteps = (transactions) =>
  transactions.map((tr) => ({
    origin: tr.getMeta(ORIGIN_META_KEY),
    uiEvent: tr.getMeta('uiEvent'),
    inputType: tr.getMeta('inputType'),
    ySync: !!tr.getMeta(ySyncPluginKey),
    docChanged: tr.docChanged,
    steps: tr.steps.map((step) => {
      const json = step.toJSON?.();
      if (!json || typeof json !== 'object') return { step: step.constructor?.name || 'step' };
      const summary = { step: json.stepType };
      if (typeof json.from === 'number') summary.from = json.from;
      if (typeof json.to === 'number') summary.to = json.to;
      if (json.slice?.content) {
        summary.slice = json.slice.content.map((node) => node.type || node);
      }
      return summary;
    }),
  }));

export const findTextblockAtSelection = (state) => {
  if (!state?.selection) return null;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node?.isTextblock) {
      return { node, pos: $from.before(depth) };
    }
  }
  return null;
};
