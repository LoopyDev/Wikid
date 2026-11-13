import type * as Y from 'yjs';

// A workspace's synced-blocks document (`ws:<workspace>:synced-blocks`) holds the blocks pages are
// synced from (syncedBlocks), the pages referring to each (syncedRefs) and which are unlocked
// (syncedLocks).
export const SYNCED_BLOCKS_DOC_ID = 'synced-blocks';

const referenced = (entry: unknown) => {
  const size = (entry as { size?: unknown } | null)?.size;
  return typeof size === 'number' && size > 0;
};

/**
 * Takes out every block nothing refers to: everyone in the workspace receives this document, so it
 * holds only what's shared on purpose. (Pages used to copy every block of every page anyone opened
 * into it: megabytes, too big to save, and the blocks of private pages too; tabs still on that
 * version keep doing it until reloaded.) Returns how many were taken out.
 */
export const hasUnreferencedSyncedBlocks = (doc: Y.Doc) => {
  const refs = doc.getMap('syncedRefs');
  return ['syncedBlocks', 'syncedRefs', 'syncedLocks'].some((name) =>
    [...doc.getMap(name).keys()].some((key) => !referenced(refs.get(key)))
  );
};

export function pruneUnreferencedSyncedBlocks(doc: Y.Doc) {
  const blocks = doc.getMap('syncedBlocks');
  const refs = doc.getMap('syncedRefs');
  const locks = doc.getMap('syncedLocks');
  const unreferenced = (map: Y.Map<unknown>) => [...map.keys()].filter((key) => !referenced(refs.get(key)));
  const staleBlocks = unreferenced(blocks);
  const staleRefs = unreferenced(refs);
  const staleLocks = unreferenced(locks);
  if (!staleBlocks.length && !staleRefs.length && !staleLocks.length) return 0;
  doc.transact(() => {
    staleBlocks.forEach((key) => blocks.delete(key));
    staleRefs.forEach((key) => refs.delete(key));
    staleLocks.forEach((key) => locks.delete(key));
  }, 'prune-unreferenced');
  return staleBlocks.length;
}
