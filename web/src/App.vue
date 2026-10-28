<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import { useWorkspaceStore } from './stores/workspace';
import TiptapEditor from './components/TiptapEditor.vue';
import DatabaseTable from './components/DatabaseTable.vue';
import TopBar from './components/TopBar.vue';
import CollabAdminPanel from './components/CollabAdminPanel.vue';
import AdminSettingsPanel from './components/AdminSettingsPanel.vue';
import SearchDialog from './components/SearchDialog.vue';
import WorkspacesAdminPanel from './components/WorkspacesAdminPanel.vue';
import AdminUsersPanel from './components/AdminUsersPanel.vue';
import PageIcon from './components/PageIcon.vue';
import IconPicker from './components/IconPicker.vue';
import PageOverlay from './components/PageOverlay.vue';
import PageProperties from './components/PageProperties.vue';
import DatabaseFormPage from './components/DatabaseFormPage.vue';
import AiSidePanel from './components/AiSidePanel.vue';
import SecondaryPane from './components/SecondaryPane.vue';
import SettingsPopup from './components/SettingsPopup.vue';
import ComplianceSetupModal from './components/ComplianceSetupModal.vue';
import ExportModal from './components/ExportModal.vue';
import CreateWorkspaceModal from './components/CreateWorkspaceModal.vue';
import MoveToWorkspaceModal from './components/MoveToWorkspaceModal.vue';
import LoginPage from './components/LoginPage.vue';
import ChooseNewPassword from './components/ChooseNewPassword.vue';
import UserMenu from './components/UserMenu.vue';
import DeletePageModal from './components/DeletePageModal.vue';
import BinModal from './components/BinModal.vue';
import PageTree from './components/PageTree';
import { api, AUTH_EXPIRED_EVENT, PASSWORD_CHANGE_REQUIRED_EVENT } from './api/client';
import { editorDocToMarkdown, editorDocToMarkdownAsync, fallbackDoc } from './utils/editorDoc';
import { SYSTEM_ADMIN_ID } from './constants/system-admin';
import { CHEVRON_RIGHT } from './constants/icons';

const UNTITLED_PAGE_LABEL = 'Untitled page';

const isDevMode = computed(() => typeof window !== 'undefined' && window.location?.pathname === '/dev');
const workspace = useWorkspaceStore();
// Follow page changes other people make in the open workspace
watch(
  () => [workspace.activeWorkspaceId, workspace.activeUserId, workspace.hasApi, workspace.activeWorkspaceRole],
  () => workspace.syncWorkspaceEvents(),
  { immediate: true },
);
const {
  pages,
  privatePages,
  publicPages,
  workspaces,
  activeWorkspaceId,
  activeWorkspaceRole,
  activePageId,
  doc,
  loadingPages,
  loadingDoc,
  saving,
  error,
  titleDraft,
  privateOpen,
  publicOpen,
} = storeToRefs(workspace);

const pageTitle = computed(() => {
  const draft = typeof titleDraft.value === 'string' ? titleDraft.value : '';
  if (draft !== null && draft !== undefined) {
    const trimmed = draft.trim();
    if (!trimmed) return '';
    if (trimmed.toLowerCase() === UNTITLED_PAGE_LABEL.toLowerCase()) return '';
    return draft;
  }
  const stored = workspace.currentPage?.title;
  if (typeof stored !== 'string') return '';
  const trimmed = stored.trim();
  if (!trimmed) return '';
  if (trimmed.toLowerCase() === UNTITLED_PAGE_LABEL.toLowerCase()) return '';
  return stored;
});
const pageTitleRef = ref(null);
const resizePageTitle = (el = pageTitleRef.value) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};
const activeUser = computed(() => workspace.activeUser);
const activeWorkspaceName = computed(() => workspace.currentWorkspace?.workspace?.name || 'Workspace');
const canEditWorkspace = computed(() => workspace.canEditActiveWorkspace);
// The open page itself can't be edited once someone else has moved it to the Bin.
const canEditPage = computed(() => canEditWorkspace.value && !workspace.activePageRemotelyDeleted);
const remoteDeletionMessage = computed(() => {
  const deletion = workspace.activePageRemotelyDeleted ? workspace.remoteDeletion : null;
  if (!deletion) return '';
  const who = deletion.byMe ? 'You' : deletion.byName || 'Someone';
  if (deletion.pageId === deletion.openPageId) return `${who} moved this page to the Bin.`;
  const parent = deletion.pageTitle ? `"${deletion.pageTitle}"` : 'a page above this one';
  return `${who} moved ${parent} to the Bin, with this page inside it.`;
});
const isAdminUser = computed(() => activeUser.value?.id === SYSTEM_ADMIN_ID);
const activeView = ref('page');
const activeFormId = ref(null);
const pageTransitionKey = computed(() => {
  const workspaceKey = activeWorkspaceId.value || 'workspace';
  if (activeView.value === 'form') {
    return `${workspaceKey}:form:${activeFormId.value || 'form'}`;
  }
  return `${workspaceKey}:${activePageId.value || 'page'}`;
});
const isSysadminView = computed(() => typeof activeView.value === 'string' && activeView.value.startsWith('admin:'));
const isFormView = computed(() => activeView.value === 'form');
const isSetupPage = computed(() => workspace.currentPage?.setupStatus === 'PENDING');
const isDatabasePage = computed(() => !isFormView.value && workspace.currentPage?.kind === 'DATABASE');
const isDocPage = computed(() => !!workspace.currentPage && !isSysadminView.value && !isDatabasePage.value && !isFormView.value);
const isWikiHome = computed(() => {
  const page = workspace.currentPage;
  return !!page && !!page.wikiHomeId && page.wikiHomeId === page.id;
});
const wikiConfig = computed(() => {
  const raw = workspace.currentPage?.wikiConfig;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw;
});
const wikiDatabasePageId = computed(() => wikiConfig.value?.databasePageId || null);
const wikiViews = computed(() => {
  const fromConfig = Array.isArray(wikiConfig.value?.views) ? wikiConfig.value.views : null;
  if (fromConfig && fromConfig.length) return fromConfig;
  const views = [{ id: 'home', name: 'Home', type: 'home' }];
  if (wikiDatabasePageId.value) {
    views.push({ id: 'all-pages', name: 'All Pages', type: 'table', pageId: wikiDatabasePageId.value });
  }
  views.push({ id: 'gallery', name: 'Gallery', type: 'gallery' });
  return views;
});
const wikiViewId = ref('home');
const activeWikiView = computed(() => wikiViews.value.find((view) => view.id === wikiViewId.value) || wikiViews.value[0]);
const showWikiViewSelect = computed(() => isWikiHome.value && wikiViews.value.length > 1);
const showWikiHomeDoc = computed(() => !isWikiHome.value || activeWikiView.value?.type === 'home');
const activeWikiDatabasePageId = computed(() => {
  if (activeWikiView.value?.type !== 'table') return null;
  return activeWikiView.value?.pageId || wikiDatabasePageId.value || null;
});
const showWikiTable = computed(() => isWikiHome.value && !!activeWikiDatabasePageId.value);
const showWikiGallery = computed(() => isWikiHome.value && activeWikiView.value?.type === 'gallery');
const wikiDatabaseCollab = computed(() => {
  const pageId = activeWikiDatabasePageId.value;
  const workspaceId = workspace.currentPage?.workspaceId || workspace.activeWorkspaceId;
  if (!pageId || !workspaceId || !workspace.collabToken || !workspace.collabUrl) return null;
  return { docName: `ws:${workspaceId}:db:${pageId}`, token: workspace.collabToken, url: workspace.collabUrl };
});
const isDocLayout = computed(() => isDocPage.value && showWikiHomeDoc.value);
const useCollabStatus = computed(() => workspace.collabActive && !isDatabasePage.value && showWikiHomeDoc.value);
const showNotConnected = computed(() => !!activeUser.value && !workspace.hasApi && !loadingPages.value);
const editorCollab = computed(() => {
  if (!workspace.collabDocName || !workspace.collabToken) return null;
  return { docName: workspace.collabDocName, token: workspace.collabToken, url: workspace.collabUrl };
});
const rowPageOverlayId = ref(null);
const rowPageOverlayBaseId = ref(null);
const openRowPageOverlay = (pageOrId) => {
  const pageId = typeof pageOrId === 'string' ? pageOrId : pageOrId?.id;
  if (!pageId) return;
  rowPageOverlayId.value = pageId;
  rowPageOverlayBaseId.value = activePageId.value || null;
};
const closeRowPageOverlay = () => {
  rowPageOverlayId.value = null;
  rowPageOverlayBaseId.value = null;
};

provide('openRowPageOverlay', openRowPageOverlay);
const initialRoutePageId = ref(null);
const hasAppliedInitialRoute = ref(false);
const devDoc = ref({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Developer preview: bubble menus on code blocks and images.' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'javascript' },
      content: [{ type: 'text', text: 'console.log(\"Hello bubble menu\");' }],
    },
    {
      type: 'image',
      attrs: {
        src: 'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"320\" height=\"160\" viewBox=\"0 0 320 160\"><rect width=\"320\" height=\"160\" fill=\"%231f2937\"/><text x=\"50%\" y=\"50%\" dominant-baseline=\"middle\" text-anchor=\"middle\" fill=\"%23e5e7eb\" font-size=\"18\" font-family=\"Segoe UI, Arial\">Dev image block</text></svg>',
        alt: 'Dev preview',
      },
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Try hovering the code block and image to see their menus.' }],
    },
  ],
});
const showUserMenu = ref(false);
const showAiPanel = ref(false);
const aiPageContext = ref('');
watchEffect(async () => {
  if (!doc.value || !showAiPanel.value) {
    aiPageContext.value = '';
    return;
  }
  try {
    aiPageContext.value = await editorDocToMarkdownAsync(doc.value, (pageId) =>
      api.getDatabase(pageId, { userId: activeUser.value?.id, userName: activeUser.value?.name }),
    );
  } catch {
    try { aiPageContext.value = editorDocToMarkdown(doc.value); } catch { aiPageContext.value = ''; }
  }
});
const tiptapEditorRef = ref(null);
const aiSuggestionCount = computed(() => tiptapEditorRef.value?.activeSuggestions?.length ?? 0);
const summarizationPending = computed(() => tiptapEditorRef.value?.summarizationPending ?? false);
const summarizationStats = computed(() => tiptapEditorRef.value?.summarizationStats ?? { total: 0, cached: 0 });
const summarizeForAi = () => tiptapEditorRef.value?.summarizeForAi?.();
const handleAiSuggestions = (changes) => {
  tiptapEditorRef.value?.applyAiSuggestions?.(changes);
};
const getSerializedBlocksForAi = async () => await tiptapEditorRef.value?.serializeBlocksForAi?.() ?? [];
// The "move to workspace" dialog: the page being moved, while open.
const moveWorkspacePage = ref(null);
const openMoveToWorkspaceModal = (page) => {
  moveWorkspacePage.value = page;
  menuOpenFor.value = null;
};
const otherWorkspaces = computed(() =>
  workspaces.value.filter((entry) => entry.workspace?.id && entry.workspace.id !== activeWorkspaceId.value)
);

const showCreateWorkspaceModal = ref(false);
// The export dialog: { format, rootPageId } while open.
const exportRequest = ref(null);
const menuOpenFor = ref(null);
const expanded = ref({});
const showEmojiPicker = ref(false);
const showSettingsPopup = ref(false);
const showBinModal = ref(false);
const setupError = ref('');
const setupSaving = ref(false);
const setupAutoCompleteTriggered = ref(false);
const setupSeedDoc = ref(null);
const setupDebugEnabled = () =>
  typeof window !== 'undefined' && window.localStorage?.getItem('wikid:debug-setup') === '1';
