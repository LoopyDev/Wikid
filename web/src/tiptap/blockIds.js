import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { ORIGIN_META_KEY, SYNCED_FROM_ATTR } from './editorShared';

// Stable block ids (used by block links, synced blocks and the table of contents) and block highlighting.

export const BLOCK_ID_TYPES = ['paragraph', 'heading', 'toggleHeading', 'codeBlock', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'horizontalRule', 'tableOfContents', 'callout', 'image', 'pageLink', 'databaseView', 'databaseForm', 'table', 'gaussianSplat'];

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
    const nextFromDoc = (doc) => {
      let max = 0;
      doc.descendants((node) => {
        const num = parseBlockIdCounter(node.attrs?.id);
        if (num !== null && num >= max) {
          max = num + 1;
        }
      });
      return max || 1;
    };

    const key = new PluginKey('block-id-manager');
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => ({ nextId: nextFromDoc(state.doc) }),
          apply(tr, value) {
            const meta = tr.getMeta(key);
            if (meta && typeof meta.nextId === 'number') {
              return { nextId: meta.nextId };
            }
            return value;
          },
        },
        appendTransaction(transactions, oldState, newState) {
          let tr = newState.tr;
          let changed = false;
          const seen = new Set();
          const pluginState = key.getState(newState) || { nextId: 1 };
          let nextId = pluginState.nextId;
          const isSingleEmptyParagraph =
            isCollabEnabled.value
            && newState.doc.childCount === 1
            && isEmptyParagraphNode(newState.doc.child(0));

          if (isSingleEmptyParagraph) {
            return null;
          }

          newState.doc.descendants((node, pos) => {
            if (!node.isBlock) return;
            if (!BLOCK_ID_TYPES.includes(node.type.name)) return;
            const currentId = node.attrs?.id;
            const num = parseBlockIdCounter(currentId);
            const isDuplicate = currentId && seen.has(currentId);
            const needsId = !currentId || num === null || isDuplicate;
            if (currentId) {
              seen.add(currentId);
            }
            if (needsId) {
              const newId = `block-${nextId}`;
              nextId += 1;
              seen.add(newId);
              tr = tr.setNodeMarkup(pos, node.type, { ...node.attrs, id: newId }, node.marks);
              changed = true;
            }
          });

          if (changed) {
            tr.setMeta(ORIGIN_META_KEY, 'block-id-manager');
            tr.setMeta(key, { nextId });
            return tr;
          }

          // keep counter fresh if doc gained larger ids externally
          const maxId = nextFromDoc(newState.doc);
          if (maxId > nextId) {
            const metaTr = newState.tr.setMeta(key, { nextId: maxId });
            return metaTr;
          }
          return null;
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

export const parseBlockIdCounter = (id) => {
  if (typeof id !== 'string') return null;
  const match = id.match(/block-(\d+)/);
  if (!match) return null;
  const num = Number.parseInt(match[1], 10);
  return Number.isFinite(num) && num >= 0 ? num : null;
};
