import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Mapping, StepMap } from 'prosemirror-transform';
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

/**
 * The position of the block an element is in (the nearest marked `data-block` by the decorations
 * below: an image's inner box finds its image), or null. Looked up each time: positions change with
 * every edit above, so none are kept in the page (a node view's own data-pos can be behind).
 */
export const blockElementPos = (view, element) => {
  const block = element?.closest?.('[data-block]');
  if (!view || !block) return null;
  const { doc } = view.state;
  const max = doc.content.size;
  let inside;
  try {
    inside = view.posAtDOM(block, 0);
  } catch {
    return null;
  }
  for (const pos of [inside - 1, inside]) {
    if (pos >= 0 && pos < max && view.nodeDOM(pos) === block) return pos;
  }
  const $pos = doc.resolve(Math.max(0, Math.min(inside, max)));
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (view.nodeDOM($pos.before(depth)) === block) return $pos.before(depth);
  }
  return null;
};

// The decorations every block gets: a `data-block` marker (blockElementPos finds its position),
// its id, and classes for synced blocks and highlighting. Built for the blocks between from and to.
const blockDecorations = (doc, from, to, { syncedSources, highlightId, highlightType, hasWorkspaceSyncedReference }) => {
  const decos = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isBlock) return;
    const id = node.attrs?.id;
    const syncedFrom = node.attrs?.[SYNCED_FROM_ATTR];
    // A marker, not the block's position: positions change for every block after the cursor on
    // each keystroke, and rewriting them all slowed typing on long pages
    const attrs = { 'data-block': '' };
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
    if (highlightId && id === highlightId) {
      classes.push(highlightType === 'toc' ? 'toc-block-highlight' : 'block-link-focus');
    }
    if (classes.length) {
      attrs.class = classes.join(' ');
    }
    decos.push(Decoration.node(pos, pos + node.nodeSize, attrs));
  });
  return decos;
};

const isSyncedReference = (node) => node.isBlock && !!node.attrs?.[SYNCED_FROM_ATTR];

const syncedSourcesIn = (doc) => {
  const sources = new Set();
  doc.descendants((node) => {
    if (isSyncedReference(node)) sources.add(node.attrs[SYNCED_FROM_ATTR]);
  });
  return sources;
};

// The blocks the synced copies between from and to are copies of, as one string to compare
const syncedFromBetween = (doc, from, to) => {
  const sources = [];
  doc.nodesBetween(from, to, (node) => {
    if (isSyncedReference(node)) sources.push(node.attrs[SYNCED_FROM_ATTR]);
  });
  return sources.sort().join('\n');
};

// Where a change landed, in the old document and the new, found by comparing the two: that also
// catches a changed attribute (a block's id), which moves nothing, and stays cheap for a remote
// change, which arrives as the whole page replaced. Null if nothing changed.
const changedRange = (oldDoc, newDoc) => {
  const from = oldDoc.content.findDiffStart(newDoc.content);
  if (from == null) return null;
  const end = oldDoc.content.findDiffEnd(newDoc.content) || { a: oldDoc.content.size, b: newDoc.content.size };
  // With repeated content the two ends can cross over: push them past the start
  const overlap = from - Math.min(end.a, end.b);
  if (overlap > 0) {
    end.a += overlap;
    end.b += overlap;
  }
  return { from, to: end.b, oldFrom: from, oldTo: end.a };
};

// The top-level blocks covering from..to: their start and end
const topLevelSpan = (doc, from, to) => {
  const start = doc.resolve(Math.min(from, doc.content.size));
  const end = doc.resolve(Math.min(Math.max(from, to), doc.content.size));
  return { from: start.depth ? start.before(1) : start.pos, to: end.depth ? end.after(1) : end.pos };
};

