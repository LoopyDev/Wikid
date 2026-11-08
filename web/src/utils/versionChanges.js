// What changed between two versions of a page, block by block. Blocks keep their ids from one
// version to the next, so a block is added (its id is new), removed (its id is gone), or
// changed (its own content differs). A block's own content leaves out the blocks inside it, so
// one edited item in a long list marks that item, not the whole list.

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};

// Versions are plain JSON. (structuredClone can't copy Vue's reactive wrappers around them.)
const copy = (value) => JSON.parse(JSON.stringify(value));

const blockId = (node) => (node && typeof node.attrs?.id === 'string' && node.attrs.id ? node.attrs.id : null);

// Settings left at nothing: the live editor saves each block's defaults (indent: 0, syncedFrom: null),
// a save through the API leaves them out, and the two mean the same
const isUnset = (value) => value === null || value === undefined || value === 0 || value === false || value === '';
const setAttrs = (attrs) => Object.fromEntries(Object.entries(attrs || {}).filter(([, value]) => !isUnset(value)));

// A block's own content: its type, settings and anything inside it that isn't a block of its own
const ownContent = (node) => {
  const { content, attrs, ...rest } = node;
  const own = Array.isArray(content) ? content.filter((child) => !blockId(child)).map(canonical) : [];
  return JSON.stringify(canonical({ ...rest, attrs: setAttrs(attrs), content: own }));
};

// An empty paragraph coming or going isn't worth marking (the editor keeps one at the end of a page)
const isEmptyParagraph = (node) => node?.type === 'paragraph' && !(Array.isArray(node.content) && node.content.length);

/** Every block with an id: its node, its parent block's id (null at the top), and the block before it. */
const indexBlocks = (doc) => {
  const blocks = new Map();
  const walk = (nodes, parentId) => {
    let previousId = null;
    for (const node of Array.isArray(nodes) ? nodes : []) {
      const id = blockId(node);
      if (id && !blocks.has(id)) {
        blocks.set(id, { node, parentId, previousId });
        previousId = id;
      }
      walk(node?.content, id ?? parentId);
    }
  };
  walk(doc?.content, null);
  return blocks;
};

/**
 * Compares a version with the one before it.
 * @returns {{ doc: object, added: Set<string>, changed: Set<string>, removed: Set<string> }}
 *   `doc` is the newer version with the removed blocks put back where they were, to show them.
 */
export function compareVersions(older, newer) {
  const before = indexBlocks(older);
  const after = indexBlocks(newer);
  const added = new Set();
  const changed = new Set();
  const removed = new Set();
  for (const [id, { node }] of after) {
    const old = before.get(id);
    if (!old) {
      if (!isEmptyParagraph(node)) added.add(id);
    }
    else if (ownContent(old.node) !== ownContent(node)) changed.add(id);
  }
  // Only the outermost removed blocks are put back: the blocks inside them come along
  const removedRoots = [];
  for (const [id, entry] of before) {
    if (after.has(id) || isEmptyParagraph(entry.node)) continue;
    removed.add(id);
    if (!entry.parentId || after.has(entry.parentId)) removedRoots.push({ id, ...entry });
  }

  const doc = copy(newer ?? { type: 'doc', content: [] });
  if (removedRoots.length) {
    const containers = new Map([[null, doc]]);
    const findContainers = (node) => {
      for (const child of Array.isArray(node?.content) ? node.content : []) {
        const id = blockId(child);
        if (id) containers.set(id, child);
        findContainers(child);
      }
    };
    findContainers(doc);
    for (const { node, parentId, previousId } of removedRoots) {
      const container = containers.get(parentId) ?? doc;
      if (!Array.isArray(container.content)) container.content = [];
      // After the block it followed, if that's still there (or was put back already); else first
      const at = previousId ? container.content.findIndex((child) => blockId(child) === previousId) : -1;
      const restored = copy(node);
      container.content.splice(at + 1, 0, restored);
      containers.set(blockId(restored), restored);
      findContainers(restored);
    }
  }
  return { doc, added, changed, removed };
}

/** The blocks of `ids` not inside another of them: a new list item, not its paragraph as well. */
export function outermost(ids, doc) {
  const result = new Set();
  const walk = (nodes, inside) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      const marked = ids.has(blockId(node));
      if (marked && !inside) result.add(blockId(node));
      walk(node?.content, inside || marked);
    }
  };
  walk(doc?.content, false);
  return result;
}

const escapeId = (id) => (globalThis.CSS?.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&'));

/** CSS marking the blocks inside `scope` by what happened to them, in the --history-* colours. */
export function changesStyle(scope, { added, changed, removed }) {
  const kinds = [
    ['added', added],
    ['changed', changed],
    ['removed', removed],
  ];
  return kinds
    .filter(([, ids]) => ids.size)
    .map(([kind, ids]) => {
      const selectors = [...ids].map((id) => `${scope} [data-block-id="${escapeId(id)}"]`).join(',\n');
      return `${selectors} {\n  background: var(--history-${kind}-bg);\n  box-shadow: inset 3px 0 0 var(--history-${kind});\n${kind === 'removed' ? '  text-decoration: line-through;\n  opacity: 0.75;\n' : ''}}`;
    })
    .join('\n');
}
