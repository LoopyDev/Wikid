import { reactive } from 'vue';
import * as Y from 'yjs';
import { createCollabProvider } from '../services/collabSocket';
import { api } from '../api/client';
import { buildPageLinkFieldsFromCollab, buildPageLinkRowsFromCollab, isPageLinkCollabEmpty, resolvePageLinkRow } from '../utils/pageLinkAttributes';

// Database values shown on page links ("attribute" style): loads the linked database page,
// keeps it live through its collab document, and finds the linked row's values.
export function usePageLinkAttributes({ getResolvedPage, workspace, activeWorkspaceId }) {
  const resolvePageLinkDatabasePageId = (page) => {
    if (!page) return null;
    if (page.kind === 'DATABASE') return null;
    if (page.wikiHomeId && page.wikiHomeId === page.id) return null;
    const parent = page.parentId ? getResolvedPage(page.parentId) : null;
    if (parent?.kind === 'DATABASE') return parent.id;
    if (page.wikiHomeId) {
      const wikiHome = getResolvedPage(page.wikiHomeId);
      const config = wikiHome?.wikiConfig;
      const candidate = config && typeof config === 'object' && !Array.isArray(config) ? config.databasePageId : null;
      return typeof candidate === 'string' && candidate.trim() ? candidate : null;
    }
    return null;
  };

  const pageLinkDatabaseCache = reactive({});
  const pageLinkDatabaseLoading = reactive({});
  const pageLinkDatabaseErrors = reactive({});
  const pageLinkCollabState = new Map();











  const applyPageLinkCollabSnapshot = (databasePageId, state) => {
    if (!databasePageId || !state) return;
    if (isPageLinkCollabEmpty(state) && pageLinkDatabaseCache[databasePageId]) return;
    const fields = buildPageLinkFieldsFromCollab(state.fieldsMap, state.fieldOrder);
    const rows = buildPageLinkRowsFromCollab(state.rowsMap, state.rowOrder);
    pageLinkDatabaseCache[databasePageId] = { fields, rows };
    delete pageLinkDatabaseErrors[databasePageId];
  };

  const schedulePageLinkCollabApply = (databasePageId) => {
    const state = pageLinkCollabState.get(databasePageId);
    if (!state || state.applyScheduled) return;
    state.applyScheduled = true;
    const apply = () => {
      state.applyScheduled = false;
      state.applyFrame = null;
      state.applyTimer = null;
      applyPageLinkCollabSnapshot(databasePageId, state);
    };
    if (typeof requestAnimationFrame === 'function') {
      state.applyFrame = requestAnimationFrame(apply);
    } else {
      state.applyTimer = setTimeout(apply, 0);
    }
  };

  const teardownPageLinkCollabState = (databasePageId) => {
    const state = pageLinkCollabState.get(databasePageId);
    if (!state) return;
    if (state.applyFrame) {
      cancelAnimationFrame(state.applyFrame);
    }
    if (state.applyTimer) {
      clearTimeout(state.applyTimer);
    }
    if (state.provider?.off) {
      state.provider.off('synced', state.syncedHandler);
    }
    state.provider?.destroy?.();
    if (state.observer) {
      state.fieldsMap?.unobserveDeep?.(state.observer);
      state.rowsMap?.unobserveDeep?.(state.observer);
      state.fieldOrder?.unobserve?.(state.observer);
      state.rowOrder?.unobserve?.(state.observer);
    }
    pageLinkCollabState.delete(databasePageId);
  };

  const ensurePageLinkDatabaseCollab = (databasePageId, workspaceId) => {
    if (!databasePageId) return null;
    if (!workspace.collabToken || !workspace.collabUrl) return null;
    const resolvedWorkspaceId = workspaceId || activeWorkspaceId.value || workspace.activeWorkspaceId;
    if (!resolvedWorkspaceId) return null;
    if (workspace.collabWorkspaceId && workspace.collabWorkspaceId !== resolvedWorkspaceId) return null;
    const docName = `ws:${resolvedWorkspaceId}:db:${databasePageId}`;
    const existing = pageLinkCollabState.get(databasePageId);
    if (existing && existing.docName === docName) return existing;
    if (existing) {
      teardownPageLinkCollabState(databasePageId);
    }
    const doc = new Y.Doc({ guid: docName });
    const fieldsMap = doc.getMap('fields');
    const rowsMap = doc.getMap('rows');
    const fieldOrder = doc.getArray('fieldOrder');
    const rowOrder = doc.getArray('rowOrder');
    const state = {
      docName,
      doc,
      fieldsMap,
      rowsMap,
      fieldOrder,
      rowOrder,
      provider: null,
      observer: null,
      syncedHandler: null,
      applyScheduled: false,
      applyFrame: null,
      applyTimer: null,
      hasSynced: false,
    };
    const observer = () => schedulePageLinkCollabApply(databasePageId);
    fieldsMap.observeDeep(observer);
    rowsMap.observeDeep(observer);
    fieldOrder.observe(observer);
    rowOrder.observe(observer);
    state.observer = observer;
    try {
      const provider = createCollabProvider({
        url: workspace.collabUrl,
        name: docName,
        token: () => workspace.collabToken,
        document: doc,
      });
      const syncedHandler = () => {
        state.hasSynced = true;
        schedulePageLinkCollabApply(databasePageId);
      };
      provider.on('synced', syncedHandler);
      state.provider = provider;
      state.syncedHandler = syncedHandler;
    } catch (err) {
      console.warn('Page link collab provider failed to initialize', err);
    }
    pageLinkCollabState.set(databasePageId, state);
    return state;
  };

  const getPageLinkAttributeData = (pageId) => {
    if (!pageId) return null;
    const page = getResolvedPage(pageId);
    const databasePageId = resolvePageLinkDatabasePageId(page);
    const database = databasePageId ? pageLinkDatabaseCache[databasePageId] : null;
    const row = database ? resolvePageLinkRow(database.rows, pageId) : null;
    return { page, databasePageId, database, row };
  };

  const loadPageLinkAttributes = async (pageId) => {
    if (!pageId) return;
    const page = getResolvedPage(pageId);
    const databasePageId = resolvePageLinkDatabasePageId(page);
    if (!databasePageId) return;
    const databasePage = getResolvedPage(databasePageId);
    const collabState = ensurePageLinkDatabaseCollab(databasePageId, databasePage?.workspaceId || page?.workspaceId);
    if (!workspace.hasApi) return;
    const user = workspace.activeUser;
    if (!user) return;
    if (pageLinkDatabaseCache[databasePageId] || pageLinkDatabaseLoading[databasePageId]) return;
    pageLinkDatabaseLoading[databasePageId] = true;
    try {
      const res = await api.getDatabase(databasePageId, { userId: user.id, userName: user.name });
      const shouldApply =
        !collabState ||
        !collabState.hasSynced ||
        isPageLinkCollabEmpty(collabState);
      if (shouldApply) {
        pageLinkDatabaseCache[databasePageId] = {
          fields: Array.isArray(res?.fields) ? res.fields : [],
          rows: Array.isArray(res?.rows) ? res.rows : [],
        };
      }
      delete pageLinkDatabaseErrors[databasePageId];
    } catch (err) {
      pageLinkDatabaseErrors[databasePageId] = err?.message || 'Failed to load attributes';
    } finally {
      delete pageLinkDatabaseLoading[databasePageId];
    }
  };

  return { pageLinkDatabaseLoading, pageLinkDatabaseErrors, pageLinkCollabState, teardownPageLinkCollabState, getPageLinkAttributeData, loadPageLinkAttributes };
}
