import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { ORIGIN_META_KEY, SYNCED_FROM_ATTR, isRemoteCollabChange } from './editorShared';

// Stable block ids (used by block links, synced blocks and the table of contents) and block highlighting.

export const BLOCK_ID_TYPES = ['paragraph', 'heading', 'toggleHeading', 'codeBlock', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'horizontalRule', 'tableOfContents', 'callout', 'image', 'pageLink', 'databaseView', 'databaseForm', 'table', 'gaussianSplat', 'imagePlaceholder'];

export const blockHighlightKey = new PluginKey('block-highlight');

export const createBlockIdExtension = ({ isCollabEnabled }) => Extension.create({
  name: 'block-id',
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_ID_TYPES,
        attributes: {
          id: {
            default: null,
          },
          [SYNCED_FROM_ATTR]: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-synced-from') || null,
            renderHTML: (attributes) => {
              const syncedFrom = attributes[SYNCED_FROM_ATTR];
              return syncedFrom ? { 'data-synced-from': syncedFrom } : {};
            },
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('block-id-manager'),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          // Ids in someone else's change are theirs to fix; fixing them here too would give the
          // same block a different id in each browser.
          if (transactions.every((tr) => isRemoteCollabChange(tr))) return null;
          if (
            isCollabEnabled.value
            && newState.doc.childCount === 1
            && isEmptyParagraphNode(newState.doc.child(0))
          ) {
            return null;
          }
          const tr = withBlockIds(newState);
          if (!tr) return null;
          tr.setMeta(ORIGIN_META_KEY, 'block-id-manager');
          return tr;
        },
      }),
    ];
  },
});

export const createBlockPositionExtension = ({ hasWorkspaceSyncedReference }) => Extension.create({
  name: 'block-position-deco',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockHighlightKey,
        state: {
          init: () => ({ highlightId: null, highlightType: null }),
          apply(tr, value) {
            let highlightId = value.highlightId;
            let highlightType = value.highlightType;
            const meta = tr.getMeta(blockHighlightKey);
            if (meta && typeof meta.highlightId === 'string') {
              highlightId = meta.highlightId;
            }
            if (meta && typeof meta.highlightType === 'string') {
              highlightType = meta.highlightType;
            }
            if (meta && meta.clearHighlight) {
              highlightId = null;
              highlightType = null;
            }
            return { highlightId, highlightType };
          },
        },
        props: {
          decorations(state) {
            const pluginState = blockHighlightKey.getState(state) || { highlightId: null, highlightType: null };
            const decos = [];
            const syncedSources = new Set();
            state.doc.descendants((node) => {
              if (node.isBlock && node.attrs?.[SYNCED_FROM_ATTR]) {
                syncedSources.add(node.attrs[SYNCED_FROM_ATTR]);
              }
            });
            state.doc.descendants((node, pos) => {
              if (!node.isBlock) return;
              const id = node.attrs?.id;
              const syncedFrom = node.attrs?.[SYNCED_FROM_ATTR];
              const attrs = { 'data-block-pos': String(pos), 'data-pos': String(pos) };
              const classes = [];
              if (id) {
                attrs['data-block-id'] = id;
              }
              if (syncedFrom) {
                attrs['data-synced-from'] = syncedFrom;
                classes.push('synced-block');
              }
              if (id && (syncedSources.has(id) || hasWorkspaceSyncedReference(id))) {
                classes.push('synced-source-block');
              }
              if (pluginState.highlightId && id === pluginState.highlightId) {
                if (pluginState.highlightType === 'toc') {
                  classes.push('toc-block-highlight');
                } else {
                  classes.push('block-link-focus');
                }
              }
              if (classes.length) {
                attrs.class = classes.join(' ');
              }
              decos.push(Decoration.node(pos, pos + node.nodeSize, attrs));
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

export const isEmptyParagraphNode = (node) => node?.type?.name === 'paragraph' && node.content?.size === 0;

// The first character is a digit, so a browser tab still running the older code (which reads
// "block-" and a number) takes these ids as valid, rather than renumbering them for everyone.
// The server makes them the same way (api/src/pages/block-id.util.ts): keep the two in step.
const FIRST = '23456789';
const REST = '0123456789abcdefghjkmnpqrstvwxyz';

// A random id, so two people (or one person offline) adding blocks at once never pick the same one,
// and an id is never handed out again after its block is deleted.
export const newBlockId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let id = `block-${FIRST[bytes[0] & 7]}`;
  for (const byte of bytes.subarray(1)) id += REST[byte & 31];
  return id;
};

// An id a link can point at: "block-" and then letters, digits, "_" or "-" (the older "block-12" too).
export const isBlockId = (id) => typeof id === 'string' && /^block-[A-Za-z0-9_-]{1,64}$/.test(id);

/**
 * A transaction giving every block that needs one an id: blocks without one, or with an invalid one,
 * and all but one of the blocks sharing one (as after a split). Of those, the id stays with the
 * first that has something in it, so Enter at the start of a block leaves the id with its text
 * rather than the new empty line above. Existing ids are kept. Returns null when nothing changes.
 */
export const withBlockIds = (state) => {
  const blocks = [];
  const keeper = new Map();
  state.doc.descendants((node, pos) => {
    if (!node.isBlock || !BLOCK_ID_TYPES.includes(node.type.name)) return;
    const id = node.attrs?.id;
    blocks.push({ node, pos, id });
    if (!isBlockId(id)) return;
    const kept = keeper.get(id);
    if (!kept || (kept.node.content.size === 0 && node.content.size > 0)) keeper.set(id, { node, pos });
  });
  const tr = state.tr;
  for (const { node, pos, id } of blocks) {
    if (isBlockId(id) && keeper.get(id).pos === pos) continue;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: newBlockId() }, node.marks);
  }
  return tr.docChanged ? tr : null;
};