const logSetup = (...args) => {
  if (setupDebugEnabled()) {
    console.log('[setup-flow]', ...args);
  }
};
const collabStatusLabel = ref('');
const collabStatusState = ref('');
const collabConnectingVisible = ref(false);
const collabConnectingTimer = ref(null);
const showCollabDisconnected = computed(() => {
  if (!useCollabStatus.value) return false;
  if (collabStatusState.value === 'offline') return true;
  if (collabStatusState.value === 'connecting') return collabConnectingVisible.value;
  return false;
});
const collabSavingShownAt = ref(0);
const collabSavedDelay = ref(null);
const collabPresence = ref([]);
const collabAwarenessHandler = ref(null);
const collabAwarenessSource = ref(null);
const emojiMenuRef = ref(null);
const emojiTriggerRef = ref(null);
const isDarkTheme = ref(true);
const isFullWidthPage = ref(false);
const fullWidthStoragePrefix = 'wikid:page-full-width:';
const loadFullWidthPreference = (pageId) => {
  if (!pageId || typeof localStorage === 'undefined') {
    isFullWidthPage.value = false;
    return;
  }
  const stored = localStorage.getItem(`${fullWidthStoragePrefix}${pageId}`);
  isFullWidthPage.value = stored === 'true';
};
const setFullWidthPreference = (nextValue) => {
  const next = !!nextValue;
  isFullWidthPage.value = next;
  const pageId = activePageId.value;
  if (!pageId || typeof localStorage === 'undefined') return;
  localStorage.setItem(`${fullWidthStoragePrefix}${pageId}`, String(next));
};
const themeModeLabel = computed(() => (isDarkTheme.value ? 'Switch to light mode' : 'Switch to dark mode'));
const showLinksFooter = ref(false);
const titleYText = ref(null);
const titleObserver = ref(null);
const titleSyncedHandler = ref(null);
const collabTitleSaveTimer = ref(null);
const titleSeeded = ref(false);
const boundTitleDoc = ref(null);

const handleApiStatus = (event) => {
  const status = event?.detail?.status;
  if (status === 'offline') {
    workspace.setApiStatus(false);
  } else if (status === 'online') {
    workspace.setApiStatus(true);
  }
};

const handleBrowserOffline = () => {
  workspace.setApiStatus(false);
};

const retryConnection = () => {
  if (!activeUser.value) return;
  workspace.loadInitial();
};
const activeCollabDoc = ref(null);
const activeCollabProvider = ref(null);
const iconYMap = ref(null);
const iconObserver = ref(null);
const collabIconSaveTimer = ref(null);
const boundTitleProvider = ref(null);

const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 520;
const SIDEBAR_HANDLE_WIDTH = 8;
const sidebarWidth = ref(280);
const indentStep = computed(() => Math.max(16, Math.min(28, Math.floor(sidebarWidth.value / 10))));
const isResizing = ref(false);

// Split pane
const splitPageId = ref(null);
const isSplitResizing = ref(false);
const splitContainerRef = ref(null);
const splitPrimaryWidthPx = ref(null); // null = 50/50 flex
const splitResizeStartX = ref(0);
const splitWidthAtStart = ref(0);
const openPageInSplit = (pageId) => {
  splitPageId.value = pageId;
  menuOpenFor.value = null;
};
const closeSplit = () => {
  splitPageId.value = null;
  splitPrimaryWidthPx.value = null;
};
const startSplitResize = (event) => {
  isSplitResizing.value = true;
  splitResizeStartX.value = event.clientX;
  const el = splitContainerRef.value;
  if (el) {
    const primaryEl = el.firstElementChild;
    splitWidthAtStart.value = primaryEl ? primaryEl.getBoundingClientRect().width : el.getBoundingClientRect().width / 2;
  }
  if (typeof document !== 'undefined') {
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }
  event.preventDefault();
};
provide('openPageInSplit', openPageInSplit);
const isSidebarHidden = computed(() => !!workspace.userPreferences?.sidebarHidden);
const isSidebarPeek = ref(false);
const isSidebarHovered = ref(false);
const sidebarRef = ref(null);
const sidebarPeekTimeout = ref(null);
const pointerStartX = ref(0);
const widthAtStart = ref(sidebarWidth.value);
const sidebarHoldOpen = computed(
  () =>
    isSidebarHidden.value &&
    (showUserMenu.value || !!menuOpenFor.value || showSettingsPopup.value || showBinModal.value)
);

const appShellStyle = computed(() => ({
  '--sidebar-width': isSidebarHidden.value ? '0px' : `${sidebarWidth.value}px`,
  '--sidebar-handle-width': isSidebarHidden.value ? '0px' : `${SIDEBAR_HANDLE_WIDTH}px`,
  '--sidebar-panel-width': `${sidebarWidth.value}px`,
}));

const stopResizing = () => {
  if (isResizing.value) {
    isResizing.value = false;
  }
  if (isSplitResizing.value) {
    isSplitResizing.value = false;
  }
  if (typeof document !== 'undefined') {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
};

const handleMouseMove = (event) => {
  if (isResizing.value) {
    const delta = event.clientX - pointerStartX.value;
    sidebarWidth.value = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, widthAtStart.value + delta));
  }
  if (isSplitResizing.value) {
    const containerEl = splitContainerRef.value;
    const containerWidth = containerEl ? containerEl.getBoundingClientRect().width : 0;
    const delta = event.clientX - splitResizeStartX.value;
    const MIN_PANE = 300;
    const newWidth = splitWidthAtStart.value + delta;
    splitPrimaryWidthPx.value = containerWidth
      ? Math.max(MIN_PANE, Math.min(containerWidth - MIN_PANE, newWidth))
      : splitWidthAtStart.value;
  }
};

const startResize = (event) => {
  if (isSidebarHidden.value) return;
  isResizing.value = true;
  pointerStartX.value = event.clientX;
  widthAtStart.value = sidebarWidth.value;
  if (typeof document !== 'undefined') {
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }
  event.preventDefault();
};

const toggleSidebar = (next) => {
  const shouldHide = typeof next === 'boolean' ? next : !isSidebarHidden.value;
  if (shouldHide) {
    stopResizing();
  }
  if (shouldHide === isSidebarHidden.value) return;
  if (!shouldHide) {
    isSidebarPeek.value = false;
    if (sidebarPeekTimeout.value) {
      clearTimeout(sidebarPeekTimeout.value);
      sidebarPeekTimeout.value = null;
    }
  }
  workspace.setSidebarHiddenPreference(shouldHide);
};

const showSidebar = () => toggleSidebar(false);

const clearSidebarPeekTimeout = () => {
  if (sidebarPeekTimeout.value) {
    clearTimeout(sidebarPeekTimeout.value);
    sidebarPeekTimeout.value = null;
  }
};

const openSidebarPeek = () => {
  if (!isSidebarHidden.value) return;
  clearSidebarPeekTimeout();
  isSidebarPeek.value = true;
};

const closeSidebarPeek = (force = false) => {
  clearSidebarPeekTimeout();
  if (!force && sidebarHoldOpen.value) return;
  isSidebarPeek.value = false;
};

const scheduleSidebarPeekClose = (event) => {
  if (!isSidebarHidden.value) return;
  if (sidebarHoldOpen.value) return;
  const target = event?.relatedTarget;
  if (sidebarRef.value && target && (sidebarRef.value === target || sidebarRef.value.contains(target))) {
    return;
  }
  clearSidebarPeekTimeout();
  sidebarPeekTimeout.value = setTimeout(() => {
    if (sidebarHoldOpen.value) {
      sidebarPeekTimeout.value = null;
      return;
    }
    isSidebarPeek.value = false;
    sidebarPeekTimeout.value = null;
  }, 120);
};

const handleSidebarPreview = ({ open, event } = {}) => {
  if (open) {
    openSidebarPeek();
  } else {
    scheduleSidebarPeekClose(event);
  }
};

const handleSidebarMouseEnter = () => {
  isSidebarHovered.value = true;
  if (!isSidebarHidden.value) return;
  openSidebarPeek();
};

const handleSidebarMouseLeave = () => {
  isSidebarHovered.value = false;
  if (!isSidebarHidden.value) return;
  if (sidebarHoldOpen.value) return;
  closeSidebarPeek();
};

watch(
  () => isSidebarHidden.value,
  (hidden) => {
    if (!hidden) {
      isSidebarPeek.value = false;
      clearSidebarPeekTimeout();
    }
  }
);
watch(
  () => sidebarHoldOpen.value,
  (hold) => {
    if (!isSidebarHidden.value) return;
    if (hold) {
      clearSidebarPeekTimeout();
      return;
    }
    if (!isSidebarHovered.value) {
      closeSidebarPeek();
    }
  }
);

const applyTheme = (dark) => {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
};

const cleanupTitleCollab = () => {
  const awareness = collabAwarenessSource.value || activeCollabProvider.value?.awareness;
  if (awareness && collabAwarenessHandler.value) {
    awareness.off('update', collabAwarenessHandler.value);
  }
  collabAwarenessHandler.value = null;
  collabAwarenessSource.value = null;
  collabPresence.value = [];
  const provider = boundTitleProvider.value || activeCollabProvider.value || null;
  if (titleYText.value && titleObserver.value) {
    titleYText.value.unobserve(titleObserver.value);
  }
  if (iconYMap.value && iconObserver.value) {
    iconYMap.value.unobserve(iconObserver.value);
  }
  if (provider?.off && titleSyncedHandler.value) {
    provider.off('synced', titleSyncedHandler.value);
  }
  boundTitleProvider.value = null;
  boundTitleDoc.value = null;
  activeCollabDoc.value = null;
  activeCollabProvider.value = null;
  if (collabTitleSaveTimer.value) {
    clearTimeout(collabTitleSaveTimer.value);
    collabTitleSaveTimer.value = null;
  }
  if (collabIconSaveTimer.value) {
    clearTimeout(collabIconSaveTimer.value);
    collabIconSaveTimer.value = null;
  }
  titleYText.value = null;
  titleObserver.value = null;
  titleSyncedHandler.value = null;
  titleSeeded.value = false;
  iconYMap.value = null;
  iconObserver.value = null;
};

const persistCollabTitle = (rawTitle) => {
  if (!workspace.hasApi || !workspace.activePageId) return;
  if (!canEditPage.value) return;
  const user = activeUser.value;
  if (!user) return;
  if (collabTitleSaveTimer.value) {
    clearTimeout(collabTitleSaveTimer.value);
  }
  const payload = rawTitle || '';
  collabTitleSaveTimer.value = setTimeout(async () => {
    collabTitleSaveTimer.value = null;
    try {
      await api.updatePageTitle(workspace.activePageId, payload, { userId: user.id, userName: user.name });
    } catch (err) {
      console.warn('Collab title save failed', err);
    }
  }, 350);
};

const persistCollabIcon = (rawIcon) => {
  if (!workspace.hasApi || !workspace.activePageId) return;
  if (!canEditPage.value) return;
  const user = activeUser.value;
  if (!user) return;
  if (collabIconSaveTimer.value) {
    clearTimeout(collabIconSaveTimer.value);
  }
  const payload = rawIcon || null;
  collabIconSaveTimer.value = setTimeout(async () => {
    collabIconSaveTimer.value = null;
    try {
      await api.updatePageIcon(workspace.activePageId, payload, { userId: user.id, userName: user.name });
    } catch (err) {
      console.warn('Collab icon save failed', err);
    }
  }, 350);
};

