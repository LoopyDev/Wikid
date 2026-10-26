import { computed, ref } from 'vue';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { ORIGIN_META_KEY, SYNCED_FROM_ATTR } from '../tiptap/editorShared';
import { api } from '../api/client';
import { createSyncedNodeFromSource, findBlockById, resolveWorkspaceSyncedKey, serializeSyncedNode, sourceKey, SYNCED_PAYLOAD_FROM, syncedPayloadContent, withSyncedOrigin, workspaceSyncedKey } from '../tiptap/syncedBlocks';
import { editorDocToTiptap } from '../utils/editorDoc';
import { parseBlockUrl } from '../utils/editorLinks';

// Synced blocks: a block shown on several pages and kept in step. Sources and the pages that
// reference them live in a workspace-wide collab document; locks say which sources can be edited.
export function useSyncedBlocks({ props, workspace, activeWorkspaceId, getResolvedPage, collabDoc, isCollabEnabled, getEditor, getHoveredSyncedSourceId }) {
  const syncedWorkspaceDocName = computed(() => {
    const workspaceId = activeWorkspaceId.value;
    if (!workspaceId) return null;
    return `ws:${workspaceId}:synced-blocks`;
  });
  const fetchBlockFromPage = async (pageId, blockId) => {
    if (!pageId || !blockId) return null;
    if (!workspace.hasApi) return null;
    if (!getEditor()?.schema) return null;
    try {
      const user = workspace.activeUser || {};
      const page = await api.getPage(pageId, { userId: user.id, userName: user.name });
      const docJson = editorDocToTiptap(page?.content || page);
      const pmDoc = getEditor().schema.nodeFromJSON(docJson);
      return findBlockById(pmDoc, blockId);
    } catch (err) {
      console.warn('Failed to fetch block from page', pageId, err);
      return null;
    }
  };
  const isSyncedLocked = (sourceId) => {
    if (!sourceId) return false;
    const resolved = syncedWorkspaceLocksMap.value ? resolveWorkspaceSyncedKey(sourceId, props.pageId) : sourceId;
    if (resolved && unlockedSyncedSources.value.has(resolved)) return false;
    return !unlockedSyncedSources.value.has(sourceId);
  };
  const hasWorkspaceSyncedReference = (blockId) => {
    if (!blockId || !props.pageId) return false;
    const map = syncedWorkspaceRefsMap.value;
    if (!map) return false;
    const key = workspaceSyncedKey(props.pageId, blockId);
    if (!key) return false;
    const entry = map.get(key);
    if (entry instanceof Y.Map) {
      return entry.size > 0;
    }
    return false;
  };
  const syncedWorkspaceDoc = ref(null);
  const syncedWorkspaceProvider = ref(null);
  const syncedWorkspaceMap = ref(null);
  const syncedWorkspaceObserver = ref(null);
  const syncedWorkspaceRefsMap = ref(null);
  const syncedWorkspaceRefsObserver = ref(null);
  const syncedWorkspaceLocksMap = ref(null);
  const syncedWorkspaceLocksObserver = ref(null);
  const syncedWorkspaceRefresh = ref(null);
  const syncedWorkspaceSourceTimer = ref(null);
  const syncedWorkspaceRefsRefresh = ref(null);
  const currentSyncedWorkspaceName = ref(null);
  const syncedLocksMap = ref(null);
  const syncedLocksObserver = ref(null);
  const unlockedSyncedSources = ref(new Set());
  const syncedLockNoticeAt = ref(0);
  const activeLocksMap = () => syncedWorkspaceLocksMap.value || syncedLocksMap.value;
  const syncUnlockedFromMap = (map) => {
    const next = new Set();
    if (map) {
      map.forEach((value, key) => {
        if (value === true) next.add(key);
      });
    }
    unlockedSyncedSources.value = next;
  };
  const refreshUnlockedSyncedSources = () => {
    syncUnlockedFromMap(activeLocksMap());
  };
  const unbindSyncedLocksMap = () => {
    if (syncedLocksMap.value && syncedLocksObserver.value) {
      syncedLocksMap.value.unobserve(syncedLocksObserver.value);
    }
    syncedLocksObserver.value = null;
    syncedLocksMap.value = null;
    refreshUnlockedSyncedSources();
  };
  const bindSyncedLocksMap = (doc) => {
    unbindSyncedLocksMap();
    if (!doc) return;
    const map = doc.getMap('syncedLocks');
    syncedLocksMap.value = map;
    const observer = () => refreshUnlockedSyncedSources();
    map.observe(observer);
    syncedLocksObserver.value = observer;
    refreshUnlockedSyncedSources();
  };
  const createNodeFromSyncedPayload = (payload) => {
    if (!getEditor()?.schema || !payload) return null;
    try {
      return getEditor().schema.nodeFromJSON(syncedPayloadContent(payload));
    } catch {
      return null;
    }
  };
  const applyExternalSyncedUpdates = () => {
    const map = syncedWorkspaceMap.value;
    if (!map || !getEditor()) return;
    const { state, view } = getEditor();
    const localSourceKeys = new Set();
    if (props.pageId) {
      state.doc.descendants((node) => {
        if (!node.isBlock) return;
        if (node.attrs?.[SYNCED_FROM_ATTR]) return;
        const blockId = node.attrs?.id;
        if (!blockId) return;
        const key = workspaceSyncedKey(props.pageId, blockId);
        if (key) localSourceKeys.add(key);
      });
    }
    const replacements = [];
    state.doc.descendants((node, pos) => {
      if (!node.isBlock) return;
      const syncedFrom = node.attrs?.[SYNCED_FROM_ATTR] || null;
      const isReference = !!syncedFrom;
      const blockId = node.attrs?.id || null;
      const key = isReference
        ? resolveWorkspaceSyncedKey(syncedFrom, props.pageId)
        : workspaceSyncedKey(props.pageId, blockId);
      if (!key) return;
      if (isReference && localSourceKeys.has(key)) return;
      const payload = map.get(key);
      if (!payload) return;
      const writtenFrom = payload[SYNCED_PAYLOAD_FROM];
      if (writtenFrom === props.pageId) return;
      if (!isReference && !writtenFrom) return;
      const sourceNode = createNodeFromSyncedPayload(payload);
      if (!sourceNode) return;
      const nextAttrs = { ...sourceNode.attrs, id: blockId };
      if (isReference) {
        nextAttrs[SYNCED_FROM_ATTR] = syncedFrom;
      } else {
        delete nextAttrs[SYNCED_FROM_ATTR];
      }
      const desired = sourceNode.type.create(nextAttrs, sourceNode.content, sourceNode.marks);
      if (!node.eq(desired)) {
        replacements.push({ pos, nodeSize: node.nodeSize, desired });
      }
    });
    if (!replacements.length) return;
    replacements.sort((a, b) => b.pos - a.pos);
    let tr = state.tr;
    replacements.forEach(({ pos, nodeSize, desired }) => {
      tr = tr.replaceWith(pos, pos + nodeSize, desired);
    });
    if (tr.docChanged) {
      tr.setMeta(ORIGIN_META_KEY, 'synced-workspace-refresh');
      view.dispatch(tr);
    }
  };
  const scheduleSyncedWorkspaceRefresh = () => {
    if (syncedWorkspaceRefresh.value) return;
    syncedWorkspaceRefresh.value = requestAnimationFrame(() => {
      syncedWorkspaceRefresh.value = null;
      applyExternalSyncedUpdates();
    });
  };
  const scheduleSyncedWorkspaceDecorationRefresh = () => {
    if (syncedWorkspaceRefsRefresh.value) return;
    syncedWorkspaceRefsRefresh.value = requestAnimationFrame(() => {
      syncedWorkspaceRefsRefresh.value = null;
      if (!getEditor() || getEditor().isDestroyed) return;
      const { state, view } = getEditor();
      view.dispatch(state.tr.setMeta('synced-ref-refresh', true));
    });
  };
  const updateSyncedWorkspaceSourcesFromDoc = () => {
    const map = syncedWorkspaceMap.value;
    const doc = syncedWorkspaceDoc.value;
    if (!map || !doc || !getEditor() || !props.pageId) return;
    const localSourceKeys = new Set();
    getEditor().state.doc.descendants((node) => {
      if (!node.isBlock) return;
      if (node.attrs?.[SYNCED_FROM_ATTR]) return;
      const blockId = node.attrs?.id;
      if (!blockId) return;
      const key = workspaceSyncedKey(props.pageId, blockId);
      if (key) localSourceKeys.add(key);
    });
    const updates = [];
    getEditor().state.doc.descendants((node) => {
      if (!node.isBlock) return;
      const syncedFrom = node.attrs?.[SYNCED_FROM_ATTR] || null;
      const isReference = !!syncedFrom;
      const blockId = node.attrs?.id;
      const key = isReference ? resolveWorkspaceSyncedKey(syncedFrom, props.pageId) : workspaceSyncedKey(props.pageId, blockId);
      if (!key) return;
      if (isReference) {
        if (localSourceKeys.has(key)) return;
        if (isSyncedLocked(syncedFrom)) return;
      } else if (!blockId) {
        return;
      }
      const payload = serializeSyncedNode(node);
      if (!payload) return;
      const existing = map.get(key);
      if (existing && JSON.stringify(syncedPayloadContent(existing)) === JSON.stringify(payload)) return;
      updates.push({ key, payload: withSyncedOrigin(payload, props.pageId) });
    });
    if (!updates.length) return;
    doc.transact(() => {
      updates.forEach(({ key, payload }) => map.set(key, payload));
    }, 'synced-source-update');
  };
  const updateSyncedWorkspaceRefsFromDoc = () => {
    const refsMap = syncedWorkspaceRefsMap.value;
    const doc = syncedWorkspaceDoc.value;
    if (!refsMap || !doc || !getEditor() || !props.pageId) return;
    const pageId = props.pageId;
    const counts = new Map();
    getEditor().state.doc.descendants((node) => {
      if (!node.isBlock) return;
      const syncedFrom = node.attrs?.[SYNCED_FROM_ATTR] || null;
      if (!syncedFrom) return;
      const key = resolveWorkspaceSyncedKey(syncedFrom, pageId);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const previousKeys = [];
    refsMap.forEach((value, key) => {
      if (value instanceof Y.Map && value.has(pageId)) {
        previousKeys.push(key);
      }
    });
    if (!counts.size && !previousKeys.length) return;
    doc.transact(() => {
      previousKeys.forEach((key) => {
        if (counts.has(key)) return;
        const entry = refsMap.get(key);
        if (!(entry instanceof Y.Map)) return;
        entry.delete(pageId);
        if (entry.size === 0) refsMap.delete(key);
      });
      counts.forEach((count, key) => {
        let entry = refsMap.get(key);
        if (!(entry instanceof Y.Map)) {
          entry = new Y.Map();
          refsMap.set(key, entry);
        }
        entry.set(pageId, count);
      });
    }, 'synced-ref-update');
  };
  const scheduleSyncedWorkspaceSourceUpdate = () => {
    if (!syncedWorkspaceDoc.value) return;
    if (syncedWorkspaceSourceTimer.value) return;
    syncedWorkspaceSourceTimer.value = setTimeout(() => {
      syncedWorkspaceSourceTimer.value = null;
      updateSyncedWorkspaceSourcesFromDoc();
      updateSyncedWorkspaceRefsFromDoc();
    }, 120);
  };
  const unbindSyncedWorkspaceLocksMap = () => {
    if (syncedWorkspaceLocksMap.value && syncedWorkspaceLocksObserver.value) {
      syncedWorkspaceLocksMap.value.unobserve(syncedWorkspaceLocksObserver.value);
    }
    syncedWorkspaceLocksObserver.value = null;
    syncedWorkspaceLocksMap.value = null;
    refreshUnlockedSyncedSources();
  };
  const bindSyncedWorkspaceLocksMap = (doc) => {
    unbindSyncedWorkspaceLocksMap();
    if (!doc) return;
    const map = doc.getMap('syncedLocks');
    syncedWorkspaceLocksMap.value = map;
    const observer = () => refreshUnlockedSyncedSources();
    map.observe(observer);
    syncedWorkspaceLocksObserver.value = observer;
    refreshUnlockedSyncedSources();
  };
  const unbindSyncedWorkspaceRefsMap = () => {
    if (syncedWorkspaceRefsMap.value && syncedWorkspaceRefsObserver.value) {
      syncedWorkspaceRefsMap.value.unobserve(syncedWorkspaceRefsObserver.value);
    }
    syncedWorkspaceRefsObserver.value = null;
    syncedWorkspaceRefsMap.value = null;
    scheduleSyncedWorkspaceDecorationRefresh();
  };
  const bindSyncedWorkspaceRefsMap = (doc) => {
    unbindSyncedWorkspaceRefsMap();
    if (!doc) return;
    const map = doc.getMap('syncedRefs');
    syncedWorkspaceRefsMap.value = map;
    const observer = () => scheduleSyncedWorkspaceDecorationRefresh();
    map.observe(observer);
    syncedWorkspaceRefsObserver.value = observer;
    scheduleSyncedWorkspaceDecorationRefresh();
  };
  const unbindSyncedWorkspaceMap = () => {
    if (syncedWorkspaceMap.value && syncedWorkspaceObserver.value) {
      syncedWorkspaceMap.value.unobserve(syncedWorkspaceObserver.value);
    }
    syncedWorkspaceObserver.value = null;
    syncedWorkspaceMap.value = null;
  };
  const bindSyncedWorkspaceMap = (doc) => {
    unbindSyncedWorkspaceMap();
    if (!doc) return;
    const map = doc.getMap('syncedBlocks');
    syncedWorkspaceMap.value = map;
    const observer = (event) => {
      const origin = event?.transaction?.origin;
      if (origin === 'synced-source-update' || origin === 'synced-ref-update') return;
      scheduleSyncedWorkspaceRefresh();
    };
    map.observe(observer);
    syncedWorkspaceObserver.value = observer;
    scheduleSyncedWorkspaceRefresh();
  };
  const handleSyncedWorkspaceSynced = (synced) => {
    if (!synced) return;
    applyExternalSyncedUpdates();
    updateSyncedWorkspaceSourcesFromDoc();
    updateSyncedWorkspaceRefsFromDoc();
  };
  const teardownSyncedWorkspaceProvider = () => {
    if (syncedWorkspaceProvider.value) {
      syncedWorkspaceProvider.value.off?.('synced', handleSyncedWorkspaceSynced);
      syncedWorkspaceProvider.value.destroy();
    }
    syncedWorkspaceProvider.value = null;
    syncedWorkspaceDoc.value = null;
    currentSyncedWorkspaceName.value = null;
    unbindSyncedWorkspaceMap();
    unbindSyncedWorkspaceRefsMap();
    unbindSyncedWorkspaceLocksMap();
  };
  // Stops everything synced blocks are listening to or have scheduled (on unmount).
  const disposeSyncedBlocks = () => {
    teardownSyncedWorkspaceProvider();
    unbindSyncedLocksMap();
    if (syncedWorkspaceRefresh.value) {
      cancelAnimationFrame(syncedWorkspaceRefresh.value);
      syncedWorkspaceRefresh.value = null;
    }
    if (syncedWorkspaceRefsRefresh.value) {
      cancelAnimationFrame(syncedWorkspaceRefsRefresh.value);
      syncedWorkspaceRefsRefresh.value = null;
    }
    if (syncedWorkspaceSourceTimer.value) {
      clearTimeout(syncedWorkspaceSourceTimer.value);
      syncedWorkspaceSourceTimer.value = null;
    }
  };
  const setupSyncedWorkspaceProvider = () => {
    if (!isCollabEnabled.value || !props.collab) {
      teardownSyncedWorkspaceProvider();
      return;
    }
    const name = syncedWorkspaceDocName.value;
    if (!name) {
      teardownSyncedWorkspaceProvider();
      return;
    }
    if (syncedWorkspaceProvider.value && currentSyncedWorkspaceName.value === name) {
      return;
    }
    teardownSyncedWorkspaceProvider();
    const doc = new Y.Doc({ guid: `synced-${name}` });
    syncedWorkspaceDoc.value = doc;
    currentSyncedWorkspaceName.value = name;
    bindSyncedWorkspaceMap(doc);
    bindSyncedWorkspaceRefsMap(doc);
    bindSyncedWorkspaceLocksMap(doc);
    try {
      syncedWorkspaceProvider.value = new HocuspocusProvider({
        url: props.collab.url,
        name,
        token: () => props.collab?.token,
        document: doc,
      });
      syncedWorkspaceProvider.value.on('synced', handleSyncedWorkspaceSynced);
    } catch (err) {
      console.warn('Synced workspace provider failed to initialize', err);
      teardownSyncedWorkspaceProvider();
    }
  };
  const notifySyncedBlockLocked = () => {
    const now = Date.now();
    if (now - syncedLockNoticeAt.value < 1500) return;
    syncedLockNoticeAt.value = now;
    if (typeof window !== 'undefined') {
      window?.alert?.('This synced reference is read-only. Edit the source block or unlock it to make changes.');
    }
  };
  const insertSyncedBlockFromUrl = async (url) => {
    if (!getEditor()) return;
    const parsed = parseBlockUrl(url);
    if (!parsed?.blockId) {
      window.alert('That does not look like a block link.');
      return;
    }
    const currentPage = props.pageId ? getResolvedPage(props.pageId) : null;
    const currentWorkspaceId = currentPage?.workspaceId || workspace.activePageWorkspaceId || null;
    if (!currentWorkspaceId) {
      window.alert('Current page is missing a workspace. Please reload or re-open the page.');
      return;
    }
    const linkWorkspaceId = parsed.workspaceId || currentWorkspaceId;
    if (linkWorkspaceId !== currentWorkspaceId) {
      window.alert('That block link points to a different workspace. Synced blocks must stay within the same workspace.');
      return;
    }
    const targetPageId = parsed.pageId || props.pageId;
    if (!targetPageId) {
      window.alert('Block link is missing a page reference.');
      return;
    }
    let sourceNode = null;
    if (targetPageId === props.pageId) {
      sourceNode = findBlockById(getEditor().state.doc, parsed.blockId)?.node || null;
    }
    const workspaceKey = workspaceSyncedKey(targetPageId, parsed.blockId);
    if (!sourceNode && syncedWorkspaceMap.value && workspaceKey) {
      const payload = syncedWorkspaceMap.value.get(workspaceKey);
      sourceNode = createNodeFromSyncedPayload(payload);
    }
    if (!sourceNode && targetPageId !== props.pageId) {
      const source = await fetchBlockFromPage(targetPageId, parsed.blockId);
      sourceNode = source?.node || null;
    }
    if (!sourceNode) {
      window.alert('Block not found in this workspace.');
      return;
    }
    if (syncedWorkspaceMap.value && syncedWorkspaceDoc.value && workspaceKey) {
      const payload = serializeSyncedNode(sourceNode);
      if (payload) {
        const existing = syncedWorkspaceMap.value.get(workspaceKey);
        if (!existing || JSON.stringify(syncedPayloadContent(existing)) !== JSON.stringify(payload)) {
          syncedWorkspaceDoc.value.transact(() => {
            syncedWorkspaceMap.value.set(workspaceKey, withSyncedOrigin(payload, targetPageId));
          }, 'synced-source-update');
        }
      }
    }
    const fromKey = sourceKey(targetPageId === props.pageId ? null : targetPageId, parsed.blockId);
    const node = createSyncedNodeFromSource(sourceNode, fromKey);
    if (!node) return;
    const { state, view } = getEditor();
    const tr = state.tr.replaceSelectionWith(node, false).scrollIntoView();
    view.dispatch(tr);
    scheduleSyncedWorkspaceRefresh();
  };
  const toggleSyncedLock = () => {
    const sourceId = getHoveredSyncedSourceId();
    if (!sourceId) return;
    const map = activeLocksMap();
    const key = syncedWorkspaceLocksMap.value ? resolveWorkspaceSyncedKey(sourceId, props.pageId) : sourceId;
    if (map) {
      if (!key) return;
      const currentlyUnlocked = map.get(key) === true;
      if (currentlyUnlocked) {
        map.delete(key);
      } else {
        map.set(key, true);
      }
      refreshUnlockedSyncedSources();
      return;
    }
    const next = new Set(unlockedSyncedSources.value);
    const rawKey = key || sourceId;
    if (next.has(rawKey)) next.delete(rawKey);
    else next.add(rawKey);
    unlockedSyncedSources.value = next;
  };

  return { isSyncedLocked, hasWorkspaceSyncedReference, insertSyncedBlockFromUrl, toggleSyncedLock, notifySyncedBlockLocked, bindSyncedLocksMap, unbindSyncedLocksMap, scheduleSyncedWorkspaceRefresh, scheduleSyncedWorkspaceSourceUpdate, setupSyncedWorkspaceProvider, teardownSyncedWorkspaceProvider, disposeSyncedBlocks };
}
