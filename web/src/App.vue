<script setup>
import { computed, defineComponent, Fragment, h, nextTick, onBeforeUnmount, onMounted, provide, ref, watch, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import { useWorkspaceStore } from './stores/workspace';
import TiptapEditor from './components/TiptapEditor.vue';
import DatabaseTable from './components/DatabaseTable.vue';
import TopBar from './components/TopBar.vue';
import CollabAdminPanel from './components/CollabAdminPanel.vue';
import WorkspacesAdminPanel from './components/WorkspacesAdminPanel.vue';
import AdminUsersPanel from './components/AdminUsersPanel.vue';
import PageIcon from './components/PageIcon.vue';
import IconPicker from './components/IconPicker.vue';
import PageOverlay from './components/PageOverlay.vue';
import PageProperties from './components/PageProperties.vue';
import DatabaseFormPage from './components/DatabaseFormPage.vue';
import AiSidePanel from './components/AiSidePanel.vue';
import SecondaryPane from './components/SecondaryPane.vue';
import { api, AUTH_EXPIRED_EVENT } from './api/client';
import { editorDocToMarkdown, editorDocToMarkdownAsync, fallbackDoc } from './utils/editorDoc';
import { SYSTEM_ADMIN_ID } from './constants/system-admin';

const CHEVRON_RIGHT = 'M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z';
const UNTITLED_PAGE_LABEL = 'Untitled page';

const isDevMode = computed(() => typeof window !== 'undefined' && window.location?.pathname === '/dev');
const workspace = useWorkspaceStore();
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
const isWorkspaceOwner = computed(() => activeWorkspaceRole.value === 'OWNER');
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
const userInitials = computed(() => {
  const name = activeUser.value?.name?.trim() || '';
  if (!name) return '?';
  const parts = name.split(/\s+/);
  const initials = parts.map((part) => part?.[0]?.toUpperCase()).filter(Boolean).join('');
  return initials.slice(0, 2) || name.charAt(0).toUpperCase();
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
// Move to workspace modal
const showMoveWorkspaceModal = ref(false);
const moveWorkspacePage = ref(null);    // root page being moved
const moveWorkspaceSubtree = ref([]);   // [root, ...descendants] ordered breadth-first
const moveWorkspaceTargetId = ref(null);
const moveWorkspaceLoading = ref(false);
const moveWorkspaceError = ref('');

const buildMoveSubtree = (rootPage) => {
  if (!rootPage) return [];
  const allPages = pages.value;
  const childrenOf = (parentId) => allPages.filter((p) => p.parentId === parentId && !p.isDeleted && !p.isHidden);
  const result = [];
  const walk = (page, depth) => {
    result.push({ ...page, _depth: depth });
    childrenOf(page.id).forEach((child) => walk(child, depth + 1));
  };
  walk(rootPage, 0);
  return result;
};

const openMoveToWorkspaceModal = (page) => {
  moveWorkspacePage.value = page;
  moveWorkspaceSubtree.value = buildMoveSubtree(page);
  moveWorkspaceTargetId.value = null;
  moveWorkspaceError.value = '';
  showMoveWorkspaceModal.value = true;
  menuOpenFor.value = null;
};
const closeMoveWorkspaceModal = () => {
  showMoveWorkspaceModal.value = false;
  moveWorkspacePage.value = null;
  moveWorkspaceSubtree.value = [];
  moveWorkspaceTargetId.value = null;
  moveWorkspaceError.value = '';
};
const confirmMoveToWorkspace = async () => {
  if (!moveWorkspacePage.value || !moveWorkspaceTargetId.value) return;
  moveWorkspaceLoading.value = true;
  moveWorkspaceError.value = '';
  try {
    await workspace.movePageToWorkspace(moveWorkspacePage.value.id, moveWorkspaceTargetId.value);
    closeMoveWorkspaceModal();
  } catch (err) {
    moveWorkspaceError.value = err?.message || 'Failed to move pages';
  } finally {
    moveWorkspaceLoading.value = false;
  }
};
const otherWorkspaces = computed(() =>
  workspaces.value.filter((entry) => entry.workspace?.id && entry.workspace.id !== activeWorkspaceId.value)
);

const showCreateWorkspaceModal = ref(false);
const newWorkspaceName = ref('');
const createWsError = ref('');
const createWsLoading = ref(false);
const showExportModal = ref(false);
const exportFormat = ref('html');
const exportTheme = ref('light');
const exportScale = ref(1);
const menuOpenFor = ref(null);
const expanded = ref({});
const showEmojiPicker = ref(false);
const showSettingsPopup = ref(false);
const settingsTab = ref('General');
const showBinModal = ref(false);
const members = ref([]);
const membersLoading = ref(false);
const membersError = ref('');
const setupError = ref('');
const setupSaving = ref(false);
const setupAutoCompleteTriggered = ref(false);
const setupSeedDoc = ref(null);
const showComplianceSetupModal = ref(false);
const complianceSetupAllowTitle = ref(false);
const complianceSetupTitle = ref('');
const complianceSetupTemplate = ref('inventory');
const complianceSetupFields = ref([]);
const complianceSetupTransitions = ref([]);
const complianceSetupError = ref('');
const complianceSetupResolver = ref(null);
const complianceSetupFieldSeed = ref(0);
const complianceSetupTransitionSeed = ref(0);
const complianceFieldTypes = [
  { id: 'TEXT', label: 'Text' },
  { id: 'NUMBER', label: 'Number' },
  { id: 'DATE', label: 'Date' },
  { id: 'CHECKBOX', label: 'Checkbox' },
  { id: 'ASSET_TAG', label: 'Asset Tag (QR)' },
  { id: 'SELECT', label: 'Select' },
  { id: 'MULTI_SELECT', label: 'Multi-select' },
  { id: 'RELATION', label: 'Relation' },
  { id: 'URL', label: 'URL' },
];
const complianceStatuses = [
  { id: 'draft', label: 'Draft' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'review', label: 'In Review' },
  { id: 'closed', label: 'Closed/Sealed' },
  { id: 'archived', label: 'Archived' },
];
const complianceDatabaseOptions = computed(() =>
  pages.value.filter(
    (page) => page.kind === 'DATABASE' && page.databaseComplianceMode === true && !page.isDeleted && !page.isHidden
  )
);
const inventoryTemplateFields = [
  { name: 'Item Name', type: 'TEXT', isTitle: true },
  { name: 'Asset Tag', type: 'ASSET_TAG' },
  { name: 'SKU', type: 'TEXT' },
  { name: 'Category', type: 'SELECT', choices: ['Raw Materials', 'Components', 'Finished Goods', 'Consumables', 'Tools'] },
  { name: 'Location', type: 'TEXT' },
  { name: 'Quantity On Hand', type: 'NUMBER' },
  { name: 'Unit', type: 'SELECT', choices: ['ea', 'box', 'kg', 'L', 'm'] },
  { name: 'Reorder Point', type: 'NUMBER' },
  { name: 'Supplier', type: 'TEXT' },
  { name: 'Lot/Batch', type: 'TEXT' },
  { name: 'Serial Number', type: 'TEXT' },
  { name: 'Expiry Date', type: 'DATE' },
  { name: 'Status', type: 'SELECT', choices: ['In Stock', 'Low', 'Out', 'Reserved', 'Discontinued'] },
  { name: 'Notes', type: 'TEXT' },
];
const maintenanceTemplateFields = [
  { name: 'Maintenance Summary', type: 'TEXT', isTitle: true },
  { name: 'Item', type: 'RELATION' },
  { name: 'Event Type', type: 'SELECT', choices: ['Inspection', 'Repair', 'Cleaning', 'Calibration', 'Upgrade', 'Other'] },
  { name: 'Scheduled Date', type: 'DATE' },
  { name: 'Completed Date', type: 'DATE' },
  { name: 'Status', type: 'SELECT', choices: ['Planned', 'In Progress', 'Completed', 'Cancelled'] },
  { name: 'Performed By', type: 'TEXT' },
  { name: 'Vendor', type: 'TEXT' },
  { name: 'Cost', type: 'NUMBER' },
  { name: 'Downtime (hrs)', type: 'NUMBER' },
  { name: 'Findings', type: 'TEXT' },
  { name: 'Actions Taken', type: 'TEXT' },
  { name: 'Parts Used', type: 'TEXT' },
  { name: 'Notes', type: 'TEXT' },
];
const assignmentsTemplateFields = [
  { name: 'Assignment Summary', type: 'TEXT', isTitle: true },
  { name: 'Asset', type: 'RELATION' },
  { name: 'Status', type: 'SELECT', choices: ['Open', 'In Progress', 'Blocked', 'Completed', 'Cancelled'] },
  { name: 'Priority', type: 'SELECT', choices: ['Low', 'Medium', 'High', 'Urgent'] },
  { name: 'Task Type', type: 'SELECT', choices: ['Inspection', 'Repair', 'Cleaning', 'Calibration', 'Move', 'Other'] },
  { name: 'Assigned To', type: 'TEXT' },
  { name: 'Requested By', type: 'TEXT' },
  { name: 'Requested Date', type: 'DATE' },
  { name: 'Due Date', type: 'DATE' },
  { name: 'Completed Date', type: 'DATE' },
  { name: 'Estimated Hours', type: 'NUMBER' },
  { name: 'Actual Hours', type: 'NUMBER' },
  { name: 'Work Order Ref', type: 'TEXT' },
  { name: 'Notes', type: 'TEXT' },
];
const resolveComplianceTemplate = (template) => {
  if (template === 'blank' || template === 'inventory' || template === 'maintenance' || template === 'assignments') {
    return template;
  }
  return 'inventory';
};
const complianceTemplateFields = {
  inventory: inventoryTemplateFields,
  maintenance: maintenanceTemplateFields,
  assignments: assignmentsTemplateFields,
};
const setupDebugEnabled = () =>
  typeof window !== 'undefined' && window.localStorage?.getItem('wikid:debug-setup') === '1';
const logSetup = (...args) => {
  if (setupDebugEnabled()) {
    console.log('[setup-flow]', ...args);
  }
};
const inviteUserId = ref('');
const inviteName = ref('');
const inviteRole = ref('EDITOR');
const memberActionLoading = ref({});
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
  if (!canEditWorkspace.value) return;
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
  if (!canEditWorkspace.value) return;
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
  workspace.applyCollabIcon(next);
};

const handleIconYChange = (event) => {
  applyIconFromY();
  const origin = event?.transaction?.origin ?? event?.state;
  if (origin === 'icon-local') {
    persistCollabIcon(iconYMap.value?.get('icon') || null);
  }
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
  const existingIcon = iconYMap.value.get('icon') || null;
  if (!existingIcon && workspace.currentPage?.icon) {
    // Seed from current page icon without persisting immediately.
    iconYMap.value.set('icon', workspace.currentPage.icon);
  }
  const syncedHandler = ({ state }) => {
    if (state && titleYText.value) {
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
  window.addEventListener('hashchange', focusBlockFromHash);
  window.addEventListener('wikid:api-status', handleApiStatus);
  window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
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

watch(settingsTab, (tab) => {
  if (tab === 'Members' && activeWorkspaceId.value && showSettingsPopup.value) {
    loadMembers();
  }
  if (tab === 'Workspace') {
    renameWorkspaceDraft.value = activeWorkspaceName.value;
    renameWorkspaceError.value = '';
  }
});

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
  window.removeEventListener('hashchange', focusBlockFromHash);
  window.removeEventListener('wikid:api-status', handleApiStatus);
  window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
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
  if (!isSetupPage.value || setupAutoCompleteTriggered.value || setupSaving.value || !canEditWorkspace.value) {
    logSetup('update', {
      setup: isSetupPage.value,
      triggered: setupAutoCompleteTriggered.value,
      saving: setupSaving.value,
      canEdit: canEditWorkspace.value,
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
  if (!canEditWorkspace.value) return;
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
  if (!canEditWorkspace.value) return;
  if (isDatabasePage.value) return;
  if (!showWikiHomeDoc.value) return;
  event?.preventDefault?.();
  const editorRef = tiptapEditorRef.value;
  if (editorRef?.insertParagraphAtTop) {
    editorRef.insertParagraphAtTop();
  }
};

const exportMarkdown = async () => {
  const title = workspace.currentPage?.title?.trim() || 'page';
  const user = activeUser.value;
  const markdown = await editorDocToMarkdownAsync(doc.value, (pageId) =>
    api.getDatabase(pageId, { userId: user?.id, userName: user?.name }),
  );
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title}.md`;
  link.click();
  URL.revokeObjectURL(url);
};

const openExportModal = (format) => {
  exportFormat.value = format || 'html';
  showExportModal.value = true;
  if (exportFormat.value === 'html') {
    const page = workspace.currentPage;
    exportHtmlMode.value = 'scroll';
    exportHtmlSelectRoot(page?.id || null);
    scrollExportTreeToRoot(page?.id);
  }
};
const closeExportModal = () => {
  showExportModal.value = false;
  exportHtmlRootIds.value = new Set();
  exportHtmlChecked.value = new Set();
  exportHtmlExporting.value = false;
};
const exportPdf = () => {
  if (!workspace.currentPage?.id || !activeUser.value) return;
  const url = api.exportPagePdfUrl(workspace.currentPage.id, {
    userId: activeUser.value.id,
    userName: activeUser.value.name,
    theme: exportTheme.value,
    scale: exportScale.value,
  });
  window.open(url, '_blank');
  closeExportModal();
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
const openAdminView = (view) => {
  closeMenu();
  showUserMenu.value = false;
  showSettingsPopup.value = false;
  activeView.value = view;
};
const openSettingsPopup = () => {
  closeMenu();
  showUserMenu.value = false;
  settingsTab.value = 'General';
  showSettingsPopup.value = true;
};
const closeSettingsPopup = () => {
  showSettingsPopup.value = false;
  settingsTab.value = 'General';
  cpCurrent.value = '';
  cpNew.value = '';
  cpConfirm.value = '';
  cpError.value = '';
  cpSuccess.value = false;
  membersError.value = '';
  showDeleteWorkspaceConfirm.value = false;
};
const selectSettingsTab = (tab) => {
  settingsTab.value = tab;
};
const toggleThemeMode = () => {
  isDarkTheme.value = !isDarkTheme.value;
  applyTheme(isDarkTheme.value);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('wikid:theme', isDarkTheme.value ? 'dark' : 'light');
  }
};
const loginEmail = ref('');
const loginPassword = ref('');
const loginError = ref('');
const loginLoading = ref(false);
const handleLogin = async () => {
  loginError.value = '';
  loginLoading.value = true;
  try {
    await workspace.login(loginEmail.value, loginPassword.value);
    loginEmail.value = '';
    loginPassword.value = '';
  } catch (err) {
    loginError.value = err?.message || 'Invalid email or password';
  } finally {
    loginLoading.value = false;
  }
};
const cpCurrent = ref('');
const cpNew = ref('');
const cpConfirm = ref('');
const cpError = ref('');
const cpSuccess = ref(false);
const cpLoading = ref(false);
const openChangePassword = () => {
  cpCurrent.value = '';
  cpNew.value = '';
  cpConfirm.value = '';
  cpError.value = '';
  cpSuccess.value = false;
  showUserMenu.value = false;
  settingsTab.value = 'Password';
  showSettingsPopup.value = true;
};
const handleChangePassword = async () => {
  cpError.value = '';
  cpSuccess.value = false;
  if (!cpNew.value) { cpError.value = 'New password is required'; return; }
  if (cpNew.value !== cpConfirm.value) { cpError.value = 'Passwords do not match'; return; }
  cpLoading.value = true;
  try {
    await workspace.changePassword(cpCurrent.value, cpNew.value);
    cpSuccess.value = true;
    cpCurrent.value = '';
    cpNew.value = '';
    cpConfirm.value = '';
  } catch (err) {
    cpError.value = err?.message || 'Failed to change password';
  } finally {
    cpLoading.value = false;
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
  newWorkspaceName.value = '';
  createWsError.value = '';
  showCreateWorkspaceModal.value = true;
};
const closeCreateWorkspaceModal = () => {
  showCreateWorkspaceModal.value = false;
};
const submitCreateWorkspace = async () => {
  const name = newWorkspaceName.value.trim();
  if (!name) return;
  createWsLoading.value = true;
  createWsError.value = '';
  try {
    await workspace.createWorkspace(name);
    closeCreateWorkspaceModal();
  } catch (err) {
    createWsError.value = err?.message || 'Failed to create workspace';
  } finally {
    createWsLoading.value = false;
  }
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
const createComplianceField = (overrides = {}) => ({
  id: `csf-${(complianceSetupFieldSeed.value += 1)}`,
  name: '',
  type: 'TEXT',
  choices: '',
  relationPageId: '',
  isTitle: false,
  ...overrides,
});
const createComplianceTransition = (overrides = {}) => ({
  id: `cst-${(complianceSetupTransitionSeed.value += 1)}`,
  from: 'draft',
  to: 'submitted',
  guards: { reviewer: false, approval: false, reason: false },
  ...overrides,
});
const choicesToText = (choices) => (Array.isArray(choices) ? choices.join('\n') : '');
const parseChoicesText = (raw) => {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};
const applyComplianceTemplate = (template) => {
  const templateFields = complianceTemplateFields[template];
  const nextFields = Array.isArray(templateFields)
    ? templateFields.map((field) =>
        createComplianceField({
          name: field.name,
          type: field.type,
          choices: choicesToText(field.choices),
          isTitle: !!field.isTitle,
        })
      )
    : [createComplianceField({ name: 'Name', type: 'TEXT', isTitle: true })];
  complianceSetupFields.value = nextFields;
};
const resetComplianceTransitions = () => {
  complianceSetupTransitions.value = [
    createComplianceTransition({ from: 'draft', to: 'submitted' }),
    createComplianceTransition({ from: 'submitted', to: 'review', guards: { reviewer: true, approval: false, reason: false } }),
    createComplianceTransition({ from: 'review', to: 'closed', guards: { reviewer: true, approval: true, reason: false } }),
    createComplianceTransition({ from: 'closed', to: 'review', guards: { reviewer: false, approval: true, reason: true } }),
  ];
};
const addComplianceField = () => {
  const isFirst = complianceSetupFields.value.length === 0;
  const field = createComplianceField({ isTitle: isFirst });
  complianceSetupFields.value = [...complianceSetupFields.value, field];
};
const removeComplianceField = (fieldId) => {
  const next = complianceSetupFields.value.filter((field) => field.id !== fieldId);
  if (next.length && !next.some((field) => field.isTitle)) {
    next[0] = { ...next[0], isTitle: true, type: 'TEXT' };
  }
  complianceSetupFields.value = next;
};
const clearComplianceFields = () => {
  complianceSetupFields.value = [];
};
const setComplianceTitleField = (fieldId) => {
  complianceSetupFields.value = complianceSetupFields.value.map((field) => {
    const isTitle = field.id === fieldId;
    return {
      ...field,
      isTitle,
      type: isTitle ? 'TEXT' : field.type,
    };
  });
};
const addComplianceTransition = () => {
  const transition = createComplianceTransition({ from: 'submitted', to: 'review' });
  complianceSetupTransitions.value = [...complianceSetupTransitions.value, transition];
};
const removeComplianceTransition = (transitionId) => {
  complianceSetupTransitions.value = complianceSetupTransitions.value.filter((entry) => entry.id !== transitionId);
};
const buildComplianceFieldsPayload = () => {
  const trimmed = complianceSetupFields.value
    .map((field) => ({
      ...field,
      name: typeof field.name === 'string' ? field.name.trim() : '',
    }))
    .filter((field) => field.name);
  if (!trimmed.length) {
    complianceSetupError.value = 'Add at least one field before creating the database.';
    return null;
  }
  const missingRelation = trimmed.some(
    (field) => field.type === 'RELATION' && (!field.relationPageId || !String(field.relationPageId).trim())
  );
  if (missingRelation) {
    complianceSetupError.value = 'Choose a target database for each relation field.';
    return null;
  }
  let titleIndex = trimmed.findIndex((field) => field.isTitle);
  if (titleIndex < 0) titleIndex = 0;
  return trimmed.map((field, index) => {
    const options = {};
    let type = field.isTitle || index === titleIndex ? 'TEXT' : field.type;
    if (type === 'ASSET_TAG') {
      type = 'TEXT';
      options.source = 'assetTag';
      options.readonly = true;
    }
    if (field.isTitle || index === titleIndex) {
      options.source = 'page';
    }
    if (type === 'RELATION') {
      const targetId = typeof field.relationPageId === 'string' ? field.relationPageId.trim() : '';
      if (targetId) {
        options.relation = { pageId: targetId, allowMultiple: false };
      }
    }
    if (type === 'SELECT' || type === 'MULTI_SELECT') {
      const choices = parseChoicesText(field.choices);
      if (choices.length) options.choices = choices;
    }
    return { name: field.name, type, options };
  });
};
const buildComplianceWorkflowPayload = () => {
  const transitions = complianceSetupTransitions.value
    .filter((entry) => entry.from && entry.to)
    .map((entry) => {
      const guards = [];
      if (entry.guards?.reviewer) guards.push({ type: 'role', value: 'reviewer' });
      if (entry.guards?.approval) guards.push({ type: 'approval' });
      if (entry.guards?.reason) guards.push({ type: 'reason' });
      return { from: entry.from, to: entry.to, guards };
    });
  return {
    states: complianceStatuses.map((state) => ({ id: state.id, label: state.label })),
    transitions,
  };
};
const requestComplianceSetup = (options = {}) => {
  if (!canEditWorkspace.value) return Promise.resolve(null);
  const allowTitle = options.allowTitle === true;
  const defaultTitle = typeof options.defaultTitle === 'string' ? options.defaultTitle : 'Untitled database';
  const template = resolveComplianceTemplate(options.template);
  complianceSetupAllowTitle.value = allowTitle;
  complianceSetupTitle.value = defaultTitle;
  complianceSetupTemplate.value = template;
  complianceSetupError.value = '';
  complianceSetupFieldSeed.value = 0;
  complianceSetupTransitionSeed.value = 0;
  applyComplianceTemplate(template);
  resetComplianceTransitions();
  showComplianceSetupModal.value = true;
  return new Promise((resolve) => {
    complianceSetupResolver.value = resolve;
  });
};
const closeComplianceSetupModal = () => {
  showComplianceSetupModal.value = false;
  const resolver = complianceSetupResolver.value;
  complianceSetupResolver.value = null;
  if (resolver) resolver(null);
};
const submitComplianceSetupModal = () => {
  complianceSetupError.value = '';
  const fields = buildComplianceFieldsPayload();
  if (!fields) return;
  const workflow = buildComplianceWorkflowPayload();
  const result = { database: { fields, workflow } };
  if (complianceSetupAllowTitle.value) {
    const title = complianceSetupTitle.value.trim();
    if (title) result.title = title;
  }
  showComplianceSetupModal.value = false;
  const resolver = complianceSetupResolver.value;
  complianceSetupResolver.value = null;
  if (resolver) resolver(result);
};
const handleComplianceSetup = async () => {
  if (!workspace.currentPage || !canEditWorkspace.value) return;
  const result = await requestComplianceSetup({
    allowTitle: false,
    defaultTitle: workspace.currentPage?.title || 'Untitled database',
    template: 'inventory',
  });
  if (!result) return;
  await chooseSetupKind('DATABASE', { complianceMode: true, database: result.database });
};
const chooseSetupKind = async (kind, options = {}) => {
  if (!workspace.currentPage || !workspace.activeUser || !canEditWorkspace.value) return false;
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
const loadMembers = async () => {
  if (!activeWorkspaceId.value || !activeUser.value) return;
  membersLoading.value = true;
  membersError.value = '';
  try {
    const data = await api.listWorkspaceMembers(activeWorkspaceId.value, { userId: activeUser.value.id });
    members.value = Array.isArray(data) ? data : [];
  } catch (err) {
    membersError.value = err?.message || 'Failed to load members';
  } finally {
    membersLoading.value = false;
  }
};
const openMembersModal = async () => {
  closeMenu();
  showUserMenu.value = false;
  settingsTab.value = 'Members';
  showSettingsPopup.value = true;
  await loadMembers();
};
const closeMembersModal = () => {
  closeSettingsPopup();
};
const showDeleteWorkspaceConfirm = ref(false);
const deletingWorkspace = ref(false);
const renameWorkspaceDraft = ref('');
const renamingWorkspace = ref(false);
const renameWorkspaceError = ref('');
const handleRenameWorkspace = async () => {
  const name = renameWorkspaceDraft.value.trim();
  if (!name || name === activeWorkspaceName.value) return;
  renamingWorkspace.value = true;
  renameWorkspaceError.value = '';
  try {
    await workspace.renameWorkspace(activeWorkspaceId.value, name);
  } catch (err) {
    renameWorkspaceError.value = err?.message || 'Failed to rename workspace';
  } finally {
    renamingWorkspace.value = false;
  }
};
const handleDeleteWorkspace = async () => {
  if (!activeWorkspaceId.value) return;
  deletingWorkspace.value = true;
  try {
    await workspace.deleteWorkspace(activeWorkspaceId.value);
    showDeleteWorkspaceConfirm.value = false;
    closeMembersModal();
  } catch (err) {
    membersError.value = err?.message || 'Failed to delete workspace';
  } finally {
    deletingWorkspace.value = false;
  }
};
const inviteMember = async () => {
  if (!activeWorkspaceId.value || !activeUser.value || !isWorkspaceOwner.value) return;
  const name = inviteName.value.trim();
  const userId = inviteUserId.value.trim();
  if (!name && !userId) {
    membersError.value = 'Provide a user name or user ID.';
    return;
  }
  memberActionLoading.value = { ...memberActionLoading.value, invite: true };
  membersError.value = '';
  try {
    await api.addWorkspaceMember(
      activeWorkspaceId.value,
      { userId: userId || undefined, name: name || undefined, role: inviteRole.value },
      { userId: activeUser.value.id }
    );
    inviteName.value = '';
    inviteUserId.value = '';
    await loadMembers();
  } catch (err) {
    membersError.value = err?.message || 'Failed to invite member';
  } finally {
    const next = { ...memberActionLoading.value };
    delete next.invite;
    memberActionLoading.value = next;
  }
};
const updateMemberRole = async (memberId, role) => {
  if (!activeWorkspaceId.value || !activeUser.value || !isWorkspaceOwner.value) return;
  memberActionLoading.value = { ...memberActionLoading.value, [memberId]: true };
  membersError.value = '';
  try {
    await api.updateWorkspaceMember(activeWorkspaceId.value, memberId, { role }, { userId: activeUser.value.id });
    await loadMembers();
  } catch (err) {
    membersError.value = err?.message || 'Failed to update role';
  } finally {
    const next = { ...memberActionLoading.value };
    delete next[memberId];
    memberActionLoading.value = next;
  }
};
const removeMember = async (memberId) => {
  if (!activeWorkspaceId.value || !activeUser.value || !isWorkspaceOwner.value) return;
  const confirmed = window.confirm('Remove this member from the workspace?');
  if (!confirmed) return;
  memberActionLoading.value = { ...memberActionLoading.value, [memberId]: true };
  membersError.value = '';
  try {
    await api.removeWorkspaceMember(activeWorkspaceId.value, memberId, { userId: activeUser.value.id });
    await loadMembers();
  } catch (err) {
    membersError.value = err?.message || 'Failed to remove member';
  } finally {
    const next = { ...memberActionLoading.value };
    delete next[memberId];
    memberActionLoading.value = next;
  }
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
// HTML export state
const exportHtmlMode = ref('scroll');
const exportHtmlRootIds = ref(new Set()); // empty = whole workspace
const exportHtmlChecked = ref(new Set());
const exportHtmlExporting = ref(false);

const exportHtmlFullTree = computed(() => {
  const allPages = pages.value.filter((p) => !p.isDeleted && !p.isHidden);
  const childrenOf = (parentId) => allPages.filter((p) => p.parentId === parentId);
  const result = [];
  const walk = (page, depth) => {
    result.push({ ...page, _depth: depth });
    childrenOf(page.id).forEach((child) => walk(child, depth + 1));
  };
  allPages.filter((p) => !p.parentId).forEach((root) => walk(root, 0));
  return result;
});

const exportHtmlSubtreeIds = computed(() => {
  const roots = exportHtmlRootIds.value;
  if (!roots.size) return new Set(exportHtmlFullTree.value.map((p) => p.id));
  const allPages = pages.value.filter((p) => !p.isDeleted && !p.isHidden);
  const childrenOf = (parentId) => allPages.filter((p) => p.parentId === parentId);
  const ids = new Set();
  const walk = (id) => {
    ids.add(id);
    childrenOf(id).forEach((child) => walk(child.id));
  };
  for (const rootId of roots) walk(rootId);
  return ids;
});

const exportHtmlCheckedCount = computed(() => {
  let count = 0;
  for (const entry of exportHtmlFullTree.value) {
    if (exportHtmlChecked.value.has(entry.id)) count++;
  }
  return count;
});

const getSubtreeIds = (pageId) => {
  const allPages = pages.value.filter((p) => !p.isDeleted && !p.isHidden);
  const childrenOf = (parentId) => allPages.filter((p) => p.parentId === parentId);
  const ids = new Set();
  const walk = (id) => { ids.add(id); childrenOf(id).forEach((c) => walk(c.id)); };
  walk(pageId);
  return ids;
};

const exportHtmlSelectRoot = (pageId) => {
  if (pageId) {
    exportHtmlRootIds.value = new Set([pageId]);
    exportHtmlChecked.value = getSubtreeIds(pageId);
  } else {
    exportHtmlRootIds.value = new Set();
    const allPages = pages.value.filter((p) => !p.isDeleted && !p.isHidden);
    exportHtmlChecked.value = new Set(allPages.map((p) => p.id));
  }
};

const exportHtmlToggleCheck = (pageId) => {
  if (!exportHtmlSubtreeIds.value.has(pageId)) return;
  const allPages = pages.value.filter((p) => !p.isDeleted && !p.isHidden);
  const childrenOf = (parentId) => allPages.filter((p) => p.parentId === parentId);
  const descendants = [];
  const walk = (id) => { descendants.push(id); childrenOf(id).forEach((c) => walk(c.id)); };
  walk(pageId);
  const next = new Set(exportHtmlChecked.value);
  const excluding = next.has(pageId);
  for (const id of descendants) {
    if (excluding) next.delete(id); else next.add(id);
  }
  exportHtmlChecked.value = next;
};

const exportHtmlRowClick = (pageId, event) => {
  if (event.shiftKey) {
    if (exportHtmlSubtreeIds.value.has(pageId)) {
      exportHtmlToggleCheck(pageId);
    } else {
      // Add this tree to the selection
      const nextRoots = new Set(exportHtmlRootIds.value);
      nextRoots.add(pageId);
      exportHtmlRootIds.value = nextRoots;
      const nextChecked = new Set(exportHtmlChecked.value);
      for (const id of getSubtreeIds(pageId)) nextChecked.add(id);
      exportHtmlChecked.value = nextChecked;
    }
  } else {
    exportHtmlSelectRoot(pageId);
  }
};

const exportHtmlTreeRef = ref(null);
const scrollExportTreeToRoot = (pageId) => {
  if (!pageId) return;
  nextTick(() => {
    const container = exportHtmlTreeRef.value;
    if (!container) return;
    const row = container.querySelector(`[data-page-id="${pageId}"]`);
    if (row) row.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
};
const exportPageHtml = (page) => {
  closeMenu();
  exportFormat.value = 'html';
  exportHtmlMode.value = 'scroll';
  showExportModal.value = true;
  exportHtmlSelectRoot(page?.id || null);
  scrollExportTreeToRoot(page?.id);
};

const confirmExportHtml = async () => {
  exportHtmlExporting.value = true;
  try {
    // Brief delay to let any in-flight WebSocket syncs (cell edits, typing) reach the collab server
    await new Promise((resolve) => setTimeout(resolve, 500));
    const roots = exportHtmlRootIds.value;
    const allIds = new Set(exportHtmlFullTree.value.map((p) => p.id));
    const excludeIds = [];
    for (const id of allIds) {
      if (!exportHtmlChecked.value.has(id)) excludeIds.push(id);
    }
    const params = {
      mode: exportHtmlMode.value,
      excludeIds: excludeIds.length ? excludeIds : undefined,
    };
    if (roots.size === 1) {
      params.rootPageId = [...roots][0];
    } else {
      params.workspaceId = workspace.activeWorkspaceId;
    }
    const { blob, filename } = await api.exportHtml(params);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    closeExportModal();
  } catch (err) {
    console.warn('Export failed', err);
    exportHtmlExporting.value = false;
  }
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
const toggleExpand = (id) => {
  expanded.value[id] = !expanded.value[id];
};

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
  if (!canEditWorkspace.value) return;
  if (showEmojiPicker.value) {
    closeEmojiPicker();
    return;
  }
  showEmojiPicker.value = true;
};
const choosePageIcon = (value) => {
  if (!canEditWorkspace.value) return;
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
const restoreFromBin = async (page) => {
  await workspace.restorePageFromBin(page);
  await workspace.loadBinPages();
};
const destroyBin = async () => {
  if (!workspace.binPages.length) {
    closeBin();
    return;
  }
  const ids = workspace.binPages.map((p) => p.id);
  await workspace.destroyBin(ids);
  await workspace.loadBinPages();
  closeBin();
};

if (typeof window !== 'undefined') {
  window.addEventListener('wikid:open-bin', openBin);
}

const PageTree = defineComponent({
  name: 'PageTree',
  props: {
    pages: { type: Array, required: true },
    parentId: { type: String, default: null },
    depth: { type: Number, default: 0 },
    activeId: { type: String, default: null },
    menuOpenFor: { type: [String, null], default: null },
    canEdit: { type: Boolean, default: true },
    isExpanded: { type: Function, required: true },
    toggleExpand: { type: Function, required: true },
    select: { type: Function, required: true },
    toggleMenu: { type: Function, required: true },
    duplicate: { type: Function, required: true },
    rename: { type: Function, required: true },
    moveVisibility: { type: Function, required: true },
    remove: { type: Function, required: true },
    exportHtml: { type: Function, required: false },
    addChild: { type: Function, required: true },
    toggleTree: { type: Function, required: true },
    convertToWiki: { type: Function, required: false },
    openInSplit: { type: Function, required: false },
    openInMoveWorkspace: { type: Function, required: false },
    onReorder: { type: Function, required: false },
  },
  setup(props) {
    const suppressClickUntil = ref(0);
    const suppressClickAfterDrag = () => {
      suppressClickUntil.value = Date.now() + 300;
    };
    const shouldSuppressClick = () => Date.now() < suppressClickUntil.value;
    const childrenMap = computed(() => {
      const map = new Map();
      props.pages.forEach((page) => {
        const parentId = page.parentId ?? null;
        if (!map.has(parentId)) {
          map.set(parentId, []);
        }
        map.get(parentId).push(page);
      });
      // keep children ordered by their position so tree reflects reorder immediately
      for (const [key, list] of map.entries()) {
        map.set(
          key,
          [...list].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
        );
      }
      return map;
    });

    const childrenOf = (parentId) => childrenMap.value.get(parentId ?? null) ?? [];

    const collectDescendants = (rootId) => {
      const stack = [rootId];
      const descendants = [];
      while (stack.length) {
        const currentId = stack.pop();
        const children = childrenOf(currentId);
        children.forEach((child) => {
          descendants.push(child.id);
          stack.push(child.id);
        });
      }
      return descendants;
    };

    const isSubtreeFullyExpanded = (rootId) => {
      const descendants = collectDescendants(rootId);
      return descendants.length > 0 && descendants.every((id) => props.isExpanded(id));
    };

    const renderNode = (page, depth) => {
          const isOpen = props.isExpanded(page.id);
          const children = childrenOf(page.id);
          const subtreeFullyExpanded = isSubtreeFullyExpanded(page.id);
          const treeActionLabel = subtreeFullyExpanded ? 'Collapse all' : 'Expand all';
      const isDragging = ref(false);
      const isDragOver = ref(false);
      const dropMode = ref('none'); // 'into' or 'above'
          const handleTreeAction = (event) => {
            event.stopPropagation();
            props.toggleTree(page, props.pages, subtreeFullyExpanded);
          };

      const handleDragStart = (event) => {
        if (!props.canEdit || !props.onReorder) return;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/json', JSON.stringify({ id: page.id, parentId: page.parentId ?? null }));
        isDragging.value = true;
    };

      const handleDragEnd = () => {
        isDragging.value = false;
        isDragOver.value = false;
        if (typeof document !== 'undefined') {
          document.querySelectorAll('.drag-over').forEach((el) => {
            el.classList.remove('drag-over');
            el.removeAttribute('data-dragover');
            el.removeAttribute('data-drop-mode');
          });
        }
      };

      const handleDragOver = (event) => {
        if (!props.onReorder || !props.canEdit) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        isDragOver.value = true;
        if (event.currentTarget) {
          event.currentTarget.classList.add('drag-over');
          event.currentTarget.setAttribute('data-dragover', 'true');
          const rect = event.currentTarget.getBoundingClientRect();
          const offsetY = event.clientY - rect.top;
          const ratio = rect.height ? offsetY / rect.height : 0.5;
          // top edge = above, everything else = into (prevents bottom edge misclassifying as above)
          const nextMode = ratio <= 0.2 ? 'above' : 'into';
          dropMode.value = nextMode;
          event.currentTarget.setAttribute('data-drop-mode', nextMode);
        }
      };

      const clearDragVisual = (targetEl) => {
        if (targetEl?.classList) {
          targetEl.classList.remove('drag-over');
        }
        if (targetEl?.removeAttribute) {
          targetEl.removeAttribute('data-dragover');
          targetEl.removeAttribute('data-drop-mode');
        }
      };

      const handleDragLeave = (event) => {
        isDragOver.value = false;
        dropMode.value = 'none';
        clearDragVisual(event?.currentTarget);
      };

      const handleDrop = (event) => {
        if (!props.onReorder || !props.canEdit) return;
        event.preventDefault();
        // Recompute mode on drop in case dragleave fired before drop
        const el = event.currentTarget;
        if (el) {
          const rect = el.getBoundingClientRect();
          const offsetY = event.clientY - rect.top;
          const ratio = rect.height ? offsetY / rect.height : 0.5;
          const nextMode = ratio <= 0.2 ? 'above' : 'into';
          dropMode.value = nextMode;
          el.setAttribute('data-drop-mode', nextMode);
        }
        try {
          const data = JSON.parse(event.dataTransfer.getData('application/json'));
        if (data?.id && data.id !== page.id) {
          props.onReorder({
            draggedId: data.id,
            targetId: page.id,
            targetParentId: page.parentId ?? null,
            dropMode: dropMode.value === 'into' ? 'into' : 'above',
          });
        }
        } catch {
          // ignore malformed drops
        }
        suppressClickAfterDrag();
        isDragOver.value = false;
        dropMode.value = 'none';
        clearDragVisual(event?.currentTarget);
      };

      const row = h(
        'div',
        {
          class: ['sidebar__item', { active: page.id === props.activeId, 'menu-open': props.menuOpenFor === page.id }],
          'data-depth': depth,
          'data-dragging': isDragging.value ? 'true' : 'false',
          'data-dragover': isDragOver.value ? 'true' : 'false',
          'data-drop-mode': dropMode.value,
          onClick: () => {
            if (shouldSuppressClick()) return;
            props.select(page);
          },
          style: { '--sidebar-item-indent': `${depth * indentStep.value}px` },
          draggable: !!props.onReorder,
          ...(props.canEdit ? {} : { draggable: false }),
          onDragstart: handleDragStart,
          onDragend: handleDragEnd,
          onDragover: handleDragOver,
          onDragleave: handleDragLeave,
          onDrop: handleDrop,
          onMouseenter: (e) => {
            const itemEl = e.currentTarget;
            if (itemEl._collapseTimer) {
              clearTimeout(itemEl._collapseTimer);
              itemEl._collapseTimer = null;
            }
            // highlight all items in the same tree branch
            const itemDepth = parseInt(itemEl.dataset.depth) || 0;
            const treeItems = [];
            let root = itemDepth === 0 ? itemEl : null;
            if (!root) {
              let sib = itemEl.previousElementSibling;
              while (sib) {
                if (sib.classList.contains('sidebar__item') && (parseInt(sib.dataset.depth) || 0) === 0) {
                  root = sib;
                  break;
                }
                sib = sib.previousElementSibling;
              }
            }
            if (root) {
              if (root !== itemEl) treeItems.push(root);
              let sib = root.nextElementSibling;
              while (sib && sib.classList.contains('sidebar__item')) {
                if ((parseInt(sib.dataset.depth) || 0) === 0) break;
                if (sib !== itemEl) treeItems.push(sib);
                sib = sib.nextElementSibling;
              }
            }
            treeItems.forEach(el => el.classList.add('tree-hovered'));
            itemEl._treeHoveredItems = treeItems;
          },
          onMouseleave: (e) => {
            const itemEl = e.currentTarget;
            itemEl._collapseTimer = setTimeout(() => {
              (itemEl._treeHoveredItems || []).forEach(el => el.classList.remove('tree-hovered'));
              itemEl._treeHoveredItems = null;
              itemEl._collapseTimer = null;
            }, 300);
          },
        },
        [
          h(
            'div',
            { class: 'page-icon-slot' },
            [
              h(PageIcon, { class: 'page-icon', icon: page.icon, fallback: '📄', 'aria-hidden': 'true' }),
            h(
              'button',
              {
                class: ['page-chevron', { open: isOpen }],
                onClick: (e) => {
                  e.stopPropagation();
                  props.toggleExpand(page.id);
                },
              },
              h(
                'svg',
                {
                  class: 'chevron-icon',
                  viewBox: '0 0 16 16',
                  width: 16,
                  height: 16,
                  fill: 'currentColor',
                  'aria-hidden': 'true',
                },
                [h('path', { 'fill-rule': 'evenodd', d: CHEVRON_RIGHT })]
              )
            ),
          ]),
          h('div', { class: 'sidebar__title' }, page.title || 'Untitled page'),
          props.canEdit
            ? h('div', { class: 'page-actions' }, [
                h('button', {
                  class: 'page-add-btn',
                  onClick: (e) => {
                    e.stopPropagation();
                    props.addChild(page);
                    e.currentTarget?.blur?.();
                  },
                }, '+'),
                h('div', { class: 'page-menu-wrapper' }, [
                  h('button', {
                    class: 'page-menu-btn',
                    onClick: (e) => {
                      e.stopPropagation();
                      props.toggleMenu(page.id);
                      e.currentTarget?.blur?.();
                    },
                  }, '...'),
                  props.menuOpenFor === page.id
                    ? h('div', {
                        class: 'page-menu context-menu',
                        onVnodeMounted(vnode) {
                          const el = vnode.el;
                          if (!el) return;
                          requestAnimationFrame(() => {
                            const rect = el.getBoundingClientRect();
                            if (rect.bottom > window.innerHeight) {
                              el.style.top = 'auto';
                              el.style.bottom = '0';
                            }
                          });
                        },
                      }, [
                        h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.duplicate(page); } }, 'Duplicate'),
                        h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.rename(page); } }, 'Rename'),
                        props.openInSplit
                          ? h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.openInSplit(page.id); props.toggleMenu(null); } }, 'Open in split')
                          : null,
                        props.openInMoveWorkspace
                          ? h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.openInMoveWorkspace(page); props.toggleMenu(null); } }, 'Move to workspace…')
                          : null,
                        props.convertToWiki && page.kind !== 'DATABASE' && !page.isHidden && page.wikiHomeId !== page.id
                          ? h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.convertToWiki(page); } }, 'Turn into wiki')
                          : null,
                        h(
                          'button',
                          {
                            type: 'button',
                            class: 'context-menu__item',
                            onClick: (e) => {
                              e.stopPropagation();
                              props.moveVisibility(page);
                            },
                          },
                          page.visibility === 'PRIVATE' ? 'Move to public' : 'Move to private'
                        ),
                        h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.exportHtml(page); } }, 'Export'),
                        h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.remove(page); } }, 'Delete'),
                        h('button', { type: 'button', class: 'context-menu__item', onClick: handleTreeAction }, treeActionLabel),
                      ])
                    : null,
                ]),
              ])
            : null,
        ]
      );

      const childrenNodes = isOpen
        ? children.length
          ? children.map((child) => renderNode(child, depth + 1))
          : [h('div', { class: 'page-empty', style: { paddingLeft: `${(depth + 1) * 12}px` } }, 'No pages inside')]
        : [];

      return h(Fragment, null, [row, ...childrenNodes]);
    };

    return () => childrenOf(props.parentId).map((page) => renderNode(page, props.depth));
  },
});

const DeleteTreeBranch = defineComponent({
  name: 'DeleteTreeBranch',
  props: {
    nodes: { type: Array, required: true },
  },
  setup(props) {
    const renderBranch = (nodes) =>
      h(
        'ul',
        { class: 'delete-tree-children' },
        nodes.map((node) =>
          h('li', { key: node.id }, [
            h('span', { class: 'delete-tree-title' }, node.title || 'Untitled page'),
            node.children?.length ? renderBranch(node.children) : null,
          ])
        )
      );
    return () => renderBranch(props.nodes || []);
  },
});
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
  <div v-else-if="!activeUser" class="login-page">
    <div class="login-card">
      <h1>Wikid</h1>
      <form class="login-form" @submit.prevent="handleLogin">
        <input
          v-model="loginEmail"
          class="login-input"
          type="email"
          placeholder="Email"
          autocomplete="email"
          required
        />
        <input
          v-model="loginPassword"
          class="login-input"
          type="password"
          placeholder="Password"
          autocomplete="current-password"
          required
        />
        <p v-if="loginError" class="login-error">{{ loginError }}</p>
        <button class="ghost-btn login-submit-btn" type="submit" :disabled="loginLoading">
          {{ loginLoading ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>
  </div>
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
          v-if="showAiPanel && !splitPageId"
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
          :show-ai-toggle="!splitPageId && isDocLayout"
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
                  :disabled="!canEditWorkspace"
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
                :readonly="!canEditWorkspace"
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
                :readonly="!canEditWorkspace"
                @collabready="handleCollabReady"
                @collabpresence="handleDatabasePresence"
              />
              <template v-else>
                <template v-if="showWikiTable">
                  <DatabaseTable
                    v-if="activeWikiDatabasePageId"
                    :page-id="activeWikiDatabasePageId"
                    :readonly="!canEditWorkspace"
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
                    :readonly="!canEditWorkspace"
                  />
                  <TiptapEditor
                    ref="tiptapEditorRef"
                    v-if="activePageId"
                    :key="`${activePageId || 'no-page'}-${editorCollab?.docName || 'local'}`"
                    :doc="doc"
                    :seed-doc="setupSeedDoc"
                    :page-id="activePageId"
                    :collab="editorCollab"
                    :readonly="!canEditWorkspace"
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
                        :disabled="setupSaving || !canEditWorkspace"
                        @click="chooseSetupKind('DOC')"
                      >
                        <div class="create-page__card-title">Page</div>
                        <div class="create-page__card-desc">Rich text docs with headings, blocks, and embeds.</div>
                      </button>
                      <button
                        class="create-page__card"
                        type="button"
                        :disabled="setupSaving || !canEditWorkspace"
                        @click="chooseSetupKind('DATABASE')"
                      >
                        <div class="create-page__card-title">Database</div>
                        <div class="create-page__card-desc">Structured tables with fields, rows, and filters.</div>
                      </button>
                      <button
                        class="create-page__card"
                        type="button"
                        :disabled="setupSaving || !canEditWorkspace"
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

      <div v-if="showComplianceSetupModal" class="modal-backdrop" @click.self="closeComplianceSetupModal">
        <div class="modal-card compliance-setup-modal">
          <h3>Create compliance database</h3>
          <p class="muted">Define the data model and compliance workflow for this database.</p>
          <div class="compliance-setup__body">
            <div v-if="complianceSetupAllowTitle" class="form-field">
              <div class="form-field__label-row">
                <label class="form-field__label">Title</label>
              </div>
              <input v-model="complianceSetupTitle" class="form-input" type="text" placeholder="Inventory database" />
            </div>
            <div class="form-field compliance-template-field">
              <div class="form-field__label-row">
                <label class="form-field__label">Template</label>
              </div>
              <div class="compliance-template__row">
                <select v-model="complianceSetupTemplate" class="form-input">
                  <option value="inventory">Inventory template</option>
                  <option value="maintenance">Maintenance log template</option>
                  <option value="assignments">Assignments template</option>
                  <option value="blank">Blank</option>
                </select>
                <button class="ghost-btn" type="button" @click="applyComplianceTemplate(complianceSetupTemplate)">
                  Apply template
                </button>
              </div>
              <div class="form-field__note muted">Applying a template replaces the current field list.</div>
            </div>
            <div class="compliance-setup__section">
              <div class="compliance-setup__section-header">
                <h4 class="compliance-setup__section-title">Fields</h4>
                <span class="muted">The compliance schema stored with each revision.</span>
              </div>
              <div v-if="!complianceSetupFields.length" class="muted">No fields yet. Add one below.</div>
              <div v-for="field in complianceSetupFields" :key="field.id" class="compliance-field">
                <div class="compliance-field__row">
                  <input
                    v-model="field.name"
                    class="form-input compliance-field__name"
                    type="text"
                    placeholder="Field name"
                  />
                  <select v-model="field.type" class="form-input compliance-field__type" :disabled="field.isTitle">
                    <option v-for="type in complianceFieldTypes" :key="type.id" :value="type.id">
                      {{ type.label }}
                    </option>
                  </select>
                  <label class="compliance-field__title">
                    <input
                      type="radio"
                      name="compliance-title-field"
                      :checked="field.isTitle"
                      @change="setComplianceTitleField(field.id)"
                    />
                    Title field
                  </label>
                  <button class="ghost-btn compliance-field__remove" type="button" @click="removeComplianceField(field.id)">
                    Remove
                  </button>
                </div>
                <div v-if="field.type === 'SELECT' || field.type === 'MULTI_SELECT'" class="compliance-field__choices">
                  <label class="form-field__label">Choices</label>
                  <textarea
                    v-model="field.choices"
                    class="form-input form-input--multi"
                    placeholder="One choice per line"
                  ></textarea>
                </div>
                <div v-if="field.type === 'RELATION'" class="compliance-field__choices">
                  <label class="form-field__label">Target database</label>
                  <select
                    v-model="field.relationPageId"
                    class="form-input"
                    :disabled="!complianceDatabaseOptions.length"
                  >
                    <option value="">Select a compliance database...</option>
                    <option v-for="page in complianceDatabaseOptions" :key="page.id" :value="page.id">
                      {{ page.title || 'Untitled database' }}
                    </option>
                  </select>
                  <div class="form-field__note muted">
                    Relations can only target other compliance databases.
                  </div>
                </div>
              </div>
              <div class="compliance-setup__actions">
                <button class="ghost-btn" type="button" @click="addComplianceField">Add field</button>
                <button class="ghost-btn" type="button" @click="clearComplianceFields">Clear fields</button>
              </div>
            </div>
            <div class="compliance-setup__section">
              <div class="compliance-setup__section-header">
                <h4 class="compliance-setup__section-title">Workflow transitions</h4>
                <span class="muted">Guards are enforced when statuses change.</span>
              </div>
              <div v-for="transition in complianceSetupTransitions" :key="transition.id" class="compliance-transition">
                <div class="compliance-transition__row">
                  <select v-model="transition.from" class="form-input compliance-transition__select">
                    <option v-for="state in complianceStatuses" :key="state.id" :value="state.id">
                      {{ state.label }}
                    </option>
                  </select>
                  <span class="compliance-transition__arrow">-&gt;</span>
                  <select v-model="transition.to" class="form-input compliance-transition__select">
                    <option v-for="state in complianceStatuses" :key="state.id" :value="state.id">
                      {{ state.label }}
                    </option>
                  </select>
                  <button
                    class="ghost-btn compliance-transition__remove"
                    type="button"
                    @click="removeComplianceTransition(transition.id)"
                  >
                    Remove
                  </button>
                </div>
                <div class="compliance-transition__guards">
                  <label class="compliance-transition__guard">
                    <input type="checkbox" v-model="transition.guards.reviewer" />
                    Reviewer
                  </label>
                  <label class="compliance-transition__guard">
                    <input type="checkbox" v-model="transition.guards.approval" />
                    Approval
                  </label>
                  <label class="compliance-transition__guard">
                    <input type="checkbox" v-model="transition.guards.reason" />
                    Reason
                  </label>
                </div>
              </div>
              <div class="compliance-setup__actions">
                <button class="ghost-btn" type="button" @click="addComplianceTransition">Add transition</button>
                <button class="ghost-btn" type="button" @click="resetComplianceTransitions">Reset defaults</button>
              </div>
            </div>
          </div>
          <span v-if="complianceSetupError" class="alert">{{ complianceSetupError }}</span>
          <div class="modal-actions">
            <button class="ghost-btn" type="button" @click="submitComplianceSetupModal">Create</button>
            <button class="ghost-btn" type="button" @click="closeComplianceSetupModal">Cancel</button>
          </div>
        </div>
      </div>

      <div v-if="showCreateWorkspaceModal" class="modal-backdrop" @click.self="closeCreateWorkspaceModal">
        <div class="modal-card">
          <h3>New workspace</h3>
          <form @submit.prevent="submitCreateWorkspace">
            <input
              v-model="newWorkspaceName"
              class="modal-text-input"
              type="text"
              placeholder="Workspace name"
              maxlength="80"
              autofocus
            />
            <p v-if="createWsError" class="modal-error">{{ createWsError }}</p>
            <div class="modal-actions">
              <button class="ghost-btn ghost-btn-background" type="submit" :disabled="!newWorkspaceName.trim() || createWsLoading">
                {{ createWsLoading ? 'Creating…' : 'Create' }}
              </button>
              <button class="ghost-btn" type="button" @click="closeCreateWorkspaceModal">Cancel</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Move to workspace modal -->
      <div v-if="showMoveWorkspaceModal" class="modal-backdrop" @click.self="closeMoveWorkspaceModal">
        <div class="modal-card move-workspace-modal">
          <h3>Move to workspace</h3>
          <p class="muted">The following pages will be moved out of this workspace.</p>
          <div class="move-workspace-modal__body">
            <div class="move-workspace-modal__col move-workspace-modal__col--pages">
              <div class="move-workspace-modal__col-label">Moving</div>
              <div class="move-workspace-modal__page-list">
                <div
                  v-for="entry in moveWorkspaceSubtree"
                  :key="entry.id"
                  class="move-workspace-modal__page-row"
                  :style="{ paddingLeft: `${entry._depth * 16 + 8}px` }"
                >
                  <span class="move-workspace-modal__page-icon" aria-hidden="true">
                    <PageIcon :icon="entry.icon" fallback="📄" />
                  </span>
                  <span class="move-workspace-modal__page-title">{{ entry.title || 'Untitled page' }}</span>
                </div>
              </div>
            </div>
            <div class="move-workspace-modal__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </div>
            <div class="move-workspace-modal__col move-workspace-modal__col--target">
              <div class="move-workspace-modal__col-label">Destination</div>
              <div class="move-workspace-modal__workspace-list">
                <button
                  v-for="entry in otherWorkspaces"
                  :key="entry.workspace?.id"
                  type="button"
                  class="move-workspace-modal__workspace-btn"
                  :class="{ 'move-workspace-modal__workspace-btn--selected': moveWorkspaceTargetId === entry.workspace?.id }"
                  @click="moveWorkspaceTargetId = entry.workspace?.id"
                >
                  <span class="move-workspace-modal__ws-icon" aria-hidden="true">🗂️</span>
                  <span class="move-workspace-modal__ws-name">{{ entry.workspace?.name || 'Workspace' }}</span>
                  <span v-if="moveWorkspaceTargetId === entry.workspace?.id" class="move-workspace-modal__ws-check" aria-hidden="true">✓</span>
                </button>
                <div v-if="!otherWorkspaces.length" class="muted" style="padding: 8px;">No other workspaces available.</div>
              </div>
            </div>
          </div>
          <p v-if="moveWorkspaceError" class="modal-error">{{ moveWorkspaceError }}</p>
          <div class="modal-actions">
            <button
              class="ghost-btn ghost-btn-background"
              type="button"
              :disabled="!moveWorkspaceTargetId || moveWorkspaceLoading"
              @click="confirmMoveToWorkspace"
            >
              {{ moveWorkspaceLoading ? 'Moving…' : `Move ${moveWorkspaceSubtree.length} page${moveWorkspaceSubtree.length !== 1 ? 's' : ''}` }}
            </button>
            <button class="ghost-btn" type="button" @click="closeMoveWorkspaceModal">Cancel</button>
          </div>
        </div>
      </div>

      <div v-if="showExportModal" class="modal-backdrop" @click.self="closeExportModal">
        <div class="modal-card export-html-modal">
          <h3>Export</h3>
          <div class="export-format-bar">
            <button type="button" :class="['export-format-btn', { active: exportFormat === 'html' }]" @click="exportFormat = 'html'">HTML</button>
            <button type="button" :class="['export-format-btn', { active: exportFormat === 'pdf' }]" @click="exportFormat = 'pdf'">PDF</button>
            <button type="button" :class="['export-format-btn', { active: exportFormat === 'markdown' }]" @click="exportFormat = 'markdown'">Markdown</button>
          </div>

          <template v-if="exportFormat === 'html'">
            <p class="muted">Click to select root. Shift+click to exclude pages.</p>
            <div ref="exportHtmlTreeRef" class="export-html-modal__tree">
              <div
                class="export-html-modal__row export-html-modal__row--root"
                :class="{ 'export-html-modal__row--selected': exportHtmlRootIds.size === 0 }"
                @click="exportHtmlSelectRoot(null)"
              >
                <span class="export-html-modal__icon" aria-hidden="true">🗂️</span>
                <span class="export-html-modal__title">Entire workspace</span>
              </div>
              <div
                v-for="entry in exportHtmlFullTree"
                :key="entry.id"
                :data-page-id="entry.id"
                class="export-html-modal__row"
                :class="{
                  'export-html-modal__row--selected': exportHtmlRootIds.has(entry.id),
                  'export-html-modal__row--outside': !exportHtmlSubtreeIds.has(entry.id),
                  'export-html-modal__row--excluded': exportHtmlSubtreeIds.has(entry.id) && !exportHtmlChecked.has(entry.id),
                }"
                :style="{ paddingLeft: `${entry._depth * 16 + 28}px` }"
                @click="exportHtmlRowClick(entry.id, $event)"
              >
                <span class="export-html-modal__icon" aria-hidden="true">
                  <PageIcon :icon="entry.icon" :fallback="entry.kind === 'DATABASE' ? '🗂️' : '📄'" />
                </span>
                <span class="export-html-modal__title">{{ entry.title || 'Untitled page' }}</span>
                <span v-if="entry.kind === 'DATABASE'" class="export-html-modal__badge">Database</span>
              </div>
            </div>
            <div class="export-html-modal__options">
              <span class="export-html-modal__label">Layout</span>
              <div class="export-theme-toggle">
                <button type="button" :class="['export-theme-btn', { active: exportHtmlMode === 'scroll' }]" @click="exportHtmlMode = 'scroll'">Single page</button>
                <button type="button" :class="['export-theme-btn', { active: exportHtmlMode === 'pages' }]" @click="exportHtmlMode = 'pages'">Multi-page</button>
              </div>
            </div>
            <p class="muted export-html-modal__hint">{{ exportHtmlMode === 'scroll' ? 'All pages combined into one scrollable document.' : 'Navigate between pages like a website.' }}</p>
            <div class="modal-actions">
              <button
                class="ghost-btn ghost-btn-background"
                type="button"
                :disabled="exportHtmlExporting || exportHtmlCheckedCount === 0"
                @click="confirmExportHtml"
              >
                {{ exportHtmlExporting ? 'Exporting...' : `Export ${exportHtmlCheckedCount} page${exportHtmlCheckedCount !== 1 ? 's' : ''}` }}
              </button>
              <button class="ghost-btn" type="button" @click="closeExportModal">Cancel</button>
            </div>
          </template>

          <template v-if="exportFormat === 'pdf'">
            <p class="muted">Export the current page as a PDF document.</p>
            <div class="export-option-row">
              <span class="export-option-label">Theme</span>
              <div class="export-theme-toggle">
                <button type="button" :class="['export-theme-btn', { active: exportTheme === 'light' }]" @click="exportTheme = 'light'">Light</button>
                <button type="button" :class="['export-theme-btn', { active: exportTheme === 'dark' }]" @click="exportTheme = 'dark'">Dark</button>
              </div>
            </div>
            <div class="export-option-row">
              <span class="export-option-label">Scale <span class="export-scale-value">{{ Math.round(exportScale * 100) }}%</span></span>
              <input type="range" class="export-scale-slider" min="0.5" max="2" step="0.05" v-model.number="exportScale" />
            </div>
            <div class="modal-actions">
              <button class="ghost-btn ghost-btn-background" type="button" @click="exportPdf">Download PDF</button>
              <button class="ghost-btn" type="button" @click="closeExportModal">Cancel</button>
            </div>
          </template>

          <template v-if="exportFormat === 'markdown'">
            <p class="muted">Export the current page as a Markdown file.</p>
            <div class="modal-actions">
              <button class="ghost-btn ghost-btn-background" type="button" @click="exportMarkdown">Download Markdown</button>
              <button class="ghost-btn" type="button" @click="closeExportModal">Cancel</button>
            </div>
          </template>
        </div>
      </div>
      <div v-if="showUserMenu" class="popover-backdrop left" @click.self="toggleUserMenu($event)">
        <div class="popover-card context-menu">
          <div class="user-menu-header">
            <div class="user-menu-avatar">{{ userInitials }}</div>
            <div class="user-menu-info">
              <p class="user-menu-name">{{ activeUser?.name }}</p>
              <p class="user-menu-hint">Signed in</p>
            </div>
          </div>
          <button class="user-menu__item context-menu__item" type="button" @click="openSettingsPopup">Settings</button>
          <button class="user-menu__item context-menu__item" type="button" @click="handleLogout">Log out</button>
          <div class="user-menu-separator" role="separator"></div>
          <div v-if="!loadingPages" class="user-menu-section">
            <div class="user-menu-section-title">
              <span>Workspaces</span>
              <button
                class="user-menu-action"
                type="button"
                title="Create workspace"
                aria-label="Create workspace"
                @click="openCreateWorkspaceModal"
              >
                +
              </button>
            </div>
            <button
              v-for="entry in workspaces"
              :key="entry.workspace?.id"
              class="user-menu__item context-menu__item user-menu__workspace"
              :class="{ active: entry.workspace?.id === activeWorkspaceId }"
              type="button"
              @click="selectWorkspaceFromMenu(entry.workspace?.id)"
            >
              <span class="user-menu-workspace-left">
                <span class="user-menu-workspace-icon" aria-hidden="true">🗂️</span>
                <span class="user-menu-workspace-name">{{ entry.workspace?.name || 'Workspace' }}</span>
              </span>
              <span class="user-menu-workspace-badges">
                <span class="workspace-doc-count">{{ entry.workspace?._count?.pages ?? 0 }}</span>
                <span class="workspace-role-pill workspace-role-pill--menu">{{ entry.role }}</span>
              </span>
            </button>
            <div v-if="!workspaces.length" class="user-menu-empty">No workspaces yet.</div>
          </div>
        </div>
      </div>
      <div v-if="showSettingsPopup" class="settings-popup-backdrop" @click.self="closeSettingsPopup">
        <div class="settings-popup-card">
          <button class="settings-close-btn" type="button" aria-label="Close settings" @click="closeSettingsPopup">×</button>
          <div class="settings-popup-nav">
            <span class="settings-nav-section-label">Account</span>
            <button
              class="settings-tab"
              :class="{ 'settings-tab--active': settingsTab === 'General' }"
              type="button"
              @click="selectSettingsTab('General')"
            >
              General
            </button>
            <button
              class="settings-tab"
              :class="{ 'settings-tab--active': settingsTab === 'Password' }"
              type="button"
              @click="selectSettingsTab('Password')"
            >
              Password
            </button>
            <template v-if="activeWorkspaceId">
              <span class="settings-nav-section-label settings-nav-section-label--workspace">{{ activeWorkspaceName }}</span>
              <button
                class="settings-tab"
                :class="{ 'settings-tab--active': settingsTab === 'Workspace' }"
                type="button"
                @click="selectSettingsTab('Workspace')"
              >
                Workspace
              </button>
              <button
                class="settings-tab"
                :class="{ 'settings-tab--active': settingsTab === 'Members' }"
                type="button"
                @click="selectSettingsTab('Members')"
              >
                Members
              </button>
              <button
                class="settings-tab"
                :class="{ 'settings-tab--active': settingsTab === 'Export' }"
                type="button"
                @click="selectSettingsTab('Export')"
              >
                Export
              </button>
            </template>
          </div>
          <div class="settings-popup-content">
            <div v-if="settingsTab === 'General'">
              <h3>General</h3>
              <div class="settings-theme-row">
                <span>Color mode</span>
                <button class="ghost-btn ghost-btn-background" type="button" @click="toggleThemeMode">{{ themeModeLabel }}</button>
              </div>
            </div>
            <div v-else-if="settingsTab === 'Password'">
              <h3>Change password</h3>
              <div class="change-password-fields">
                <input v-model="cpCurrent" class="login-input" type="password" placeholder="Current password" autocomplete="current-password" />
                <input v-model="cpNew" class="login-input" type="password" placeholder="New password" autocomplete="new-password" />
                <input v-model="cpConfirm" class="login-input" type="password" placeholder="Confirm new password" autocomplete="new-password" />
              </div>
              <p v-if="cpError" class="login-error">{{ cpError }}</p>
              <p v-if="cpSuccess" class="login-success">Password changed successfully.</p>
              <div class="modal-actions">
                <button class="ghost-btn ghost-btn-background" type="button" :disabled="cpLoading" @click="handleChangePassword">
                  {{ cpLoading ? 'Saving…' : 'Change password' }}
                </button>
              </div>
            </div>
            <div v-else-if="settingsTab === 'Workspace'">
              <h3>Workspace</h3>
              <div class="settings-workspace-info">
                <div class="settings-workspace-row">
                  <span class="muted">Name</span>
                  <div class="settings-rename-row">
                    <input
                      v-model="renameWorkspaceDraft"
                      class="login-input settings-rename-input"
                      type="text"
                      placeholder="Workspace name"
                      @keydown.enter="handleRenameWorkspace"
                    />
                    <button
                      class="ghost-btn ghost-btn-background"
                      type="button"
                      :disabled="renamingWorkspace || !renameWorkspaceDraft.trim() || renameWorkspaceDraft.trim() === activeWorkspaceName"
                      @click="handleRenameWorkspace"
                    >
                      {{ renamingWorkspace ? 'Saving…' : 'Rename' }}
                    </button>
                  </div>
                </div>
                <p v-if="renameWorkspaceError" class="login-error">{{ renameWorkspaceError }}</p>
                <div class="settings-workspace-row">
                  <span class="muted">Pages</span>
                  <span>{{ workspace.pages.length }}</span>
                </div>
              </div>
              <div v-if="isWorkspaceOwner" class="settings-danger-zone">
                <p class="settings-danger-zone__title">Danger zone</p>
                <div v-if="!showDeleteWorkspaceConfirm">
                  <p class="muted">Permanently delete this workspace and all of its pages. This cannot be undone.</p>
                  <button class="ghost-btn ghost-btn-danger" type="button" @click="showDeleteWorkspaceConfirm = true">Delete workspace</button>
                </div>
                <div v-else>
                  <p>This will permanently delete <strong>{{ activeWorkspaceName }}</strong> and all its pages.</p>
                  <div class="modal-actions">
                    <button class="ghost-btn ghost-btn-danger" type="button" :disabled="deletingWorkspace" @click="handleDeleteWorkspace">
                      {{ deletingWorkspace ? 'Deleting…' : 'Yes, delete workspace' }}
                    </button>
                    <button class="ghost-btn ghost-btn-background" type="button" @click="showDeleteWorkspaceConfirm = false">Cancel</button>
                  </div>
                </div>
              </div>
            </div>
            <div v-else-if="settingsTab === 'Members'">
              <h3>Members</h3>
              <span v-if="membersError" class="alert">{{ membersError }}</span>
              <div v-if="membersLoading" class="muted">Loading members...</div>
              <div v-else-if="members.length" class="members-list">
                <div v-for="member in members" :key="member.id" class="members-row">
                  <div class="members-info">
                    <span class="members-name">{{ member.user?.displayName || member.user?.id || 'User' }}</span>
                    <span class="muted">{{ member.user?.email || member.user?.id }}</span>
                  </div>
                  <div class="members-role">
                    <span v-if="!isWorkspaceOwner">{{ member.role }}</span>
                    <template v-else>
                      <select
                        class="members-role-select"
                        :value="member.role"
                        :disabled="memberActionLoading[member.userId]"
                        @change="updateMemberRole(member.userId, $event.target.value)"
                      >
                        <option value="OWNER">Owner</option>
                        <option value="EDITOR">Editor</option>
                        <option value="VIEWER">Viewer</option>
                      </select>
                      <button
                        class="ghost-btn ghost-btn-background"
                        type="button"
                        :disabled="memberActionLoading[member.userId]"
                        @click="removeMember(member.userId)"
                      >
                        Remove
                      </button>
                    </template>
                  </div>
                </div>
              </div>
              <div v-else-if="!membersLoading" class="muted">No members yet.</div>
              <div v-if="isWorkspaceOwner" class="members-invite">
                <h4>Invite member</h4>
                <div class="members-invite-row">
                  <input v-model="inviteName" class="members-input" type="text" placeholder="Name (optional)" />
                  <input v-model="inviteUserId" class="members-input" type="text" placeholder="User ID (optional)" />
                  <select v-model="inviteRole" class="members-role-select">
                    <option value="OWNER">Owner</option>
                    <option value="EDITOR">Editor</option>
                    <option value="VIEWER">Viewer</option>
                  </select>
                  <button
                    class="ghost-btn ghost-btn-background"
                    type="button"
                    :disabled="memberActionLoading.invite"
                    @click="inviteMember"
                  >
                    {{ memberActionLoading.invite ? 'Inviting...' : 'Invite' }}
                  </button>
                </div>
              </div>
            </div>
            <div v-else-if="settingsTab === 'Export'">
              <h3>Export workspace</h3>
              <p class="muted">Download a snapshot of every page you can access.</p>
              <div class="settings-export-panel">
                <button class="ghost-btn ghost-btn-background export-btn" type="button" @click="exportWorkspaceData">Download workspace (JSON)</button>
                <button class="ghost-btn ghost-btn-background export-btn" type="button" @click="exportWorkspaceMarkdown">Download markdown ZIP</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="deleteModalVisible" class="modal-backdrop" @click.self="cancelDeleteModal">
        <div class="modal-card delete-modal-card">
          <h3>Delete page</h3>
          <p class="muted">
            You are about to delete "{{ deleteModalTarget?.title || 'Untitled page' }}" and its sub-pages.
          </p>
          <div class="delete-tree" v-if="deleteModalSubtree">
            <div class="delete-tree-node">
              <span class="delete-tree-title">{{ deleteModalSubtree.title || 'Untitled page' }}</span>
            </div>
            <ul class="delete-tree-children" v-if="deleteModalSubtree.children?.length">
              <li v-for="child in deleteModalSubtree.children" :key="child.id">
                <span class="delete-tree-title">{{ child.title || 'Untitled page' }}</span>
                <delete-tree-branch v-if="child.children?.length" :nodes="child.children" />
              </li>
            </ul>
          </div>
          <div class="modal-actions">
            <button class="ghost-btn" type="button" @click="cancelDeleteModal">Cancel</button>
            <button class="ghost-btn ghost-btn-background" type="button" @click="confirmDeleteModal">Delete</button>
          </div>
        </div>
      </div>
      <div v-if="showBinModal" class="modal-backdrop" @click.self="closeBin">
        <div class="modal-card delete-modal-card">
          <h3>Rubbish bin</h3>
          <p class="muted">Recently deleted pages. Restore to bring them back into the workspace.</p>
          <div class="delete-tree" v-if="workspace.binPages.length">
            <ul class="delete-tree-children">
              <li v-for="page in workspace.binPages" :key="page.id">
                <div class="delete-tree-node">
                  <span class="delete-tree-title">{{ page.title || 'Untitled page' }}</span>
                  <button class="ghost-btn ghost-btn-background" type="button" @click="restoreFromBin(page)">Restore</button>
                </div>
              </li>
            </ul>
          </div>
          <div v-else class="muted">Nothing in the bin.</div>
          <div class="modal-actions">
            <button class="ghost-btn" type="button" @click="closeBin">Close</button>
            <button class="ghost-btn ghost-btn-background" type="button" @click="destroyBin" :disabled="!workspace.binPages.length">Delete all</button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