const applyTitleFromY = (options = {}) => {
  if (!titleYText.value) return;
  const allowEmpty = !!options.allowEmpty;
  const next = titleYText.value.toString();
  const trimmed = next.trim();
  const hasExistingTitle = !!(workspace.currentPage?.title || titleDraft.value || '').trim();
  if (!allowEmpty && !trimmed && hasExistingTitle) {
    // Avoid clobbering an already-known title with an empty Y doc before sync completes.
    return;
  }
  workspace.applyCollabTitle(next);
};

const writeCollabTitle = (value, origin = 'title-local') => {
  if (!titleYText.value) return false;
  const current = titleYText.value.toString();
  titleYText.value.doc?.transact(() => {
    if (current) {
      titleYText.value.delete(0, current.length);
    }
    if (value) {
      titleYText.value.insert(0, value);
    }
  }, origin);
  return true;
};

const handleTitleYChange = (event) => {
  const origin = event?.transaction?.origin ?? event?.state;
  const nextTitle = titleYText.value?.toString() || '';
  const trimmedNext = nextTitle.trim();
  const previousTitle = workspace.currentPage?.title || '';
  // Only allow clearing the title from local user input, not from sync/initialization
  // which may deliver an empty Yjs doc before the title has been seeded.
  const isLocal = origin === 'title-local' || origin === 'title-seed';
  applyTitleFromY({ allowEmpty: isLocal });
  if (isLocal) {
    persistCollabTitle(trimmedNext);
  } else if (trimmedNext && (!previousTitle || previousTitle === 'Untitled page')) {
    // Backfill persisted title when it arrives from the collab doc but the DB still has none.
    persistCollabTitle(trimmedNext);
  }
};

const applyIconFromY = () => {
  if (!iconYMap.value) return;
  const next = iconYMap.value.get('icon') || null;
  // Before the server's copy arrives the live copy has no icon yet: keep showing the saved one
  if (!next && !boundTitleProvider.value?.isSynced) return;
  workspace.applyCollabIcon(next);
};

const handleIconYChange = (event) => {
  applyIconFromY();
  const origin = event?.transaction?.origin ?? event?.state;
  if (origin === 'icon-local') {
    persistCollabIcon(iconYMap.value?.get('icon') || null);
  }
};

// Repairs titles doubled by a bug in October 2026 (a title seeded before the server's copy
// arrived): the live title is the saved one repeated, which nobody types. Only the live copy was
// doubled, so the saved title comes from the server (the one here already shows the live title).
const repeatsOf = (text, unit) => !!unit && text.length > unit.length && text.length % unit.length === 0 && unit.repeat(text.length / unit.length) === text;
const looksRepeated = (text) => {
  for (let length = 1; length <= text.length / 2; length += 1) {
    if (repeatsOf(text, text.slice(0, length))) return true;
  }
  return false;
};
const repairDoubledTitle = async (doc) => {
  const pageId = workspace.activePageId;
  if (!pageId || !titleYText.value || !looksRepeated(titleYText.value.toString())) return;
  let saved = '';
  try {
    saved = ((await api.getPage(pageId, { userId: activeUser.value?.id, userName: activeUser.value?.name }))?.title || '').trim();
  } catch {
    return;
  }
  // Still the same page, and still doubled
  if (boundTitleDoc.value !== doc || !titleYText.value || !repeatsOf(titleYText.value.toString(), saved)) return;
  writeCollabTitle(saved, 'title-repair');
};

const setupTitleCollab = () => {
  if (isDatabasePage.value) {
    cleanupTitleCollab();
    return;
  }
  const doc = activeCollabDoc.value;
  const provider = activeCollabProvider.value;
  if (!workspace.collabActive || !doc || !provider) {
    cleanupTitleCollab();
    return;
  }
  if (boundTitleDoc.value === doc && titleYText.value) {
    return;
  }
  cleanupTitleCollab();
  boundTitleDoc.value = doc;
  titleYText.value = doc.getText('title');
  const observer = (event) => handleTitleYChange(event);
  titleYText.value.observe(observer);
  titleObserver.value = observer;
  iconYMap.value = doc.getMap('meta');
  const iconObs = (event) => handleIconYChange(event);
  iconYMap.value.observe(iconObs);
  iconObserver.value = iconObs;
  const syncedHandler = ({ state }) => {
    // Seed from the current page icon, once the server's copy is here (not before, or it could
    // replace a newer one)
    if (state && iconYMap.value && !iconYMap.value.get('icon') && workspace.currentPage?.icon) {
      iconYMap.value.set('icon', workspace.currentPage.icon);
    }
    if (state && titleYText.value) {
      repairDoubledTitle(doc);
      const hasTitle = titleYText.value.length > 0;
      const localTitle = (workspace.currentPage?.title || titleDraft.value || '').trim();
      const hasLocalTitle = !!localTitle && localTitle !== 'Untitled page';
      if (!hasTitle && hasLocalTitle && !titleSeeded.value) {
        writeCollabTitle(localTitle, 'title-seed');
        titleSeeded.value = true;
      }
    }
  };
  provider.on('synced', syncedHandler);
  titleSyncedHandler.value = syncedHandler;
  boundTitleProvider.value = provider;
  if (provider.isSynced) syncedHandler({ state: true });
  // Apply the latest collab state so the UI reflects the synced title/icon.
  applyTitleFromY();
  applyIconFromY();
};

onMounted(() => {
  if (isDevMode.value) {
    applyTheme(isDarkTheme.value);
    return;
  }
  applyInitialRoute();
  const savedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('wikid:theme') : null;
  if (savedTheme === 'light' || savedTheme === 'dark') {
    isDarkTheme.value = savedTheme === 'dark';
    applyTheme(isDarkTheme.value);
  } else {
    applyTheme(isDarkTheme.value);
  }
  workspace.restoreUserFromStorage();
  workspace.loadInitial();
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', stopResizing);
  window.addEventListener('mousedown', handlePageMenuOutsideClick);
  window.addEventListener('mousedown', handleEmojiClickOutside);
  window.addEventListener('keydown', handleEmojiKeydown);
  window.addEventListener('keydown', handleSearchShortcut);
  window.addEventListener('hashchange', focusBlockFromHash);
  window.addEventListener('wikid:api-status', handleApiStatus);
  window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, handlePasswordChangeRequired);
  window.addEventListener('wikid:page-title-updated', handleExternalTitleUpdated);
  window.addEventListener('offline', handleBrowserOffline);
  setTimeout(() => focusBlockFromHash(), 120);
});

watch(
  () => [
    workspace.collabActive,
    workspace.collabDocName,
    workspace.collabToken,
    activePageId.value,
  ],
  () => {
    setupTitleCollab();
  },
  { immediate: true }
);

watch(
  () => [activeCollabDoc.value, activeCollabProvider.value],
  () => setupTitleCollab(),
  { immediate: true }
);


watch(
  () => workspace.loadingDoc,
  (loading) => {
    if (!loading) {
      setTimeout(() => focusBlockFromHash(), 100);
    }
  },
  { immediate: true }
);

watch(
  () => activePageId.value,
  (pageId) => {
    loadFullWidthPreference(pageId);
  },
  { immediate: true }
);

watch(
  pageTitle,
  () => {
    nextTick(() => resizePageTitle());
  },
  { immediate: true }
);
watch(pageTitleRef, (el) => {
  if (el) nextTick(() => resizePageTitle(el));
});

onBeforeUnmount(() => {
  cleanupTitleCollab();
  if (collabSavedDelay.value) {
    clearTimeout(collabSavedDelay.value);
    collabSavedDelay.value = null;
  }
  if (collabConnectingTimer.value) {
    clearTimeout(collabConnectingTimer.value);
    collabConnectingTimer.value = null;
  }
  if (isDevMode.value) return;
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', stopResizing);
  window.removeEventListener('mousedown', handlePageMenuOutsideClick);
  window.removeEventListener('mousedown', handleEmojiClickOutside);
  window.removeEventListener('keydown', handleEmojiKeydown);
  window.removeEventListener('keydown', handleSearchShortcut);
  window.removeEventListener('hashchange', focusBlockFromHash);
  window.removeEventListener('wikid:api-status', handleApiStatus);
  window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, handlePasswordChangeRequired);
  window.removeEventListener('wikid:page-title-updated', handleExternalTitleUpdated);
  window.removeEventListener('offline', handleBrowserOffline);
  stopResizing();
});

const selectPage = (page) => {
  activeView.value = 'page';
  workspace.selectPage(page);
};
const openRowPageFull = (pageId) => {
  if (!pageId) return;
  closeRowPageOverlay();
  const page = pages.value.find((item) => item.id === pageId) || null;
  if (page) {
    activeView.value = 'page';
    workspace.selectPage(page, { allowHidden: true });
    return;
  }
  if (workspace.hasApi) {
    activeView.value = 'page';
    workspace.loadPageDoc(pageId);
  }
};
const openFormPage = (formId) => {
  if (!formId) return;
  closeRowPageOverlay();
  activeView.value = 'form';
  activeFormId.value = formId;
  updateUrlForForm(formId);
};
provide('openFormPage', openFormPage);
const handleFormOpenPage = (pageId) => {
  if (!pageId) return;
  openRowPageFull(pageId);
};
const hasSetupContent = (node) => {
  if (!node) return false;
  if (node.type === 'text') return typeof node.text === 'string' && node.text.trim().length > 0;
  const content = Array.isArray(node.content) ? node.content : [];
  if (content.length > 0) return content.some(hasSetupContent);
  return node.type && node.type !== 'doc' && node.type !== 'paragraph';
};
const handleUpdateDoc = async (updated) => {
  workspace.updateDoc(updated);
  const hasContent = hasSetupContent(updated);
  if (isSetupPage.value && hasContent) {
    setupSeedDoc.value = updated;
    logSetup('seed-doc', { captured: true });
  }
  if (!isSetupPage.value || setupAutoCompleteTriggered.value || setupSaving.value || !canEditPage.value) {
    logSetup('update', {
      setup: isSetupPage.value,
      triggered: setupAutoCompleteTriggered.value,
      saving: setupSaving.value,
      canEdit: canEditPage.value,
    });
    return;
  }
  if (!hasContent) {
    logSetup('update-empty', { setup: isSetupPage.value });
    return;
  }
  setupAutoCompleteTriggered.value = true;
  logSetup('auto-complete-start');
  try {
    await workspace.saveDoc();
    logSetup('auto-complete-saved');
  } catch (err) {
    logSetup('auto-complete-save-failed', err?.message || err);
  }
  const success = await chooseSetupKind('DOC');
  if (!success) {
    setupAutoCompleteTriggered.value = false;
  }
};
const handleCollabStatus = ({ text, state }) => {
  const nextState = state || '';
  const nextText = text || '';
  const clearDelay = () => {
    if (collabSavedDelay.value) {
      clearTimeout(collabSavedDelay.value);
      collabSavedDelay.value = null;
    }
  };
  if (collabConnectingTimer.value) {
    clearTimeout(collabConnectingTimer.value);
    collabConnectingTimer.value = null;
  }
  if (nextState === 'connecting') {
    collabConnectingVisible.value = false;
    collabConnectingTimer.value = setTimeout(() => {
      collabConnectingVisible.value = collabStatusState.value === 'connecting';
      collabConnectingTimer.value = null;
    }, 900);
  } else {
    collabConnectingVisible.value = false;
  }
  if (nextState === 'saving') {
    collabSavingShownAt.value = Date.now();
    clearDelay();
    collabStatusLabel.value = nextText || 'Saving...';
    collabStatusState.value = 'saving';
    return;
  }
  if (nextState === 'saved') {
    const elapsed = collabSavingShownAt.value ? Date.now() - collabSavingShownAt.value : Infinity;
    const delay = Math.max(0, 1000 - elapsed);
    clearDelay();
    collabSavedDelay.value = setTimeout(() => {
      collabStatusLabel.value = nextText || 'Saved';
      collabStatusState.value = 'saved';
      collabSavedDelay.value = null;
      collabSavingShownAt.value = 0;
    }, delay);
    return;
  }
  clearDelay();
  collabStatusLabel.value = nextText;
  collabStatusState.value = nextState;
};
const notifyTitleUpdated = (pageId, title) => {
  if (typeof window === 'undefined' || !pageId) return;
  window.dispatchEvent(
    new CustomEvent('wikid:page-title-updated', {
      detail: { pageId, title },
    })
  );
};
const handleExternalTitleUpdated = (event) => {
  const detail = event?.detail || null;
  const pageId = detail?.pageId;
  if (!pageId) return;
  const nextTitle = typeof detail.title === 'string' ? detail.title : detail.title == null ? '' : String(detail.title);
  const existing = workspace.pages.find((page) => page.id === pageId) || null;
  if (existing && existing.title !== nextTitle) {
    const now = new Date().toISOString();
    workspace.updatePageInLists(pageId, (page) => ({ ...page, title: nextTitle, updatedAt: now }));
  }
  if (pageId !== activePageId.value) return;
  if (titleDraft.value !== nextTitle) {
    titleDraft.value = nextTitle;
  }
  if (workspace.collabActive && titleYText.value && titleYText.value.toString() !== nextTitle) {
    writeCollabTitle(nextTitle, 'title-external');
  }
};
const attachAwarenessListener = () => {
  const awareness = activeCollabProvider.value?.awareness || null;
  if (collabAwarenessSource.value && collabAwarenessHandler.value) {
    collabAwarenessSource.value.off('update', collabAwarenessHandler.value);
  }
  collabAwarenessHandler.value = null;
  collabAwarenessSource.value = awareness;
  if (awareness) {
    const handler = () => updateCollabPresence();
    awareness.on('update', handler);
    collabAwarenessHandler.value = handler;
    updateCollabPresence();
  } else {
    collabPresence.value = [];
  }
};