export const createBlockPositionExtension = ({ hasWorkspaceSyncedReference }) => Extension.create({
  name: 'block-position-deco',
  addProseMirrorPlugins() {
    const build = (doc, highlightId, highlightType) => {
      const syncedSources = syncedSourcesIn(doc);
      const ctx = { syncedSources, highlightId, highlightType, hasWorkspaceSyncedReference };
      return { syncedSources, decos: DecorationSet.create(doc, blockDecorations(doc, 0, doc.content.size, ctx)) };
    };
    // A change's decorations: the old ones moved along, with the top-level blocks it touched rebuilt
    const rebuildBlocksWithIds = (value, doc, ids, highlightId, highlightType) => {
      const wanted = new Set(ids.filter(Boolean));
      let { decos } = value;
      if (!wanted.size) return decos;
      const ctx = { syncedSources: value.syncedSources, highlightId, highlightType, hasWorkspaceSyncedReference };
      doc.descendants((node, pos) => {
        if (!node.isBlock || !wanted.has(node.attrs?.id)) return;
        const to = pos + node.nodeSize;
        decos = decos.remove(decos.find(pos, to, () => true).filter((deco) => deco.from === pos && deco.to === to));
        decos = decos.add(doc, blockDecorations(doc, pos, to, ctx).filter((deco) => deco.from === pos && deco.to === to));
      });
      return decos;
    };
    const updateBlockDecorations = (value, oldDoc, newDoc, highlightId, highlightType) => {
      const changed = changedRange(oldDoc, newDoc);
      if (!changed) return value;
      // Mapped by the same comparison, so what's kept and what's rebuilt always line up
      const mapping = new Mapping([new StepMap([changed.oldFrom, changed.oldTo - changed.oldFrom, changed.to - changed.from])]);
      const oldSpan = topLevelSpan(oldDoc, changed.oldFrom, changed.oldTo);
      const newSpan = topLevelSpan(newDoc, changed.from, changed.to);
      // A synced copy added or taken away (not typed in) can change which blocks are sources
      if (syncedFromBetween(oldDoc, oldSpan.from, oldSpan.to) !== syncedFromBetween(newDoc, newSpan.from, newSpan.to)) {
        return { highlightId, highlightType, ...build(newDoc, highlightId, highlightType) };
      }
      let decos = value.decos.map(mapping, newDoc);
      decos = decos.remove(decos.find(newSpan.from, newSpan.to, () => true).filter((deco) => deco.from >= newSpan.from && deco.to <= newSpan.to));
      const ctx = { syncedSources: value.syncedSources, highlightId, highlightType, hasWorkspaceSyncedReference };
      decos = decos.add(newDoc, blockDecorations(newDoc, newSpan.from, newSpan.to, ctx));
      return { ...value, decos };
    };
    return [
      new Plugin({
        key: blockHighlightKey,
        state: {
          init: (_config, state) => ({ highlightId: null, highlightType: null, ...build(state.doc, null, null) }),
          // Kept from one change to the next: a keystroke rebuilds only the top-level blocks it
          // touched (all of them every time made typing slower the longer the page)
          apply(tr, value, oldState, newState) {
            let { highlightId, highlightType } = value;
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
            const highlightChanged = highlightId !== value.highlightId || highlightType !== value.highlightType;
            if (tr.getMeta('synced-ref-refresh') || (highlightChanged && tr.docChanged)) {
              return { highlightId, highlightType, ...build(newState.doc, highlightId, highlightType) };
            }
            if (highlightChanged) {
              // Only the blocks highlighted before and now (hovering a table of contents)
              return { ...value, highlightId, highlightType, decos: rebuildBlocksWithIds(value, newState.doc, [value.highlightId, highlightId], highlightId, highlightType) };
            }
            if (!tr.docChanged) return value;
            try {
              return updateBlockDecorations(value, oldState.doc, newState.doc, highlightId, highlightType);
            } catch (err) {
              // Never in the way of the change itself: built afresh instead
              console.warn('Block decorations: rebuilt after an error', err);
              return { highlightId, highlightType, ...build(newState.doc, highlightId, highlightType) };
            }
          },
        },
        props: {
          decorations(state) {
            return blockHighlightKey.getState(state)?.decos || DecorationSet.empty;
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
