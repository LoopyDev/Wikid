import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { ORIGIN_META_KEY, SYNCED_FROM_ATTR } from './editorShared';

// Synced blocks: mirrors edits of a synced block to its other copies on the page.

export const syncedMirrorKey = new PluginKey('synced-mirror');

export const workspaceSyncedKey = (pageId, blockId) => {
  if (!pageId || !blockId) return null;
  return `${pageId}:${blockId}`;
};

export const resolveWorkspaceSyncedKey = (syncedFrom, pageId) => {
  if (!syncedFrom) return null;
  if (syncedFrom.includes(':')) return syncedFrom;
  return workspaceSyncedKey(pageId, syncedFrom) || syncedFrom;
};

export const createSyncedMirrorExtension = ({ isSyncedLocked }) => Extension.create({
  name: 'synced-mirror',
  addProseMirrorPlugins() {
    const normalizeSyncedNode = (node) => {
      const attrs = { ...(node?.attrs || {}) };
      delete attrs.id;
      delete attrs[SYNCED_FROM_ATTR];
      return {
        type: node?.type?.name || '',
        attrs,
        marks: (node?.marks || []).map((mark) => ({ type: mark.type.name, attrs: mark.attrs })),
        content: node?.content?.toJSON ? node.content.toJSON() : node?.content,
      };
    };
    const sameSyncedShape = (a, b) => JSON.stringify(normalizeSyncedNode(a)) === JSON.stringify(normalizeSyncedNode(b));

    return [
      new Plugin({
        key: syncedMirrorKey,
        appendTransaction(transactions, oldState, newState) {
          let tr = newState.tr;
          let changed = false;
          const oldSources = new Map();
          const oldRefs = new Map();
          oldState.doc.descendants((node, pos) => {
            if (!node.isBlock) return;
            if (node.attrs?.[SYNCED_FROM_ATTR]) {
              const sourceId = node.attrs[SYNCED_FROM_ATTR];
              if (!oldRefs.has(sourceId)) oldRefs.set(sourceId, []);
              oldRefs.get(sourceId).push({ node, pos });
              return;
            }
            const id = node.attrs?.id;
            if (id && !oldSources.has(id)) {
              oldSources.set(id, { node, pos });
            }
          });
          const sources = new Map();
          newState.doc.descendants((node, pos) => {
            if (!node.isBlock) return;
            if (node.attrs?.[SYNCED_FROM_ATTR]) return; // only originals are sources
            const id = node.attrs?.id;
            if (id && !sources.has(id)) {
              sources.set(id, { node, pos });
            }
          });
          const syncedNodes = new Map();
          newState.doc.descendants((node, pos) => {
            if (node.isBlock && node.attrs?.[SYNCED_FROM_ATTR]) {
              const sourceId = node.attrs[SYNCED_FROM_ATTR];
              if (!syncedNodes.has(sourceId)) syncedNodes.set(sourceId, []);
              syncedNodes.get(sourceId).push({ node, pos, sourceId });
            }
          });
          sources.forEach((source, sourceId) => {
            const refs = syncedNodes.get(sourceId) || [];
            const locked = isSyncedLocked(sourceId);
            let masterNode = source.node;

            if (!locked) {
              const prevSource = oldSources.get(sourceId)?.node;
              const sourceChanged = !prevSource || !sameSyncedShape(prevSource, source.node);
              const prevRefs = oldRefs.get(sourceId) || [];
              const changedRef = refs.find((ref) => {
                const prior = prevRefs.find((oldRef) => oldRef.node.attrs?.id === ref.node.attrs?.id)?.node;
                return !prior || !sameSyncedShape(prior, ref.node);
              });

              if (!sourceChanged && changedRef) {
                masterNode = changedRef.node;
              }
            }

            if (!locked) {
              // If the master came from a reference, align the source to it; otherwise, keep source as master.
              const sourceAttrs = { ...masterNode.attrs, id: sourceId };
              delete sourceAttrs[SYNCED_FROM_ATTR];
              const desiredSource = masterNode.type.create(sourceAttrs, masterNode.content, masterNode.marks);
              if (!sameSyncedShape(desiredSource, source.node)) {
                tr = tr.replaceWith(source.pos, source.pos + source.node.nodeSize, desiredSource);
                changed = true;
                masterNode = desiredSource;
              }
            }

            refs.forEach(({ node, pos }) => {
              const nextAttrs = { ...masterNode.attrs, id: node.attrs?.id, [SYNCED_FROM_ATTR]: sourceId };
              const desired = masterNode.type.create(nextAttrs, masterNode.content, masterNode.marks);
              const shapesMatch = locked ? node.eq(desired) : sameSyncedShape(node, desired);
              if (!shapesMatch) {
                tr = tr.replaceWith(pos, pos + node.nodeSize, desired);
                changed = true;
              }
            });
          });
          if (changed) {
            tr.setMeta(ORIGIN_META_KEY, 'synced-mirror');
            return tr;
          }
          return null;
        },
      }),
    ];
  },
});