const handleCollabReady = (payload) => {
  const nextDoc = payload?.doc || null;
  const nextProvider = payload?.provider || null;
  const docChanged = nextDoc !== activeCollabDoc.value;
  const providerChanged = nextProvider !== activeCollabProvider.value;
  if (!docChanged && !providerChanged) return;
  activeCollabDoc.value = nextDoc;
  activeCollabProvider.value = nextProvider;
  attachAwarenessListener();
  setupTitleCollab();
};
const handleDatabasePresence = (presence) => {
  if (!isDatabasePage.value && !showWikiTable.value) return;
  if (!Array.isArray(presence)) return;
  collabPresence.value = presence;
};
const handleTitleInput = (event) => {
  if (!canEditPage.value) return;
  const target = event?.target;
  const value = target?.value ?? '';
  resizePageTitle(target);
  if (workspace.collabActive && titleYText.value) {
    handleCollabStatus({ text: 'Saving...', state: 'saving' });
    writeCollabTitle(value, 'title-local');
    workspace.applyCollabTitle(value);
    notifyTitleUpdated(activePageId.value, value);
    return;
  }
  workspace.updateTitleDraft(value);
  notifyTitleUpdated(activePageId.value, value);
};

const handleTitleEnter = (event) => {
  if (!canEditPage.value) return;
  if (isDatabasePage.value) return;
  if (!showWikiHomeDoc.value) return;
  event?.preventDefault?.();
  const editorRef = tiptapEditorRef.value;
  if (editorRef?.insertParagraphAtTop) {
    editorRef.insertParagraphAtTop();
  }
};

const openExportModal = (format) => {
  exportRequest.value = { format: format || 'html', rootPageId: workspace.currentPage?.id || null };
};
const exportWorkspaceData = () => {
  const fileSafeName = (activeWorkspaceName.value || 'workspace')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
  const payload = {
    workspaceName: activeWorkspaceName.value,
    exportedAt: new Date().toISOString(),
    activePageId: activePageId.value,
    pages: workspace.pages.map((page) => ({
      id: page.id,
      title: page.title,
      parentId: page.parentId ?? null,
      workspaceId: page.workspaceId,
      icon: page.icon ?? null,
    })),
    currentPageDoc: doc.value,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `wikid-workspace-${fileSafeName}.json`;
  link.click();
  URL.revokeObjectURL(url);
};

const sanitizePathSegment = (value, fallback) => {
  const cleaned = (String(value || '') || '')
    .trim()
    .replace(/[\/\\\?\%\*\:\|"<>\.]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback || 'untitled';
};

const buildBreadcrumb = (page, pageMap) => {
  const segments = [];
  let current = page;
  while (current) {
    segments.unshift(sanitizePathSegment(current.title, current.id));
    const parentId = current.parentId ?? null;
    current = parentId ? pageMap.get(parentId) : null;
  }
  return segments.filter(Boolean).join('/') || sanitizePathSegment(page.title, page.id);
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const createZipBlob = (entries) => {
  const encoder = new TextEncoder();
  const headerChunks = [];
  const centralChunks = [];
  let offset = 0;

  entries.forEach(({ path, data }) => {
    const fileBytes = data instanceof Uint8Array ? data : encoder.encode(String(data));
    const nameBytes = encoder.encode(path);
    const checksum = crc32(fileBytes);
    const entryOffset = offset;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, fileBytes.length, true);
    localView.setUint32(22, fileBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    headerChunks.push(localHeader);
    headerChunks.push(fileBytes);
    offset += localHeader.length + fileBytes.length;

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    let ptr = 0;
    centralView.setUint32(ptr, 0x02014b50, true);
    ptr += 4;
    centralView.setUint16(ptr, 20, true);
    ptr += 2;
    centralView.setUint16(ptr, 20, true);
    ptr += 2;
    centralView.setUint16(ptr, 0, true);
    ptr += 2;
    centralView.setUint16(ptr, 0, true);
    ptr += 2;
    centralView.setUint16(ptr, 0, true);
    ptr += 2;
    centralView.setUint16(ptr, 0, true);
    ptr += 2;
    centralView.setUint32(ptr, checksum, true);
    ptr += 4;
    centralView.setUint32(ptr, fileBytes.length, true);
    ptr += 4;
    centralView.setUint32(ptr, fileBytes.length, true);
    ptr += 4;
    centralView.setUint16(ptr, nameBytes.length, true);
    ptr += 2;
    centralView.setUint16(ptr, 0, true);
    ptr += 2;
    centralView.setUint16(ptr, 0, true);
    ptr += 2;
    centralView.setUint16(ptr, 0, true);
    ptr += 2;
    centralView.setUint16(ptr, 0, true);
    ptr += 2;
    centralView.setUint32(ptr, 0, true);
    ptr += 4;
    centralView.setUint32(ptr, entryOffset, true);
    ptr += 4;
    centralHeader.set(nameBytes, ptr);
    centralChunks.push(centralHeader);
  });

  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const endOfCentral = new Uint8Array(22);
  const endView = new DataView(endOfCentral.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, centralChunks.length, true);
  endView.setUint16(10, centralChunks.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...headerChunks, ...centralChunks, endOfCentral], { type: 'application/zip' });
};

const exportWorkspaceMarkdown = async () => {
  if (!workspace.activeUser || !workspace.pages.length) {
    return;
  }
  const pageMap = new Map(workspace.pages.map((page) => [page.id, page]));
  const userId = workspace.activeUser.id;
  const userName = workspace.activeUser.name;
  const encoder = new TextEncoder();
  const entryPromises = await Promise.all(
    workspace.pages.map(async (page, index) => {
      try {
        const pageData = await api.getPage(page.id, { userId, userName });
        const doc = pageData?.content ?? fallbackDoc;
        const markdown = await editorDocToMarkdownAsync(doc, (pageId) =>
          api.getDatabase(pageId, { userId, userName }),
        );
        const filePath = `${buildBreadcrumb(page, pageMap)}.md`;
        const data = encoder.encode(markdown || '');
        return { index, entry: { path: filePath, data } };
      } catch (err) {
        console.error('Failed to fetch page for markdown export', err);
        return null;
      }
    })
  );
  const entries = entryPromises
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)
    .map(({ entry }) => entry);
  if (!entries.length) {
    return;
  }
  const fileSafeName = (activeWorkspaceName.value || 'workspace')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
  const blob = createZipBlob(entries);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `wikid-markdown-${fileSafeName}.zip`;
  link.click();
  URL.revokeObjectURL(url);
};

const isPointerInSidebar = (event) => {
  if (!event || !sidebarRef.value) return false;
  const { clientX, clientY } = event;
  if (typeof clientX !== 'number' || typeof clientY !== 'number') return false;
  const rect = sidebarRef.value.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
};
const toggleUserMenu = (event) => {
  const willOpen = !showUserMenu.value;
  if (!willOpen && isSidebarHidden.value && isPointerInSidebar(event)) {
    isSidebarHovered.value = true;
    openSidebarPeek();
  }
  showUserMenu.value = willOpen;
};
const handleLogout = () => {
  showUserMenu.value = false;
  workspace.logout();
};
// Session cookie missing or expired: drop the cached user so the login screen shows
const handleAuthExpired = () => {
  if (workspace.activeUserId) workspace.logout();
};
const handlePasswordChangeRequired = () => workspace.requirePasswordChange();

// Search (sidebar button or Cmd/Ctrl+K).
const showSearch = ref(false);
const searchShortcutLabel =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';
const openSearch = () => {
  closeMenu();
  showUserMenu.value = false;
  showSearch.value = true;
};
const openSearchResult = (pageId) => {
  showSearch.value = false;
  openRowPageFull(pageId);
};
const handleSearchShortcut = (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
  if (!activeUser.value || workspace.mustChangePassword) return;
  event.preventDefault();
  if (showSearch.value) showSearch.value = false;
  else openSearch();
};
const openAdminView = (view) => {
  closeMenu();
  showUserMenu.value = false;
  showSettingsPopup.value = false;
  activeView.value = view;
};
const openSettingsPopup = () => {
  closeMenu();
  showUserMenu.value = false;
  showSettingsPopup.value = true;
};
const closeSettingsPopup = () => {
  showSettingsPopup.value = false;
};
const toggleThemeMode = () => {
  isDarkTheme.value = !isDarkTheme.value;
  applyTheme(isDarkTheme.value);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('wikid:theme', isDarkTheme.value ? 'dark' : 'light');
  }
};
const selectWorkspace = async (workspaceId) => {
  if (!workspaceId) return;
  activeView.value = 'page';
  await workspace.selectWorkspaceById(workspaceId);
};
const selectWorkspaceFromMenu = async (workspaceId) => {
  showUserMenu.value = false;
  await selectWorkspace(workspaceId);
};
const openCreateWorkspaceModal = () => {
  showUserMenu.value = false;
  showCreateWorkspaceModal.value = true;
};
// keep old name so the "Create workspace" button in the empty-state still works
const createWorkspace = openCreateWorkspaceModal;
const createSetupPage = async (visibility) => {
  if (!activeWorkspaceId.value || !canEditWorkspace.value) return;
  activeView.value = 'page';
  showEmojiPicker.value = false;
  setupError.value = '';
  try {
    await workspace.createSetupPage(visibility || 'PUBLIC');
  } catch (err) {
    setupError.value = err?.message || 'Failed to create page';
  }
};
// The compliance setup dialog, opened by requestComplianceSetup; resolves with its result, or null.
const complianceSetupRequest = ref(null);
const requestComplianceSetup = (options = {}) => {
  if (!canEditWorkspace.value) return Promise.resolve(null);
  complianceSetupRequest.value?.resolve(null);
  return new Promise((resolve) => {
    complianceSetupRequest.value = {
      resolve,
      options: {
        allowTitle: options.allowTitle === true,
        defaultTitle: typeof options.defaultTitle === 'string' ? options.defaultTitle : 'Untitled database',
        template: options.template,
      },
    };
  });
};
const finishComplianceSetup = (result) => {
  const request = complianceSetupRequest.value;
  complianceSetupRequest.value = null;
  request?.resolve(result);
};
const handleComplianceSetup = async () => {
  if (!workspace.currentPage || !canEditPage.value) return;
  const result = await requestComplianceSetup({
    allowTitle: false,
    defaultTitle: workspace.currentPage?.title || 'Untitled database',
    template: 'inventory',
  });
  if (!result) return;
  await chooseSetupKind('DATABASE', { complianceMode: true, database: result.database });
};
const chooseSetupKind = async (kind, options = {}) => {
  if (!workspace.currentPage || !workspace.activeUser || !canEditPage.value) return false;
  setupSaving.value = true;
  setupError.value = '';
  let success = false;
  logSetup('setup-kind-start', { kind });
  try {
    const payload = {
      kind,
      setupStatus: 'COMPLETE',
    };
    if (typeof options.complianceMode === 'boolean') {
      payload.complianceMode = options.complianceMode;
    }
    if (options.database) {
      payload.database = options.database;
    }
    const updated = await workspace.updatePageSetup(workspace.currentPage.id, payload);
    if (!updated) {
      setupError.value = workspace.error || 'Failed to finish setup';
    } else {
      success = true;
    }
  } catch (err) {
    setupError.value = err?.message || 'Failed to finish setup';
  } finally {
    setupSaving.value = false;
  }
  logSetup('setup-kind-finish', { kind, success });
  return success;
};
const toggleMenu = (pageId) => {
  menuOpenFor.value = menuOpenFor.value === pageId ? null : pageId;
};
const closeMenu = () => {
  menuOpenFor.value = null;
};
const handlePageMenuOutsideClick = (event) => {
  if (!menuOpenFor.value) return;
  const target = event?.target;
  if (target?.closest?.('.page-menu') || target?.closest?.('.page-menu-btn')) {
    return;
  }
  closeMenu();
};
const buildChildrenMap = (pages) => {
  const childrenMap = new Map();
  pages.forEach((page) => {
    const parentId = page.parentId ?? null;
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId).push(page);
  });
  childrenMap.forEach((list, key) => {
    list.sort((a, b) => {
      const posA = Number(a.position ?? 0);
      const posB = Number(b.position ?? 0);
      if (posA === posB) return (a.createdAt || 0) > (b.createdAt || 0) ? 1 : -1;
      return posA - posB;
    });
  });
  return childrenMap;
};
const traverseSubtree = (rootId, pages, callback) => {
  const childrenMap = buildChildrenMap(pages);
  const stack = [rootId];
  const visited = new Set();
  while (stack.length) {
    const currentId = stack.pop();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    callback(currentId);
    const children = childrenMap.get(currentId);
    if (children) {
      children.forEach((child) => {
        stack.push(child.id);
      });
    }
  }
};
const expandSubtree = (rootId, pages) => {
  traverseSubtree(rootId, pages, (id) => {
    expanded.value[id] = true;
  });
};
const collapseSubtree = (rootId, pages) => {
  traverseSubtree(rootId, pages, (id) => {
    expanded.value[id] = false;
  });
};
const toggleTreeExpansion = (page, pages, shouldCollapse) => {
  if (shouldCollapse) {
    collapseSubtree(page.id, pages);
  } else {
    expandSubtree(page.id, pages);
  }
  closeMenu();
};

const promptRename = (page) => {
  const nextTitle = window.prompt('Rename page', page.title || 'Untitled page');
  if (nextTitle !== null && nextTitle.trim() !== '') {
    workspace.renamePage(page, nextTitle.trim());
  }
  closeMenu();
};
const duplicatePage = (page) => {
  workspace.duplicatePage(page);
  closeMenu();
};
const convertToWiki = async (page) => {
  if (!page?.id) return;
  await workspace.convertPageToWiki(page.id);
  wikiViewId.value = 'home';
  closeMenu();
};
const movePageVisibility = async (page) => {
  const target = page?.visibility === 'PRIVATE' ? 'PUBLIC' : 'PRIVATE';
  await workspace.movePageVisibility(page, target);
  closeMenu();
};
const deletePage = (page) => {
  closeMenu();
  confirmDeletePage(page);
};
const exportPageHtml = (page) => {
  closeMenu();
  exportRequest.value = { format: 'html', rootPageId: page?.id || null };
};
const addChildPage = async (page) => {
  await workspace.addChildPage(page);
  if (page?.id) {
    expanded.value[page.id] = true;
  }
  closeMenu();
};
const setPageIcon = (page) => {
  const nextIcon = window.prompt('Set icon (emoji or text)', page.icon || '');
  if (nextIcon !== null) {
    const trimmed = nextIcon.trim();
    if (workspace.collabActive && iconYMap.value) {
      handleCollabStatus({ text: 'Saving...', state: 'saving' });
      iconYMap.value.doc?.transact(() => {
        iconYMap.value.set('icon', trimmed || null);
      }, 'icon-local');
      workspace.applyCollabIcon(trimmed || null);
      persistCollabIcon(trimmed || null);
    } else {
      workspace.setPageIcon(page, trimmed);
    }
  }
  closeMenu();
};

const isExpanded = (id) => !!expanded.value[id];
// Opens these pages in the sidebar, e.g. parents restored from the Bin with a sub-page
const expandPages = (ids) => ids.forEach((id) => { expanded.value[id] = true; });
const toggleExpand = (id) => {
  expanded.value[id] = !expanded.value[id];
};

const prefetchSidebarPage = (page) => workspace.prefetchPage(page?.id);

const handlePageItemClick = (page) => {
  if (activePageId.value === page.id) {
    toggleExpand(page.id);
  } else {
    selectPage(page);
  }
};

watch(
  () => activePageId.value,
  (id) => {
    if (activeView.value !== 'page') return;
    updateUrlForPage(id);
  }
);

watch(
  () => activeFormId.value,
  (id) => {
    if (activeView.value !== 'form') return;
    updateUrlForForm(id);
  }
);

watch(
  () => activeView.value,
  (view) => {
    if (view === 'form') {
      updateUrlForForm(activeFormId.value);
      return;
    }
    if (view === 'page') {
      updateUrlForPage(activePageId.value);
    }
  }
);

watch(
  () => activePageId.value,
  (id) => {
    if (!rowPageOverlayId.value) return;
    if (rowPageOverlayBaseId.value && id !== rowPageOverlayBaseId.value) {
      closeRowPageOverlay();
    }
  }
);

watch(
  () => workspace.currentPage?.id,
  () => {
    setupError.value = '';
    setupAutoCompleteTriggered.value = false;
    setupSeedDoc.value = null;
  }
);

watch(
  () => workspace.currentPage?.id,
  () => {
    wikiViewId.value = 'home';
  }
);

watch(
  () => wikiViews.value,
  (views) => {
    if (!views?.length) {
      wikiViewId.value = 'home';
      return;
    }
    if (!views.some((view) => view.id === wikiViewId.value)) {
      wikiViewId.value = views[0]?.id || 'home';
    }
  },
  { immediate: true }
);

watch(
  () => showWikiHomeDoc.value,
  (show) => {
    if (!show) {
      collabPresence.value = [];
    } else {
      updateCollabPresence();
    }
  }
);

const applyInitialRoute = () => {
  if (hasAppliedInitialRoute.value) return;
  const routedFormId = parseFormIdFromPath();
  if (routedFormId) {
    activeFormId.value = routedFormId;
    activeView.value = 'form';
    hasAppliedInitialRoute.value = true;
    return;
  }
  const routedId = parsePageIdFromPath();
  if (routedId) {
    initialRoutePageId.value = routedId;
  }
  hasAppliedInitialRoute.value = true;
};

watch(
  () => workspace.loadingPages,
  (loading) => {
    if (!loading && initialRoutePageId.value) {
      const page = workspace.pages.find((p) => p.id === initialRoutePageId.value);
      if (page) {
        selectPage(page);
      } else if (workspace.hasApi) {
        workspace.loadPageDoc(initialRoutePageId.value);
      }
      initialRoutePageId.value = null;
    }
  }
);

const closeEmojiPicker = () => {
  showEmojiPicker.value = false;
};
const toggleIconPicker = () => {
  if (!canEditPage.value) return;
  if (showEmojiPicker.value) {
    closeEmojiPicker();
    return;
  }
  showEmojiPicker.value = true;
};
const choosePageIcon = (value) => {
  if (!canEditPage.value) return;
  if (workspace.currentPage) {
    if (workspace.collabActive && iconYMap.value) {
      handleCollabStatus({ text: 'Saving...', state: 'saving' });
      iconYMap.value.doc?.transact(() => {
        iconYMap.value.set('icon', value || null);
      }, 'icon-local');
      workspace.applyCollabIcon(value || null);
      persistCollabIcon(value || null);
    } else {
      workspace.setPageIcon(workspace.currentPage, value);
    }
  }
};
const handleEmojiClickOutside = (event) => {
  if (!showEmojiPicker.value) return;
  const target = event?.target;
  const path = event?.composedPath?.() || [];
  const menuHit = emojiMenuRef.value && (path.includes(emojiMenuRef.value) || emojiMenuRef.value.contains(target));
  const triggerHit = emojiTriggerRef.value && (path.includes(emojiTriggerRef.value) || emojiTriggerRef.value.contains(target));
  if (menuHit || triggerHit) {
    return;
  }
  closeEmojiPicker();
};
const handleEmojiKeydown = (event) => {
  if (event.key === 'Escape') {
    if (showSettingsPopup.value) {
      event.preventDefault();
      closeSettingsPopup();
    } else {
      closeEmojiPicker();
    }
  }
};

const pageChildren = computed(() => {
  if (!workspace.currentPage) return [];
  return pages.value.filter((page) => page.parentId === workspace.currentPage.id && !page.isHidden && !page.isDeleted);
});

const wikiPages = computed(() => {
  if (!isWikiHome.value || !workspace.currentPage) return [];
  const homeId = workspace.currentPage.id;
  return pages.value
    .filter((page) => {
      if (!page || page.isDeleted || page.isHidden) return false;
      if (page.kind === 'DATABASE') return false;
      if (page.id === homeId) return false;
      return page.wikiHomeId === homeId;
    })
    .slice()
    .sort((a, b) => {
      const posA = Number(a.position ?? 0);
      const posB = Number(b.position ?? 0);
      if (posA === posB) return (a.createdAt || 0) > (b.createdAt || 0) ? 1 : -1;
      return posA - posB;
    });
});

const getDescendantCount = (page) => workspace.getDescendantIds(page.id)?.length || 0;
const formatSubpageCount = (page) => {
  const count = getDescendantCount(page);
  if (!count) return 'Sub-page link';
  return `${count} sub-page${count === 1 ? '' : 's'}`;
};
const breadcrumbs = computed(() => {
  if (!workspace.currentPage) return [];
  const map = new Map(pages.value.map((p) => [p.id, p]));
  const chain = [];
  let current = workspace.currentPage;
  while (current) {
    chain.unshift(current);
    current = current.parentId ? map.get(current.parentId) : null;
  }
  return chain;
});

const deleteModalVisible = ref(false);
const deleteModalTarget = ref(null);
const deleteModalResolver = ref(null);
const binCount = computed(() => workspace.binPages.length);
watch(
  () => isAdminUser.value,
  (allowed) => {
    if (!allowed && isSysadminView.value) {
      activeView.value = 'page';
    }
  }
);
const parsePageIdFromPath = () => {
  if (isDevMode.value || typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/\/doc\/([0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[1-5][0-9a-fA-F-]{3}-[89abAB][0-9a-fA-F-]{3}-[0-9a-fA-F-]{12})/);
  return match?.[1] || null;
};
const parseFormIdFromPath = () => {
  if (isDevMode.value || typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/\/form\/([0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[1-5][0-9a-fA-F-]{3}-[89abAB][0-9a-fA-F-]{3}-[0-9a-fA-F-]{12})/);
  return match?.[1] || null;
};
const updateUrlForPage = (pageId) => {
  if (isDevMode.value || typeof window === 'undefined') return;
  const target = pageId ? `/doc/${pageId}` : '/';
  const hash = window.location.hash || '';
  if (window.location.pathname !== target || window.location.hash !== hash) {
    window.history.replaceState({}, '', `${target}${hash}`);
  }
};
const updateUrlForForm = (formId) => {
  if (isDevMode.value || typeof window === 'undefined') return;
  const target = formId ? `/form/${formId}` : '/';
  const hash = window.location.hash || '';
  if (window.location.pathname !== target || window.location.hash !== hash) {
    window.history.replaceState({}, '', `${target}${hash}`);
  }
};

const focusBlockFromHash = () => {
  if (typeof window === 'undefined') return;
  const match = window.location.hash.match(/block-([A-Za-z0-9_-]+)/);
  if (!match) return;
  const blockId = match[1];
  tiptapEditorRef.value?.focusBlockById?.(blockId);
};

const updateCollabPresence = () => {
  if (isDatabasePage.value || showWikiTable.value || !showWikiHomeDoc.value) {
    return;
  }
  const awareness = activeCollabProvider.value?.awareness;
  if (!awareness) {
    collabPresence.value = [];
    return;
  }
  const states = Array.from(awareness.getStates().values());
  const mapped = states
    .map((state) => {
      const user = state?.user;
      if (!user) return null;
      const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : 'Guest';
      const color = typeof user.color === 'string' && user.color ? user.color : '#3b82f6';
      const letter = name.charAt(0).toUpperCase();
      return { name, color, letter };
    })
    .filter(Boolean);
  const unchanged =
    collabPresence.value.length === mapped.length &&
    collabPresence.value.every((entry, idx) => {
      const other = mapped[idx];
      return other && entry.name === other.name && entry.color === other.color && entry.letter === other.letter;
    });
  if (unchanged) return;
  collabPresence.value = mapped;
};

const childrenMapComputed = computed(() => {
  const map = new Map();
  pages.value.forEach((page) => {
    const parentId = page.parentId ?? null;
    if (!map.has(parentId)) {
      map.set(parentId, []);
    }
    map.get(parentId).push(page);
  });
  return map;
});

const buildSubtree = (rootId) => {
  const map = childrenMapComputed.value;
  const root = pages.value.find((p) => p.id === rootId);
  if (!root) return null;
  const buildNode = (page) => {
    const children = map.get(page.id) || [];
    return {
      ...page,
      children: children.map(buildNode),
    };
  };
  return buildNode(root);
};

const deleteModalSubtree = computed(() => {
  if (!deleteModalTarget.value) return null;
  return buildSubtree(deleteModalTarget.value.id);
});

const requestDeleteConfirmation = (pageId) =>
  new Promise((resolve) => {
    const page = pages.value.find((p) => p.id === pageId);
    if (!page) {
      resolve(false);
      return;
    }
    deleteModalTarget.value = page;
    deleteModalResolver.value = resolve;
    deleteModalVisible.value = true;
  });

const resetDeleteModal = () => {
  deleteModalVisible.value = false;
  deleteModalTarget.value = null;
  deleteModalResolver.value = null;
};

const cancelDeleteModal = () => {
  if (deleteModalResolver.value) {
    deleteModalResolver.value(false);
  }
  resetDeleteModal();
};

const confirmDeleteModal = async () => {
  if (!deleteModalTarget.value) {
    cancelDeleteModal();
    return;
  }
  const deletedPage = deleteModalTarget.value;
  const parentId = deletedPage.parentId;
  await workspace.deletePageCascade(deletedPage.id);
  if (parentId) {
    const hasRemainingChildren = workspace.pages.some(
      (p) => p.parentId === parentId && !p.isDeleted && !p.isHidden
    );
    if (!hasRemainingChildren) {
      expanded.value[parentId] = false;
    }
  }
  if (deleteModalResolver.value) {
    deleteModalResolver.value(true);
  }
  resetDeleteModal();
};

const handlePageBlockClick = (page) => {
  selectPage(page);
};

const handleBreadcrumbNavigate = (pageId) => {
  const page = pages.value.find((p) => p.id === pageId);
  if (page) {
    selectPage(page);
  }
};

const reorderPages = async ({ draggedId, targetId, targetParentId, dropMode = 'above' }) => {
  let dragged = pages.value.find((p) => p.id === draggedId);
  let target = pages.value.find((p) => p.id === targetId);
  if (!dragged || !target) return;
  if (dragged.workspaceId !== target.workspaceId) return;
  // prevent dropping into own descendant chain
  const descendants = workspace.getDescendantIds(draggedId);
  if (descendants.includes(targetId)) return;

  const targetVisibility = target.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
  if (dragged.visibility !== targetVisibility) {
    await workspace.movePageVisibility(dragged, targetVisibility);
    dragged = pages.value.find((p) => p.id === draggedId);
    target = pages.value.find((p) => p.id === targetId);
    if (!dragged || !target) return;
    if (dragged.visibility !== targetVisibility) return;
  }

  const newParentId = dropMode === 'into' ? targetId : target.parentId ?? null;
  const siblings = pages.value
    .filter((p) => {
      const matchesVisibility = targetVisibility === 'PRIVATE' ? p.visibility === 'PRIVATE' : p.visibility !== 'PRIVATE';
      return (p.parentId ?? null) === newParentId && matchesVisibility;
    })
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  const filtered = siblings.filter((p) => p.id !== draggedId);
  let orderedIds;
  let reorderedSiblings;

  if (dropMode === 'into') {
    // move into target: append at end of its children
    const updated = [...filtered, { ...dragged, parentId: newParentId }];
    orderedIds = updated.map((p) => p.id);
    reorderedSiblings = updated.map((p, idx) => ({ ...p, parentId: newParentId, position: idx + 1 }));
  } else {
    const targetIndex = filtered.findIndex((p) => p.id === targetId);
    const insertIndex = targetIndex >= 0 ? targetIndex : filtered.length;
    filtered.splice(insertIndex, 0, { ...dragged, parentId: newParentId });
    orderedIds = filtered.map((p) => p.id);
    reorderedSiblings = filtered.map((p, idx) => ({ ...p, parentId: newParentId, position: idx + 1 }));
  }

  const prevState = [...workspace.pages];
  try {
    const others = workspace.pages.filter((p) => {
      if (p.id === draggedId) return false;
      const parent = p.parentId ?? null;
      if (parent === newParentId && orderedIds.includes(p.id)) return false;
      return true;
    });
    workspace.pages = [...others, ...reorderedSiblings];
    await api.reorderPages(newParentId, orderedIds, { userId: activeUser.value?.id, userName: activeUser.value?.name });
  } catch (err) {
    console.warn('Reorder failed', err);
    workspace.error = err?.message || 'Failed to reorder pages';
    workspace.pages = prevState;
  }
};

const confirmDeletePage = async (page) => {
  await requestDeleteConfirmation(page.id);
  closeMenu();
};

const handlePageBlockDelete = (page) => {
  confirmDeletePage(page);
};

const openBin = async () => {
  await workspace.loadBinPages();
  showBinModal.value = true;
};
const closeBin = () => {
  showBinModal.value = false;
  workspace.clearBinState();
};

if (typeof window !== 'undefined') {
  window.addEventListener('wikid:open-bin', openBin);
}
</script>

<template>
  <div v-if="isDevMode" class="dev-lab">
    <header class="dev-lab__header">
      <h1>Dev sandbox</h1>
      <p class="muted">Preview editor chrome: hover code/image blocks to see their menus.</p>
    </header>
    <section class="dev-lab__grid">
      <div class="dev-lab__panel">
        <h2 class="dev-lab__title">Tiptap editor (dark)</h2>
        <TiptapEditor
          :doc="devDoc"
          :request-delete-confirmation="() => null"
          :collab="null"
          @update:doc="(next) => { devDoc.value = next; }"
          @status="() => {}"
        />
      </div>
      <div class="dev-lab__panel dev-lab__panel--light" data-theme="light">
        <h2 class="dev-lab__title">Tiptap editor (light)</h2>
        <TiptapEditor
          :doc="devDoc"
          :request-delete-confirmation="() => null"
          :collab="null"
          @update:doc="(next) => { devDoc.value = next; }"
          @status="() => {}"
        />
      </div>
    </section>
  </div>
  <LoginPage v-else-if="!activeUser" />
  <div v-else-if="!workspace.sessionChecked" class="app-signing-in" role="status" aria-live="polite">Signing in…</div>
  <ChooseNewPassword v-else-if="workspace.mustChangePassword" />
  <div v-else class="app-shell" :class="{ 'app-shell--sidebar-hidden': isSidebarHidden }" :style="appShellStyle">
    <div v-if="showNotConnected" class="not-connected-overlay" role="status" aria-live="polite">
      <div class="not-connected-card">
        <h1>Not connected</h1>
        <p class="muted">Connect to the server to continue.</p>
        <div class="not-connected-actions">
          <button class="ghost-btn" type="button" @click="retryConnection">Retry</button>
        </div>
      </div>
    </div>
    <div v-else-if="showCollabDisconnected" class="not-connected-overlay" role="status" aria-live="polite">
      <div class="not-connected-card">
        <h1>{{ collabStatusState === 'connecting' ? 'Reconnecting' : 'Realtime disconnected' }}</h1>
        <p class="muted">
          {{
            collabStatusState === 'connecting'
              ? 'Trying to reach the collaboration server. Editing is paused until it reconnects.'
              : 'The collaboration server is offline. Editing is paused until it reconnects.'
          }}
        </p>
      </div>
    </div>
    <div v-if="menuOpenFor" class="page-menu-overlay" @mousedown="closeMenu"></div>
    <aside
      ref="sidebarRef"
      class="sidebar"
      :class="{ 'sidebar--menu-open': !!menuOpenFor, 'sidebar--floating': isSidebarHidden, 'sidebar--peek': isSidebarPeek }"
      :aria-hidden="isSidebarHidden && !isSidebarPeek"
      @mouseenter="handleSidebarMouseEnter"
      @mouseleave="handleSidebarMouseLeave"
    >
      <header class="sidebar__header">
        <button class="user-switch" type="button" @click="toggleUserMenu($event)">
          <span class="user-switch__label">
            <span class="user-name">{{ activeUser ? activeWorkspaceName : 'Log in' }}</span>
            <span class="caret">▾</span>
          </span>
        </button>
        <button
          class="sidebar-hide-btn"
          type="button"
          :title="isSidebarHidden ? 'Pin sidebar' : 'Unpin sidebar'"
          :aria-label="isSidebarHidden ? 'Pin sidebar' : 'Unpin sidebar'"
          @click="toggleSidebar(!isSidebarHidden)"
        >
          <PageIcon
            v-if="isSidebarHidden"
            class="sidebar-toggle-icon"
            icon="icon:pin-angle-fill"
            fallback="Pin"
            aria-hidden="true"
          />
          <PageIcon
            v-else
            class="sidebar-toggle-icon"
            icon="icon:caret-left-fill"
            fallback="Unpin"
            aria-hidden="true"
          />
        </button>
      </header>

      <button class="sidebar-search-btn" type="button" @click="openSearch">
        <i class="bi bi-search" aria-hidden="true"></i>
        Search
        <kbd aria-hidden="true">{{ searchShortcutLabel }}</kbd>
      </button>

      <div class="sidebar__section" v-if="!loadingPages && activeWorkspaceId">
        <button class="sidebar__section-title collapsible" type="button" @click="workspace.privateOpen = !workspace.privateOpen">
          <span>Private</span>
          <span class="caret" :class="{ open: workspace.privateOpen }">
            <svg class="chevron-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" :d="CHEVRON_RIGHT" />
            </svg>
          </span>
          <span v-if="canEditWorkspace" class="section-actions">
            <button class="section-add-btn" type="button" @click.stop="createSetupPage('PRIVATE')">+</button>
          </span>
        </button>
        <div v-show="workspace.privateOpen">
          <PageTree
            :pages="privatePages"
            :parent-id="null"
            :depth="0"
            :active-id="activePageId"
            :menu-open-for="menuOpenFor"
            :is-expanded="isExpanded"
            :toggle-expand="toggleExpand"
            :select="handlePageItemClick"
            :prefetch="prefetchSidebarPage"
            :toggle-tree="toggleTreeExpansion"
            :toggle-menu="toggleMenu"
            :duplicate="duplicatePage"
            :rename="promptRename"
            :move-visibility="movePageVisibility"
            :remove="deletePage"
            :export-html="exportPageHtml"
            :convert-to-wiki="convertToWiki"
            :open-in-split="openPageInSplit"
            :open-in-move-workspace="otherWorkspaces.length ? openMoveToWorkspaceModal : null"
            :add-child="addChildPage"
            :on-reorder="canEditWorkspace ? reorderPages : null"
            :indent-step="indentStep"
            :can-edit="canEditWorkspace"
          />
        </div>
      </div>

      <div class="sidebar__section" v-if="!loadingPages && activeWorkspaceId">
        <button class="sidebar__section-title collapsible" type="button" @click="workspace.publicOpen = !workspace.publicOpen">
          <span>Public</span>
          <span class="caret" :class="{ open: workspace.publicOpen }">
            <svg class="chevron-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" :d="CHEVRON_RIGHT" />
            </svg>
          </span>
          <span v-if="canEditWorkspace" class="section-actions">
            <button class="section-add-btn" type="button" @click.stop="createSetupPage('PUBLIC')">+</button>
          </span>
        </button>
        <div v-show="workspace.publicOpen">
          <PageTree
            :pages="publicPages"
            :parent-id="null"
            :depth="0"
            :active-id="activePageId"
            :menu-open-for="menuOpenFor"
            :is-expanded="isExpanded"
            :toggle-expand="toggleExpand"
            :select="handlePageItemClick"
            :prefetch="prefetchSidebarPage"
            :toggle-tree="toggleTreeExpansion"
            :toggle-menu="toggleMenu"
            :duplicate="duplicatePage"
            :rename="promptRename"
            :move-visibility="movePageVisibility"
            :remove="deletePage"
            :export-html="exportPageHtml"
            :convert-to-wiki="convertToWiki"
            :open-in-split="openPageInSplit"
            :open-in-move-workspace="otherWorkspaces.length ? openMoveToWorkspaceModal : null"
            :add-child="addChildPage"
            :on-reorder="canEditWorkspace ? reorderPages : null"
            :indent-step="indentStep"
            :can-edit="canEditWorkspace"
          />
        </div>
      </div>
      <div class="sidebar__section" v-if="!loadingPages && isAdminUser">
        <div class="sidebar__section-title sidebar__section-title--static">Admin</div>
        <button
          class="sidebar__item sidebar__item--utility"
          :class="{ active: activeView === 'admin:users' }"
          type="button"
          @click="openAdminView('admin:users')"
        >
          <div class="page-icon-slot"><span class="page-icon" aria-hidden="true">👤</span></div>
          <div class="sidebar__title">Users</div>
        </button>
        <button
          class="sidebar__item sidebar__item--utility"
          :class="{ active: activeView === 'admin:workspaces' }"
          type="button"
          @click="openAdminView('admin:workspaces')"
        >
          <div class="page-icon-slot"><span class="page-icon" aria-hidden="true">🗂️</span></div>
          <div class="sidebar__title">Workspaces</div>
        </button>
        <button
          class="sidebar__item sidebar__item--utility"
          :class="{ active: activeView === 'admin:collab' }"
          type="button"
          @click="openAdminView('admin:collab')"
        >
          <div class="page-icon-slot"><span class="page-icon" aria-hidden="true">🔄</span></div>
          <div class="sidebar__title">Collaboration</div>
        </button>
        <button
          class="sidebar__item sidebar__item--utility"
          :class="{ active: activeView === 'admin:settings' }"
          type="button"
          @click="openAdminView('admin:settings')"
        >
          <div class="page-icon-slot"><span class="page-icon" aria-hidden="true">⚙️</span></div>
          <div class="sidebar__title">Settings</div>
        </button>
      </div>
      <div class="sidebar__empty" v-if="loadingPages">Loading...</div>
      <div class="sidebar__footer">
        <button class="bin-btn" type="button" @click="openBin">
          🗑️ Bin
          <span class="bin-count" v-if="binCount">{{ binCount }}</span>
        </button>
      </div>
    </aside>
    <div
      class="sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      :aria-valuemin="MIN_SIDEBAR_WIDTH"
      :aria-valuemax="MAX_SIDEBAR_WIDTH"
      :aria-valuenow="sidebarWidth"
      :class="{ active: isResizing }"
      @mousedown.prevent="startResize"
    ></div>

    <main class="content">
      <div class="content-with-ai-panel">
        <AiSidePanel
          v-if="showAiPanel && !splitPageId && workspace.aiEnabled"
          :workspace-id="workspace.currentPage?.workspaceId || workspace.activeWorkspaceId || ''"
          :page-context="aiPageContext"
          :page-title="workspace.currentPage?.title || ''"
          :on-suggest="handleAiSuggestions"
          :get-serialized-blocks="getSerializedBlocksForAi"
          :summarization-pending="summarizationPending"
          :summarization-stats="summarizationStats"
          :summarize-for-ai="summarizeForAi"
          @close="showAiPanel = false"
        />
      <div
        ref="splitContainerRef"
        class="split-container"
        :class="{ 'split-container--active': !!splitPageId }"
        :style="splitPageId && splitPrimaryWidthPx ? { '--split-primary-width': splitPrimaryWidthPx + 'px' } : {}"
      >
      <div class="pane-col">
        <TopBar
          v-if="workspace.currentPage && !isSysadminView && !isFormView"
          :workspace-name="activeWorkspaceName"
          :crumbs="splitPageId ? (breadcrumbs.length ? [breadcrumbs[breadcrumbs.length - 1]] : []) : breadcrumbs"
          :saving="saving"
          :collaborators="collabPresence"
          :status-label="useCollabStatus ? collabStatusLabel : ''"
          :status-state="useCollabStatus ? collabStatusState : ''"
          :full-width="isFullWidthPage"
          :show-full-width-toggle="!splitPageId && isDocLayout"
          :show-sidebar-toggle="isSidebarHidden"
          :show-ai-toggle="!splitPageId && isDocLayout && workspace.aiEnabled"
          :ai-panel-open="showAiPanel"
          :show-workspace-name="!splitPageId && !(breadcrumbs.length && breadcrumbs[0]?.title === '…')"
          @export="openExportModal"
          @toggle-full-width="setFullWidthPreference"
          @toggle-sidebar="showSidebar"
          @preview-sidebar="handleSidebarPreview"
          @navigate="handleBreadcrumbNavigate"
          @menu-open="tiptapEditorRef?.blurEditor()"
          @toggle-ai="showAiPanel = !showAiPanel"
        />
        <div v-if="aiSuggestionCount > 0" class="ai-suggestion-bar">
          <span class="ai-suggestion-bar__label">
            ✦ {{ aiSuggestionCount }} AI suggestion{{ aiSuggestionCount !== 1 ? 's' : '' }}
          </span>
          <button class="ai-suggestion-bar__btn" type="button" @click="tiptapEditorRef?.acceptAllSuggestions?.()">Accept all</button>
          <button class="ai-suggestion-bar__btn ai-suggestion-bar__btn--revert" type="button" @click="tiptapEditorRef?.revertAllSuggestions?.()">Revert all</button>
        </div>
      <div :class="['wikid-mainframe', { 'wikid-mainframe--lock-scroll': rowPageOverlayId }]">
        <template v-if="activeView === 'admin:users'">
          <div class="frame-heading sysadmin-heading">
            <div class="sysadmin-heading__icon" aria-hidden="true">👤</div>
            <div>
              <h1 class="sysadmin-heading__title">Users</h1>
              <p class="muted">Create and manage user accounts.</p>
            </div>
          </div>
          <section class="sysadmin-body">
            <AdminUsersPanel v-if="isAdminUser" :admin-id="activeUser?.id" />
            <div v-else class="muted">Admin access required.</div>
          </section>
        </template>
        <template v-else-if="activeView === 'admin:workspaces'">
          <div class="frame-heading sysadmin-heading">
            <div class="sysadmin-heading__icon" aria-hidden="true">🗂️</div>
            <div>
              <h1 class="sysadmin-heading__title">Workspaces</h1>
              <p class="muted">Browse workspaces and manage membership.</p>
            </div>
          </div>
          <section class="sysadmin-body">
            <WorkspacesAdminPanel v-if="isAdminUser" :admin-id="activeUser?.id" />
            <div v-else class="muted">Admin access required.</div>
          </section>
        </template>
        <template v-else-if="activeView === 'admin:collab'">
          <div class="frame-heading sysadmin-heading">
            <div class="sysadmin-heading__icon" aria-hidden="true">🔄</div>
            <div>
              <h1 class="sysadmin-heading__title">Collaboration</h1>
              <p class="muted">Inspect collaboration persistence and materialization status.</p>
            </div>
          </div>
          <section class="sysadmin-body">
            <CollabAdminPanel v-if="isAdminUser" :admin-id="activeUser?.id" />
            <div v-else class="muted">Admin access required.</div>
          </section>
        </template>
        <template v-else-if="activeView === 'admin:settings'">
          <div class="frame-heading sysadmin-heading">
            <div class="sysadmin-heading__icon" aria-hidden="true">⚙️</div>
            <div>
              <h1 class="sysadmin-heading__title">Settings</h1>
              <p class="muted">Settings for everyone on this server.</p>
            </div>
          </div>
          <section class="sysadmin-body">
            <AdminSettingsPanel v-if="isAdminUser" />
            <div v-else class="muted">Admin access required.</div>
          </section>
        </template>
        <template v-else-if="isFormView">
          <Transition name="page-slide" mode="out-in">
            <div :key="pageTransitionKey" class="page-surface page-surface--form">
              <DatabaseFormPage
                v-if="activeFormId"
                :form-id="activeFormId"
                @open-page="handleFormOpenPage"
              />
              <div v-else class="muted">Form not found.</div>
            </div>
          </Transition>
        </template>
        <template v-else-if="!activeWorkspaceId && !loadingPages">
          <div class="empty-state">
            <h1>No workspace</h1>
            <p class="muted">Create a workspace to get started.</p>
            <button class="ghost-btn ghost-btn-background" type="button" @click="createWorkspace">Create workspace</button>
          </div>
        </template>
        <template v-else-if="!workspace.currentPage">
          <div v-if="isSidebarHidden" class="empty-state-topbar">
            <button
              type="button"
              class="ghost-btn topbar-sidebar-toggle"
              aria-label="Show sidebar"
              title="Show sidebar"
              @click="showSidebar"
              @mouseenter="handleSidebarPreview({ open: true, event: $event })"
              @mouseleave="handleSidebarPreview({ open: false, event: $event })"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5v-11zm5.5 0H2.5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h4V2.5zm1 12h5.5a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5H7.5v12z"/></svg>
            </button>
          </div>
          <div class="empty-state">
            <h1>Not much here at the moment...</h1>
            <p class="muted">Add pages to the workspace in the sidebar to get started.</p>
          </div>
        </template>
        <Transition v-else name="page-slide" mode="out-in">
          <div :key="pageTransitionKey" class="page-surface">
            <div
              class="frame-heading"
              :class="{
                'frame-heading--page': !isSysadminView,
                'frame-heading--doc': isDocLayout,
                'frame-heading--full': isFullWidthPage && isDocLayout,
              }"
            >
              <div class="page-icon-wrap">
                <button
                  ref="emojiTriggerRef"
                  class="page-icon-main"
                  type="button"
                  :disabled="!canEditPage"
                  @click="toggleIconPicker"
                >
                  <PageIcon
                    class="page-icon-main__icon"
                    :icon="workspace.currentPage?.icon"
                    fallback="📄"
                    aria-hidden="true"
                  />
                </button>
                <div v-if="showEmojiPicker" ref="emojiMenuRef" class="emoji-menu" @click.stop>
                  <IconPicker
                    :icon="workspace.currentPage?.icon || ''"
                    :open="showEmojiPicker"
                    :show-header="false"
                    @select="choosePageIcon"
                  />
                </div>
              </div>
              <textarea
                ref="pageTitleRef"
                class="page-title"
                rows="1"
                :value="pageTitle"
                :readonly="!canEditPage"
                @input="handleTitleInput"
                @keydown.enter.prevent="handleTitleEnter"
                placeholder="Untitled page"
              ></textarea>
              <div v-if="showWikiViewSelect" class="wiki-view-selector">
                <span class="wiki-view-label">View</span>
                <select v-model="wikiViewId" class="wiki-view-select">
                  <option v-for="view in wikiViews" :key="view.id" :value="view.id">
                    {{ view.name || view.id }}
                  </option>
                </select>
              </div>
            </div>
            <div v-if="remoteDeletionMessage" class="page-deleted-notice" role="status">
              <span>{{ remoteDeletionMessage }}</span>
              <span class="page-deleted-notice__actions">
                <button v-if="canEditWorkspace" class="ghost-btn" type="button" @click="workspace.restoreRemotelyDeletedPage()">
                  Restore
                </button>
                <button class="ghost-btn" type="button" @click="workspace.leaveRemotelyDeletedPage()">Close</button>
              </span>
            </div>
            <div v-if="error" class="alert">{{ error }}</div>
            <div v-else-if="loadingDoc" class="muted">Loading page...</div>
            <section
              v-else
              class="page-body"
              :class="{ 'page-body--doc': isDocLayout, 'page-body--full': isFullWidthPage && isDocLayout }"
            >
              <DatabaseTable
                v-if="isDatabasePage && activePageId"
                :page-id="activePageId"
                :readonly="!canEditPage"
                @collabready="handleCollabReady"
                @collabpresence="handleDatabasePresence"
              />
              <template v-else>
                <template v-if="showWikiTable">
                  <DatabaseTable
                    v-if="activeWikiDatabasePageId"
                    :page-id="activeWikiDatabasePageId"
                    :readonly="!canEditPage"
                    :collab="wikiDatabaseCollab"
                    embedded
                    @collabpresence="handleDatabasePresence"
                  />
                </template>
                <template v-else-if="showWikiGallery">
                  <div class="wiki-gallery">
                    <div v-if="!wikiPages.length" class="muted">No pages yet.</div>
                    <div v-else class="wiki-gallery-grid">
                      <div
                        v-for="page in wikiPages"
                        :key="page.id"
                        class="wiki-gallery-card"
                        role="button"
                        tabindex="0"
                        @click="handlePageBlockClick(page)"
                        @keydown.enter.prevent="handlePageBlockClick(page)"
                        @keydown.space.prevent="handlePageBlockClick(page)"
                      >
                        <PageIcon class="wiki-gallery-card__icon" :icon="page.icon" fallback="📄" aria-hidden="true" />
                        <div class="wiki-gallery-card__body">
                          <div class="wiki-gallery-card__title">{{ page.title || 'Untitled page' }}</div>
                          <div class="wiki-gallery-card__meta">{{ page.updatedAt ? new Date(page.updatedAt).toLocaleString() : '' }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <PageProperties
                    v-if="activePageId"
                    :page-id="activePageId"
                    :readonly="!canEditPage"
                  />
                  <TiptapEditor
                    ref="tiptapEditorRef"
                    v-if="activePageId"
                    :key="`${activePageId || 'no-page'}-${editorCollab?.docName || 'local'}`"
                    :doc="doc"
                    :seed-doc="setupSeedDoc"
                    :page-id="activePageId"
                    :collab="editorCollab"
                    :readonly="!canEditPage"
                    :placeholder="isSetupPage ? 'Start typing to create a regular page' : ''"
                    :seed-collab-on-mount="setupAutoCompleteTriggered"
                    :request-delete-confirmation="requestDeleteConfirmation"
                    :request-compliance-setup="requestComplianceSetup"
                    @update:doc="handleUpdateDoc"
                    @status="handleCollabStatus"
                    @collabready="handleCollabReady"
                  />
                  <div v-if="isSetupPage && !setupAutoCompleteTriggered" class="setup-callout">
                    <p class="muted">Or select from one of these page types:</p>
                    <div class="create-page__options create-page__cards">
                      <button
                        class="create-page__card"
                        type="button"
                        :disabled="setupSaving || !canEditPage"
                        @click="chooseSetupKind('DOC')"
                      >
                        <div class="create-page__card-title">Page</div>
                        <div class="create-page__card-desc">Rich text docs with headings, blocks, and embeds.</div>
                      </button>
                      <button
                        class="create-page__card"
                        type="button"
                        :disabled="setupSaving || !canEditPage"
                        @click="chooseSetupKind('DATABASE')"
                      >
                        <div class="create-page__card-title">Database</div>
                        <div class="create-page__card-desc">Structured tables with fields, rows, and filters.</div>
                      </button>
                      <button
                        class="create-page__card"
                        type="button"
                        :disabled="setupSaving || !canEditPage"
                        @click="handleComplianceSetup"
                      >
                        <div class="create-page__card-title">Compliance database</div>
                        <div class="create-page__card-desc">Audit-grade records with immutable revisions.</div>
                      </button>
                    </div>
                    <span v-if="setupError" class="alert">{{ setupError }}</span>
                    <p v-if="setupSaving" class="muted">Saving setup...</p>
                  </div>
                </template>
              </template>
              <div v-if="pageChildren.length && showWikiHomeDoc" class="page-links-footer inline">
                <button class="page-links-toggle" type="button" @click="showLinksFooter = !showLinksFooter">
                  <span class="page-links-toggle-label">Sub-pages ({{ pageChildren.length }})</span>
                  <span class="page-links-toggle-caret" :class="{ open: showLinksFooter }">
                    <svg class="chevron-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
                      <path fill-rule="evenodd" :d="CHEVRON_RIGHT" />
                    </svg>
                  </span>
                </button>
                <div v-show="showLinksFooter" class="page-links-panel">
                  <div class="page-links-grid">
                    <div
                      v-for="page in pageChildren"
                      :key="page.id"
                      class="page-link-block"
                      role="button"
                      tabindex="0"
                      @click="handlePageBlockClick(page)"
                      @keydown.enter.prevent="handlePageBlockClick(page)"
                      @keydown.space.prevent="handlePageBlockClick(page)"
                    >
                      <div class="page-link-main">
                        <PageIcon class="page-link-icon" :icon="page.icon" fallback="📄" aria-hidden="true" />
                        <div class="page-link-text">
                          <span class="page-link-title">{{ page.title || 'Untitled page' }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </Transition>
      </div><!-- /wikid-mainframe -->
      </div><!-- /pane-col -->
      <template v-if="splitPageId">
        <div
          class="split-resize-handle"
          :class="{ active: isSplitResizing }"
          @mousedown.prevent="startSplitResize"
        ></div>
        <SecondaryPane
          :page-id="splitPageId"
          @close="closeSplit"
          @navigate="(id) => { splitPageId = id; }"
        />
      </template>
      </div><!-- /split-container -->
      </div><!-- /content-with-ai-panel -->

      <Transition name="drawer-slide">
        <PageOverlay
          v-if="rowPageOverlayId"
          :page-id="rowPageOverlayId"
          :readonly="!canEditWorkspace"
          :request-delete-confirmation="requestDeleteConfirmation"
          :request-compliance-setup="requestComplianceSetup"
          @close="closeRowPageOverlay"
          @openfull="openRowPageFull"
        />
      </Transition>

      <ComplianceSetupModal
        v-if="complianceSetupRequest"
        v-bind="complianceSetupRequest.options"
        @submit="finishComplianceSetup"
        @cancel="finishComplianceSetup(null)"
      />

      <CreateWorkspaceModal v-if="showCreateWorkspaceModal" @close="showCreateWorkspaceModal = false" />

      <!-- Move to workspace modal -->
      <MoveToWorkspaceModal
        v-if="moveWorkspacePage"
        :page="moveWorkspacePage"
        :workspaces="otherWorkspaces"
        @close="moveWorkspacePage = null"
      />

      <ExportModal
        v-if="exportRequest"
        :format="exportRequest.format"
        :root-page-id="exportRequest.rootPageId"
        @close="exportRequest = null"
      />
      <UserMenu
        v-if="showUserMenu"
        @dismiss="toggleUserMenu"
        @settings="openSettingsPopup"
        @logout="handleLogout"
        @create-workspace="openCreateWorkspaceModal"
        @select-workspace="selectWorkspaceFromMenu"
      />
      <SettingsPopup
        v-if="showSettingsPopup"
        :theme-mode-label="themeModeLabel"
        @close="closeSettingsPopup"
        @toggle-theme="toggleThemeMode"
        @export-json="exportWorkspaceData"
        @export-markdown="exportWorkspaceMarkdown"
      />
      <DeletePageModal
        v-if="deleteModalVisible"
        :page="deleteModalTarget"
        :subtree="deleteModalSubtree"
        @cancel="cancelDeleteModal"
        @confirm="confirmDeleteModal"
      />
      <BinModal v-if="showBinModal" @close="closeBin" @restored-parents="expandPages" />
      <SearchDialog v-if="showSearch" @open="openSearchResult" @close="showSearch = false" />
    </main>
  </div>
</template>
