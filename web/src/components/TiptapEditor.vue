<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { Extension, textInputRule } from '@tiptap/core';
import { TextSelection, NodeSelection } from 'prosemirror-state';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockWithLang from '../tiptap/codeBlock';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { NodeRangeSelection } from '@tiptap/extension-node-range';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Placeholder from '@tiptap/extension-placeholder';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { all, createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';
import lua from 'highlight.js/lib/languages/lua';
import PageLink from '../tiptap/pageLink';
import DatabaseView from '../tiptap/databaseView';
import DatabaseForm from '../tiptap/databaseForm';
import SlashCommand from '../tiptap/slashCommand';
import ResizableImage from '../tiptap/resizableImage';
import HorizontalRule from '../tiptap/horizontalRule';
import Callout from '../tiptap/callout';
import TableOfContents from '../tiptap/tableOfContents';
import ToggleHeading from '../tiptap/toggleHeading';
import Columns from '../tiptap/columns';
import Indent, { MAX_INDENT as MAX_TEXT_INDENT } from '../tiptap/indent';
import Typography from '@tiptap/extension-typography';
import Drawio from '../tiptap/drawio';
import GaussianSplat from '../tiptap/gaussianSplat';
import { editorDocToTiptap } from '../utils/editorDoc';
import { api } from '../api/client';
import { useWorkspaceStore } from '../stores/workspace';
import { useBlockSummarizer } from '../composables/useBlockSummarizer';
import { AiSuggestionExtension } from '../tiptap/aiSuggestions';
import { blockHighlightKey, createBlockIdExtension, createBlockPositionExtension } from '../tiptap/blockIds';
import { createBulletDepthPlugin } from '../tiptap/bulletDepth';
import { ColumnCleanupExtension, ColumnInputGuardExtension, columnCleanupKey } from '../tiptap/columnGuards';
import { SYNCED_FROM_ATTR, findColumnAncestor } from '../tiptap/editorShared';
import { createInputSelectionGuardExtension } from '../tiptap/inputSelectionGuard';
import { createColumnsPayload, createToggleHeadingPayload, getColumnOnlyBlock } from '../tiptap/blockPayloads';
import { codeBlockLanguages, dividerAlignOptions, dividerSizeOptions, highlightOptions, textColorOptions } from '../tiptap/editorMenuOptions';
import { INDENT_EXCLUDED_ANCESTORS, applyCodeBlockIndentation, collectIndentTargets, findIndentTarget, hasAncestorOfType } from '../tiptap/indentation';
import { createSyncedMirrorExtension, findBlockById, selectionSyncedReferenceId } from '../tiptap/syncedBlocks';
import { blockDebugEnabled, describeUndoOrigin, describeUndoStacks, logDuplicateBlockDetails, logSetup, logUndoDebug, undoDebugEnabled } from '../utils/editorDebug';
import { normalizeLinkHref, parseBlockUrl } from '../utils/editorLinks';
import { markdownToHtml, shouldHandleMarkdownPaste } from '../utils/markdownPaste';
import { positionBubbleMenu, rectFromClientRects } from '../utils/menuPosition';
import { colorFromId } from '../utils/presenceColor';
import { getPageLinkFieldSource, pageLinkBuiltinAttributes, parsePageLinkAttribute } from '../utils/pageLinkAttributes';

import { usePageLinkAttributes } from '../composables/usePageLinkAttributes';
import { useEditorAi } from '../composables/useEditorAi';
import { createSlashItems } from '../tiptap/slashItems';
import { useBlockHandles } from '../composables/useBlockHandles';
import { useSyncedBlocks } from '../composables/useSyncedBlocks';
import { useSaveStatus } from '../composables/useSaveStatus';
import { useClickPlaceholder } from '../composables/useClickPlaceholder';
import { useCollabSeeding } from '../composables/useCollabSeeding';
const props = defineProps({
  doc: {
    type: Object,
    required: true,
  },
  requestDeleteConfirmation: {
    type: Function,
    required: true,
  },
  collab: {
    type: Object,
    required: false,
    default: null, // { docName, token, url }
  },
  pageId: {
    type: String,
    required: false,
    default: null,
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  placeholder: {
    type: String,
    default: '',
  },
  seedDoc: {
    type: [Object, String],
    default: null,
  },
  seedCollabOnMount: {
    type: Boolean,
    default: false,
  },
  requestComplianceSetup: {
    type: Function,
    required: false,
    default: null,
  },
});

const emit = defineEmits(['update:doc', 'status', 'collabready']);
const workspace = useWorkspaceStore();

const getResolvedPage = (pageId) => {
  const allPages = [...workspace.pages, ...(workspace.binPages || [])];
  return allPages.find((p) => p.id === pageId) || null;
};

const activeWorkspaceId = computed(() => {
  const page = props.pageId ? getResolvedPage(props.pageId) : null;
  return page?.workspaceId || workspace.activePageWorkspaceId || null;
});

const createChildPage = async () => {
  const parent = props.pageId ? getResolvedPage(props.pageId) : workspace.currentPage;
  if (!parent) return null;
  const created = await workspace.createChildPageRecord(parent);
  if (!created) return null;
  return { id: created.id, title: created.title, icon: created.icon };
};

const isDatabaseRowPage = (page) => {
  if (!page?.parentId) return false;
  const parent = getResolvedPage(page.parentId);
  return parent?.kind === 'DATABASE';
};

const openPage = (pageId) => {
  const page = workspace.pages.find((p) => p.id === pageId);
  if (page) {
    workspace.selectPage(page, { allowHidden: isDatabaseRowPage(page) });
  }
};

const deletePage = (pageId) => props.requestDeleteConfirmation(pageId);
const restorePage = (pageId) => workspace.restorePageFromBin(pageId);
const listWorkspacePages = () => {
  const workspaceId = activeWorkspaceId.value || workspace.activeWorkspaceId;
  return workspace.pages.filter((page) => {
    if (!page || page.isDeleted) return false;
    if (page.isHidden && !isDatabaseRowPage(page)) return false;
    if (workspaceId && page.workspaceId !== workspaceId) return false;
    return true;
  });
};

const { pageLinkDatabaseLoading, pageLinkDatabaseErrors, pageLinkCollabState, teardownPageLinkCollabState, getPageLinkAttributeData, loadPageLinkAttributes } = usePageLinkAttributes({ getResolvedPage, workspace, activeWorkspaceId });
const listDatabasePages = () => {
  const workspaceId = activeWorkspaceId.value || workspace.activeWorkspaceId;
  return workspace.pages.filter((page) => {
    if (!page || page.isDeleted || page.isHidden) return false;
    if (page.kind !== 'DATABASE') return false;
    if (workspaceId && page.workspaceId !== workspaceId) return false;
    return true;
  });
};
const createDatabasePage = async (options = {}) => {
  const user = workspace.activeUser;
  if (!user || !workspace.hasApi) return null;
  if (!workspace.canEditActiveWorkspace) return null;
  const parent = props.pageId ? getResolvedPage(props.pageId) : workspace.currentPage;
  const workspaceId = parent?.workspaceId || activeWorkspaceId.value || workspace.activeWorkspaceId;
  if (!workspaceId) return null;
  const payload = {
    workspaceId,
    title: 'Untitled database',
    kind: 'DATABASE',
    visibility: parent?.visibility || 'PUBLIC',
    userId: user.id,
    userName: user.name,
  };
  let databaseConfig = options.database;
  if (typeof options.complianceMode === 'boolean') {
    payload.complianceMode = options.complianceMode;
  }
  if (typeof options.title === 'string' && options.title.trim()) {
    payload.title = options.title.trim();
  }
  if (options.complianceMode && typeof props.requestComplianceSetup === 'function') {
    const requested = await props.requestComplianceSetup({
      allowTitle: true,
      defaultTitle: payload.title,
      template: typeof options.template === 'string' ? options.template : 'inventory',
    });
    if (!requested) return null;
    if (requested?.title) {
      payload.title = requested.title;
    }
    if (requested?.database) {
      databaseConfig = requested.database;
    }
  }
  if (!databaseConfig && options.complianceMode && typeof options.template === 'string' && options.template.trim()) {
    databaseConfig = { template: options.template.trim() };
  }
  if (!databaseConfig && options.complianceMode && !props.requestComplianceSetup) {
    databaseConfig = { template: 'inventory' };
  }
  if (databaseConfig) {
    payload.database = databaseConfig;
  }
  if (parent?.id) payload.parentId = parent.id;
  try {
    const created = await api.createPage(payload);
    if (created) {
      workspace.upsertPage(created);
    }
    return created || null;
  } catch (err) {
    console.warn('Create database page failed', err);
    return null;
  }
};

const lowlight = createLowlight(all);

const insertColumns = (editor, range, count) => {
  const payload = createColumnsPayload(count);
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .command(({ tr, state }) => {
      const insertPos = tr.selection.from;
      const node = state.schema.nodeFromJSON(payload);
      tr.insert(insertPos, node);
      const selectionPos = insertPos + 3;
      tr.setSelection(TextSelection.create(tr.doc, selectionPos));
      return true;
    })
    .run();
};

const insertToggleHeading = (editor, range, level) => {
  const payload = createToggleHeadingPayload(level);
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .command(({ tr, state }) => {
      const insertPos = tr.selection.from;
      const node = state.schema.nodeFromJSON(payload);
      tr.insert(insertPos, node);
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 2));
      return true;
    })
    .run();
};

const getComputedStyleText = (element) => {
  const style = getComputedStyle(element);
  let value = '';
  for (let i = 0; i < style.length; i += 1) {
    const key = style[i];
    value += `${key}:${style.getPropertyValue(key)};`;
  }
  return value;
};

const cloneElement = (node) => {
  const clonedNode = node.cloneNode(true);
  const sourceElements = [node, ...Array.from(node.getElementsByTagName('*'))];
  const targetElements = [clonedNode, ...Array.from(clonedNode.getElementsByTagName('*'))];
  sourceElements.forEach((sourceElement, index) => {
    targetElements[index].style.cssText = getComputedStyleText(sourceElement);
  });
  return clonedNode;
};

const removeNode = (node) => {
  if (!node?.parentNode) return;
  node.parentNode.removeChild(node);
};

const pickImageFile = () =>
  new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });

const uploadImageFile = async (file) => {
  if (!file) return null;
  if (props.readonly) return null;
  if (!workspace.hasApi) {
    window.alert('API unavailable.');
    return null;
  }
  if (!props.pageId) {
    window.alert('Save this page before uploading images.');
    return null;
  }
  const user = workspace.activeUser;
  if (!user?.id) {
    window.alert('Login required to upload images.');
    return null;
  }
  try {
    const res = await api.uploadImage(file, { pageId: props.pageId, userId: user.id, userName: user.name });
    return res?.file?.url || null;
  } catch (err) {
    console.warn('Image upload failed', err);
    window.alert('Image upload failed.');
    return null;
  }
};

const insertImageFromUpload = async (editor, range) => {
  if (props.readonly) return;
  const file = await pickImageFile();
  if (!file) return;
  const src = await uploadImageFile(file);
  if (!src) return;
  const chain = editor.chain().focus();
  if (range) {
    chain.deleteRange(range);
  }
  chain
    .insertContent([
      { type: 'image', attrs: { src } },
      { type: 'paragraph' },
    ])
    .run();
};
// register aliases so user-friendly names resolve
lowlight.register('html', xml);
lowlight.register('javascript', javascript);
lowlight.register('js', javascript);
lowlight.register('typescript', typescript);
lowlight.register('ts', typescript);
lowlight.register('json', json);
lowlight.register('bash', bash);
lowlight.register('markdown', markdown);
lowlight.register('python', python);
lowlight.register('lua', lua);

const { lastKnownCursorPos, serializeBlocksForAi, applyAiSuggestions, revertSuggestion, acceptSuggestion, revertAllSuggestions, acceptAllSuggestions, activeSuggestions, hoveredSuggestionIndex, suggestionWidgetPos, handleSuggestionMousemove, aiPromptVisible, aiPromptPos, aiPromptText, aiPromptInputRef, aiStreaming, showAiPrompt, closeAiPrompt, submitAiPrompt, runAiBubbleAction } = useEditorAi({ workspace, getEditor: () => editor?.value });

const slashItems = createSlashItems({ insertToggleHeading, insertColumns, insertImageFromUpload, props, getResolvedPage, workspace, showAiPrompt });

const undoOriginObserver = ref(null);
let editor = null;

const unbindUndoOriginObserver = () => {
  if (collabDoc.value && undoOriginObserver.value) {
    collabDoc.value.off('afterTransaction', undoOriginObserver.value);
  }
  undoOriginObserver.value = null;
};

const bindUndoOriginObserver = () => {
  unbindUndoOriginObserver();
  if (!collabDoc.value) return;
  const handler = (transaction) => {
    if (!transaction?.local) return;
    const state = editor?.value?.state;
    if (!state) return;
    const undoState = yUndoPluginKey.getState(state);
    const undoManager = undoState?.undoManager;
    if (!undoManager) return;
    const origin = transaction.origin ?? null;
    if (!undoManager.trackedOrigins?.has?.(origin)) {
      undoManager.trackedOrigins?.add?.(origin);
      if (undoDebugEnabled()) {
        logUndoDebug('tracked-origin', { origin: describeUndoOrigin(origin, undoManager) });
      }
    }
    if (undoDebugEnabled()) {
      logUndoDebug('yjs-transaction', {
        origin: describeUndoOrigin(origin, undoManager),
        addToHistory: transaction?.meta?.get?.('addToHistory') ?? null,
        stacks: {
          undo: undoManager.undoStack?.length ?? null,
          redo: undoManager.redoStack?.length ?? null,
        },
      });
    }
  };
  collabDoc.value.on('afterTransaction', handler);
  undoOriginObserver.value = handler;
};

const lastTextInputAt = ref(0);
const lastTextInputInfo = ref(null);

// ─────────────────────────────────────────────────────────────────────────────

const handleState = ref({ node: null, pos: -1 });
const handleVisible = ref(false);
const handleLocked = ref(false);
const handlePos = ref({ top: 0, left: 0 });
const handleRef = ref(null);
const wrapperRef = ref(null);
const listHandleState = ref({ node: null, pos: -1, element: null });
const listHandlePos = ref({ top: 0, left: 0, height: 0 });
const listHandleTriggerHover = ref(false);
const listHandleSelfHover = ref(false);
const LIST_HANDLE_OFFSET = 72;
const LIST_HANDLE_WIDTH = 56;
const LIST_HANDLE_HOVER_PADDING = 12;
const listHandleHeight = computed(() => Math.max(28, listHandlePos.value.height || 0));
const handleStyle = computed(() => ({
  position: 'absolute',
  top: `${handlePos.value.top}px`,
  left: `${handlePos.value.left}px`,
  transform: 'translate(-100%, -50%)',
  zIndex: 1500,
}));
const listHandleStyle = computed(() => ({
  position: 'absolute',
  top: `${listHandlePos.value.top}px`,
  left: `${listHandlePos.value.left}px`,
  transform: 'translate(-100%, -50%)',
  zIndex: 1500,
  '--list-handle-height': `${listHandleHeight.value}px`,
}));
const listHandleBraceStyle = computed(() => ({
  '--brace-height': `${listHandleHeight.value}px`,
}));
const listHandleVisible = computed(() => {
  const pos = listHandleState.value?.pos;
  if (pos == null || pos < 0) return false;
  return listHandleTriggerHover.value || listHandleSelfHover.value;
});
const showTuneMenu = ref(false);
const slashMenuOpen = ref(false);
const panelState = ref('root'); // root | turnInto | colour | highlight | divider | dividerAlign | code | pageLinkStyle | pageLinkAttributes
const tuneMenuDir = ref('forward'); // forward | backward
const tuneMenuPos = ref({ top: 0, left: 0 });
const tuneMenuFlipped = ref(false);
const tuneMenuRef = ref(null);
const tuneMenuBlockEl = ref(null);
const collabField = 'default';
const collabMetaKey = 'wikidMeta';
const createCollabDoc = () => {
  const guid = props.collab?.docName || `wikid-temp-${Math.random().toString(16).slice(2)}`;
  const doc = new Y.Doc({ guid });
  doc.getXmlFragment(collabField);
  return doc;
};
const collabDoc = ref(createCollabDoc());
const collabProvider = ref(null);
const currentDocName = ref(props.collab?.docName || null);
const isCollabEnabled = computed(
  () => !!props.collab && !!props.collab.docName && !!props.collab.token && !!props.collab.url
);
const collabReady = computed(() => isCollabEnabled.value && !!collabProvider.value);
const cursorUser = computed(() => ({
  name: workspace.activeUser?.name || 'Guest',
  color: colorFromId(workspace.activeUser?.id || 'guest'),
}));

const teardownCollabProvider = () => {
  if (collabProvider.value) {
    collabProvider.value.off?.('synced', handleCollabSynced);
    collabProvider.value.off?.('status', handleProviderStatus);
    collabProvider.value.off?.('stateless', handleStatelessMessage);
    collabProvider.value.off?.('unsyncedChanges', handleUnsyncedChanges);
    collabProvider.value.destroy();
    collabProvider.value = null;
    emit('collabready', { doc: null, provider: null });
  }
  unbindUndoOriginObserver();
};

const emitCollabReady = () => {
  emit('collabready', { doc: collabDoc.value || null, provider: collabProvider.value || null });
};

const setupCollabProvider = () => {
  if (!isCollabEnabled.value || !props.collab) return;
  // If provider already matches the current doc, just refresh awareness/token.
  if (collabProvider.value && props.collab.docName === currentDocName.value) {
    updateAwarenessUser();
    emitCollabReady();
    return;
  }
  teardownCollabProvider();
  // Recreate doc/provider when the document name changes.
  collabDoc.value = createCollabDoc();
  bindSyncedLocksMap(collabDoc.value);
  bindUndoOriginObserver();
  currentDocName.value = props.collab.docName || null;
  initialContentSeeded.value = false;
  setupSeededAfterSync.value = false;
  logSetup('provider', { docName: currentDocName.value });
  try {
    collabProvider.value = new HocuspocusProvider({
      url: props.collab.url,
      name: props.collab.docName,
      // Use a getter so reconnects always have the latest token
      token: () => props.collab?.token,
      document: collabDoc.value,
    });
    collabProvider.value.on('synced', handleCollabSynced);
    collabProvider.value.on('status', handleProviderStatus);
    collabProvider.value.on('stateless', handleStatelessMessage);
    collabProvider.value.on('unsyncedChanges', handleUnsyncedChanges);
    emitStatus('Connecting...', 'connecting');
    updateAwarenessUser();
    emitCollabReady();
  } catch (err) {
    console.warn('Collab provider failed to initialize', err);
    teardownCollabProvider();
  }
};

const updateAwarenessUser = () => {
  const awareness = collabProvider.value?.awareness;
  if (!awareness) return;
  awareness.setLocalStateField('user', cursorUser.value);
};

const hideAwarenessCursor = () => {
  const awareness = collabProvider.value?.awareness;
  if (!awareness) return;
  awareness.setLocalStateField('cursor', null);
};

const restoreAwarenessCursor = () => {
  updateAwarenessUser();
};

const handleCollabSynced = (synced) => {
  if (!synced) return;
  emitSavedWithDelay();
  const shouldAttemptSetupSeed =
    props.seedCollabOnMount && isCollabEnabled.value && editor.value && !setupSeededAfterSync.value;
  if (shouldAttemptSetupSeed) {
    const current = editor.value.getJSON();
    const seed = resolveSeedDoc();
    const initialDoc = seed.doc;
    const hasCurrent = hasTiptapContent(current);
    const hasIncoming = hasTiptapContent(initialDoc);
    const hasRemote = hasTiptapContent(getCollabDocSnapshot());
    const forceSeed = !hasCurrent && hasIncoming;

    logSetup('synced', {
      docName: currentDocName.value,
      seedOnMount: true,
      hasCurrent,
      hasIncoming,
      forceSeed,
      initialContentSeeded: initialContentSeeded.value,
      seedSource: seed.source,
      hasSeedDoc: seed.hasSeedDoc,
      hasPropDoc: seed.hasPropDoc,
      hasRemote,
    });

    seedCollabDocFromProps(editor.value, { force: forceSeed });
    if (hasCurrent || hasIncoming) {
      setupSeededAfterSync.value = true;
    }
  } else {
    logSetup('synced', {
      docName: currentDocName.value,
      seedOnMount: props.seedCollabOnMount,
      initialContentSeeded: initialContentSeeded.value,
      setupSeededAfterSync: setupSeededAfterSync.value,
    });
    seedCollabDocFromProps();
  }
  logBlockSummary('collab-synced-collab', getCollabDocSnapshot());
  logBlockSummary('collab-synced-editor', editor.value?.getJSON?.());
  logDuplicateBlockDetails('collab-synced-duplicates', editor.value?.state?.doc);
  dedupeBlockIds('collab-synced');
  pruneInitialAutoBlock();
  scheduleSyncedWorkspaceRefresh();
  scheduleSyncedWorkspaceSourceUpdate();
  stopUnsyncedWatcher();
};

const toStatelessString = (raw) => {
  if (typeof raw === 'string') return raw;
  if (raw instanceof Uint8Array) {
    try {
      return new TextDecoder().decode(raw);
    } catch {
      return '';
    }
  }
  if (raw && typeof raw === 'object' && typeof raw.payload === 'string') {
    return raw.payload;
  }
  return '';
};

const handleStatelessMessage = (event) => {
  const raw = event?.payload ?? event;
  const text = toStatelessString(raw);
  if (!text) return;
  try {
    const parsed = typeof text === 'string' ? JSON.parse(text) : null;
    if (parsed?.type === 'stored' && parsed?.documentName === currentDocName.value) {
      emitSavedWithDelay();
      stopUnsyncedWatcher();
    }
  } catch {
    // ignore non-JSON stateless messages
  }
};

const { isSyncedLocked, hasWorkspaceSyncedReference, insertSyncedBlockFromUrl, toggleSyncedLock, notifySyncedBlockLocked, bindSyncedLocksMap, unbindSyncedLocksMap, scheduleSyncedWorkspaceRefresh, scheduleSyncedWorkspaceSourceUpdate, setupSyncedWorkspaceProvider, teardownSyncedWorkspaceProvider, disposeSyncedBlocks } = useSyncedBlocks({ props, workspace, activeWorkspaceId, getResolvedPage, collabDoc, isCollabEnabled, getEditor: () => editor?.value, getHoveredSyncedSourceId: () => hoveredSyncedSourceId?.value });
bindSyncedLocksMap(collabDoc.value);

const { emitStatus, clearSavedDelay, emitSaving, emitSavedWithDelay, refreshSaveStatus, stopUnsyncedWatcher, handleUnsyncedChanges, startUnsyncedWatcher, handleProviderStatus } = useSaveStatus({ emit, isCollabEnabled, collabProvider, currentDocName });

const { isEmptyTextblockNode, clickPlaceholderBlockId, clearClickPlaceholderIfNeeded, shouldInsertClickPlaceholder, insertClickPlaceholder } = useClickPlaceholder({ props });

const { captureInitialAutoBlock, dedupeBlockIds, getCollabDocSnapshot, hasTiptapContent, initialContentSeeded, isCollabInitialized, logBlockSummary, markCollabInitialized, pruneInitialAutoBlock, resolveSeedDoc, seedCollabDocFromProps, setupSeededAfterSync } = useCollabSeeding({ props, isCollabEnabled, collabDoc, collabField, collabMetaKey, currentDocName, getEditor: () => editor?.value });

// Initialize provider early so cursors can bind immediately
if (isCollabEnabled.value) {
  setupCollabProvider();
  updateAwarenessUser();
  emitCollabReady();
  setupSyncedWorkspaceProvider();
}

editor = useEditor({
  content: isCollabEnabled.value ? undefined : editorDocToTiptap(props.doc),
  editable: !props.readonly,
  editorProps: {
    attributes: {
      class: 'tiptap-editor',
    },
    transformPastedHTML(html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const el of doc.querySelectorAll('[style]')) {
        el.style.removeProperty('color');
        el.style.removeProperty('background-color');
        el.style.removeProperty('font-family');
        el.style.removeProperty('font-size');
        if (!el.style.cssText.trim()) el.removeAttribute('style');
      }
      return doc.body.innerHTML;
    },
    handleTextInput(_view, from, to, text) {
      lastTextInputAt.value = Date.now();
      lastTextInputInfo.value = { from, to, text };
      return false;
    },
    handlePaste(view, event) {
      if (!event?.clipboardData) return false;
      if (props.readonly) return false;
      const syncedId = selectionSyncedReferenceId(view.state);
      if (syncedId && isSyncedLocked(syncedId)) {
        notifySyncedBlockLocked();
        return true;
      }
      const markdown = event.clipboardData.getData('text/markdown');
      const text = markdown || event.clipboardData.getData('text/plain');
      const html = event.clipboardData.getData('text/html');
      const parsed = parseBlockUrl(text);
      if (parsed?.blockId) {
        const confirmed = window.confirm('Paste as a synced block reference?');
        if (confirmed) {
          insertSyncedBlockFromUrl(text);
          return true;
        }
      }
      if (shouldHandleMarkdownPaste(text, html, view.state)) {
        const rendered = markdownToHtml(text);
        if (rendered && editor.value) {
          event.preventDefault();
          editor.value.chain().focus().insertContent(rendered).run();
          return true;
        }
      }
      return false;
    },
    handleDrop() {
      if (!dragScrollRestoreActive) return false;
      const snapshot = captureScrollSnapshot();
      if (!snapshot) {
        dragScrollRestoreActive = false;
        return false;
      }
      requestAnimationFrame(() => restoreScrollSnapshot(snapshot));
      dragScrollRestoreActive = false;
      return false;
    },
    handleKeyDown(view, event) {
      const syncedId = selectionSyncedReferenceId(view.state);
      if (syncedId && isSyncedLocked(syncedId)) {
        const isModifier = event.metaKey || event.ctrlKey || event.altKey;
        const editKeys = ['Backspace', 'Delete', 'Enter', 'Tab'];
        const isTyping = event.key && event.key.length === 1 && !isModifier;
        const isEdit = isTyping || editKeys.includes(event.key);
        if (!isEdit) return false;
        notifySyncedBlockLocked();
        return true;
      }
      if (isCollabEnabled.value && (event.metaKey || event.ctrlKey)) {
        const key = event.key ? event.key.toLowerCase() : '';
        const wantsUndo = key === 'z' && !event.shiftKey;
        const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey);
        if (wantsUndo || wantsRedo) {
          const command = wantsUndo ? 'undo' : 'redo';
          const handled = editor.value?.commands?.[command]?.() ?? false;
          if (undoDebugEnabled()) {
            logUndoDebug('shortcut', {
              command,
              handled,
              stacks: describeUndoStacks(view.state),
            });
          }
          if (handled) {
            event.preventDefault();
            return true;
          }
        }
      }
      if (
        event.key === 'Backspace'
        && !event.shiftKey
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
        const { state } = view;
        const { selection } = state;
        if (selection.empty) {
          const first = state.doc.childCount ? state.doc.child(0) : null;
          if (
            first?.type?.name === 'paragraph'
            && first.content?.size === 0
            && state.doc.childCount > 1
            && selection.$from.depth >= 1
            && selection.$from.node(1) === first
            && selection.$from.parentOffset === 0
          ) {
            event.preventDefault();
            view.dispatch(state.tr.delete(0, first.nodeSize));
            editor.value?.commands?.blur?.();
            return true;
          }
        }
      }
      if (
        event.key === 'Enter'
        && !event.shiftKey
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
        const { state } = view;
        const { selection } = state;
        if (!selection.empty) return false;
        if (hasAncestorOfType(selection.$from, INDENT_EXCLUDED_ANCESTORS)) return false;
        const target = findIndentTarget(selection.$from);
        if (!target) return false;
        const indent = Number.isFinite(target.node.attrs?.indent) ? target.node.attrs.indent : 0;
        if (indent <= 0) return false;
        if (target.node.content?.size !== 0) return false;
        event.preventDefault();
        const tr = state.tr.setNodeMarkup(target.pos, target.node.type, { ...target.node.attrs, indent: 0 }, target.node.marks);
        view.dispatch(tr);
        return true;
      }
      if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const { state } = view;
        const { selection } = state;
        const handledCodeBlock = applyCodeBlockIndentation(state, view.dispatch, event.shiftKey);
        if (handledCodeBlock) {
          event.preventDefault();
          return true;
        }
        if (hasAncestorOfType(selection.$from, INDENT_EXCLUDED_ANCESTORS) || hasAncestorOfType(selection.$to, INDENT_EXCLUDED_ANCESTORS)) {
          // Prevent Tab escaping to browser chrome (Safari URL bar etc).
          // Return false so Tiptap's built-in ListItem/TaskItem keyboard shortcuts
          // (sinkListItem / liftListItem) handle the actual indent/outdent.
          event.preventDefault();
          return false;
        }
        const targets = collectIndentTargets(state);
        if (!targets.length) return false;
        event.preventDefault();
        const delta = event.shiftKey ? -1 : 1;
        let tr = state.tr;
        targets.forEach(({ node, pos }) => {
          const current = Number.isFinite(node.attrs?.indent) ? node.attrs.indent : 0;
          const next = Math.max(0, Math.min(MAX_TEXT_INDENT, current + delta));
          if (next === current) return;
          tr = tr.setNodeMarkup(pos, node.type, { ...node.attrs, indent: next }, node.marks);
        });
        if (tr.docChanged) {
          view.dispatch(tr);
          return true;
        }
      }
      return false;
    },
    handleClick(view, _pos, event) {
      if (!event || event.button !== 0) return false;
      if (shouldInsertClickPlaceholder(view, event)) {
        return insertClickPlaceholder(view);
      }
      return false;
    },
  },
  extensions: [
    ...(isCollabEnabled.value
      ? [
          Collaboration.configure({
            document: collabDoc.value,
          }),
          ...(collabReady.value
            ? [
                CollaborationCaret.configure({
                  provider: collabProvider.value,
                  user: cursorUser.value,
                  render: (user) => {
                    const caret = document.createElement('span');
                    const color = user?.color || '#f97316';
                    caret.classList.add('collaboration-carets__caret');
                    caret.style.setProperty('--caret-color', color);
                    caret.style.color = color;
                    const label = document.createElement('div');
                    label.classList.add('collaboration-carets__label');
                    label.style.backgroundColor = color;
                    label.textContent = user?.name || 'User';
                    caret.appendChild(label);
                    return caret;
                  },
                }),
              ]
            : []),
        ]
      : []),
    createBlockIdExtension({ isCollabEnabled }),
    createSyncedMirrorExtension({ isSyncedLocked }),
    createBlockPositionExtension({ hasWorkspaceSyncedReference }),
    ColumnCleanupExtension,
    Indent,
    Color.configure({ types: ['textStyle'] }),
    TextStyle,
    StarterKit.configure({
      // Use Yjs undo manager when collaboration is enabled.
      undoRedo: isCollabEnabled.value ? false : undefined,
      link: false,
      codeBlock: false,
      horizontalRule: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      bulletList: { keepMarks: true, keepAttributes: true },
      orderedList: { keepMarks: true, keepAttributes: true },
    }),
    HorizontalRule,
    Columns,
    Table.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          fullWidth: {
            default: false,
            parseHTML: el => el.getAttribute('data-full-width') === 'true',
            renderHTML: attrs => attrs.fullWidth ? { 'data-full-width': 'true' } : {},
          },
        };
      },
    }).configure({
      resizable: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
    CodeBlockWithLang.configure({
      lowlight,
      languages: codeBlockLanguages,
    }),
    Highlight.configure({ multicolor: true }),
    TaskList.configure({
      HTMLAttributes: { class: 'tiptap-task-list' },
    }),
    TaskItem.configure({
      nested: true,
      HTMLAttributes: { class: 'tiptap-task-item' },
    }),
    Link.configure({
      autolink: true,
      linkOnPaste: true,
      openOnClick: true,
      defaultProtocol: 'https',
      HTMLAttributes: { rel: 'noopener noreferrer' },
    }),
    ResizableImage.configure({
      inline: false,
    }),
    Placeholder.configure({
      showOnlyCurrent: true,
      showOnlyWhenEditable: true,
      placeholder: ({ editor: ed }) => {
        if (props.placeholder && ed?.isEmpty) return props.placeholder;
        return "Start writing, type '/' to add a block";
      },
    }),
    TableOfContents,
    ToggleHeading,
    Callout,
    PageLink.configure({
      resolvePage: getResolvedPage,
      createChildPage,
      listWorkspacePages,
      openPage,
      deletePage,
      restorePage,
      getPageLinkAttributeData,
      loadPageLinkAttributes,
    }),
    DatabaseView.configure({
      resolvePage: getResolvedPage,
      listDatabasePages,
      createDatabasePage,
      openPage,
      restorePage,
    }),
    DatabaseForm.configure({
      listDatabasePages,
    }),
    Drawio,
    GaussianSplat,
    Typography.extend({
      addInputRules() {
        return [
          ...this.parent(),
          textInputRule({ find: /~=$/, replace: '≈' }),
        ];
      },
    }).configure({
      openDoubleQuote: false,
      closeDoubleQuote: false,
      openSingleQuote: false,
      closeSingleQuote: false,
    }),
    SlashCommand.configure({
      commands: slashItems,
      onOpen: () => {
        slashMenuOpen.value = true;
        setHandleLocked(true);
      },
      onClose: () => {
        slashMenuOpen.value = false;
        if (!showTuneMenu.value) {
          setHandleLocked(false);
        }
      },
    }),
    ColumnInputGuardExtension,
    createInputSelectionGuardExtension({ lastTextInputAt, lastTextInputInfo }),
    AiSuggestionExtension,
    Extension.create({ name: 'bullet-depth', addProseMirrorPlugins: () => [createBulletDepthPlugin()] }),
  ],
  onCreate({ editor: ed }) {
    logSetup('create', {
      docName: currentDocName.value,
      collabEnabled: isCollabEnabled.value,
      seedOnMount: props.seedCollabOnMount,
    });
    captureInitialAutoBlock(ed.state.doc);
    nextTick(() => syncTableDomAttributes());
    if (props.seedCollabOnMount && isCollabEnabled.value) {
      seedCollabDocFromProps(ed, { force: true });
      if (!props.readonly) {
        nextTick(() => ed?.commands?.focus('end'));
      }
    }
  },
  onSelectionUpdate({ editor: ed }) {
    clearClickPlaceholderIfNeeded(ed?.view);
    updateActiveTable();
    lastKnownCursorPos.value = ed.state.selection.from;
  },
  onBlur({ editor: ed }) {
    activeTableEl.value = null;
    // Preserve position so serializeBlocksForAi works after focus moves to AI panel
    if (ed?.state?.selection) lastKnownCursorPos.value = ed.state.selection.from;
  },
  onUpdate({ editor: ed, transaction }) {
    syncTableDomAttributes();
    updateActiveTable();
    captureInitialAutoBlock(ed.state.doc);
    if (clickPlaceholderBlockId.value) {
      const match = findBlockById(ed.state.doc, clickPlaceholderBlockId.value);
      if (!match || !isEmptyTextblockNode(match.node)) {
        clickPlaceholderBlockId.value = null;
      }
    }
    if (isCollabEnabled.value) {
      if (collabProvider.value?.status === 'connected') {
        emitSaving();
        startUnsyncedWatcher();
      } else {
        refreshSaveStatus();
      }
    }
    scheduleSyncedWorkspaceSourceUpdate();
    if (undoDebugEnabled()) {
      const ySyncState = ySyncPluginKey.getState(ed.state);
      logUndoDebug('update', {
        ySync: !!transaction?.getMeta?.(ySyncPluginKey),
        addToHistory: transaction?.getMeta?.('addToHistory') ?? null,
        isChangeOrigin: ySyncState?.isChangeOrigin ?? null,
        isUndoRedoOperation: ySyncState?.isUndoRedoOperation ?? null,
        stacks: describeUndoStacks(ed.state),
      });
    }
    const json = ed.getJSON();
    if (isCollabEnabled.value && !isCollabInitialized() && hasTiptapContent(json)) {
      markCollabInitialized('local-edit');
    }
    if (blockDebugEnabled() && transaction?.getMeta?.(ySyncPluginKey)) {
      logBlockSummary('collab-remote-update', ed.getJSON());
      logDuplicateBlockDetails('collab-remote-duplicates', ed.state.doc);
    }
    if (transaction?.getMeta?.(ySyncPluginKey)) {
      dedupeBlockIds('collab-remote');
      pruneInitialAutoBlock();
    }
    emit('update:doc', {
      time: Date.now(),
      version: props.doc?.version || '2.31.0',
      type: json.type || 'doc',
      content: json.content || [],
    });
  },
});

// Background block summarizer — runs after editor settles, uses Haiku to build
// a per-block context cache that makes AI edit requests 60–85% cheaper on large pages
const { pending: summarizationPending, stats: summarizationStats, summarize: summarizeForAi } = useBlockSummarizer(editor);

const insertParagraphAtTop = () => {
  if (!editor.value || editor.value.isDestroyed) return false;
  if (!editor.value.schema?.nodes?.paragraph) return false;
  editor.value
    .chain()
    .focus()
    .insertContentAt(0, { type: 'paragraph' })
    .focus('start')
    .run();
  return true;
};

const handleTocHighlight = (payload) => {
  if (!editor.value || editor.value.isDestroyed) return;
  const blockId = payload?.blockId;
  if (!blockId) return;
  const { state, view } = editor.value;
  const tr = state.tr.setMeta(blockHighlightKey, { highlightId: blockId, highlightType: 'toc' });
  view.dispatch(tr);
};

const handleTocClearHighlight = () => {
  if (!editor.value || editor.value.isDestroyed) return;
  const { state, view } = editor.value;
  const tr = state.tr.setMeta(blockHighlightKey, { clearHighlight: true });
  view.dispatch(tr);
};

watch(
  () => editor.value,
  (next, prev) => {
    if (prev?.off) {
      prev.off('toc:highlight', handleTocHighlight);
      prev.off('toc:clear-highlight', handleTocClearHighlight);
    }
    if (next?.on) {
      next.on('toc:highlight', handleTocHighlight);
      next.on('toc:clear-highlight', handleTocClearHighlight);
    }
  },
  { immediate: true }
);

watch(
  () => props.readonly,
  (next) => {
    editor?.value?.setEditable?.(!next);
  }
);

const sameContent = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

const toggleBold = () => editor.value?.chain().focus().toggleBold().run();
const toggleItalic = () => editor.value?.chain().focus().toggleItalic().run();
const toggleStrike = () => editor.value?.chain().focus().toggleStrike().run();
const promptLink = () => {
  if (!editor.value) return;
  const previous = editor.value.getAttributes('link').href || '';
  const url = window.prompt('Enter URL', previous);
  if (url === null) return;
  const href = normalizeLinkHref(url);
  if (!href) {
    editor.value.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  editor.value.chain().focus().extendMarkRange('link').setLink({ href, target: '_blank' }).run();
};

const getHandleNode = () => {
  const doc = editor.value?.state?.doc;
  const pos = handleState.value?.pos;
  if (!doc || pos == null || pos < 0) return null;
  try {
    return doc.nodeAt(pos);
  } catch {
    return null;
  }
};

const currentColor = computed(() => editor.value?.getAttributes('textStyle')?.color || '');
const currentHighlightColor = computed(() => editor.value?.getAttributes('highlight')?.color || '');
const currentHorizontalRuleColor = computed(() => {
  const node = getHandleNode();
  if (!node || node.type?.name !== 'horizontalRule') return '';
  return typeof node.attrs?.color === 'string' ? node.attrs.color : '';
});
const currentHorizontalRuleSize = computed(() => {
  const node = getHandleNode();
  if (!node || node.type?.name !== 'horizontalRule') return 'medium';
  const size = node.attrs?.size;
  return size === 'small' || size === 'large' ? size : 'medium';
});
const currentHorizontalRuleAlign = computed(() => {
  const node = getHandleNode();
  if (!node || node.type?.name !== 'horizontalRule') return 'middle';
  const align = node.attrs?.align;
  return align === 'top' || align === 'bottom' ? align : 'middle';
});
const currentPageLinkStyle = computed(() => {
  const node = getHandleNode();
  if (!node || node.type?.name !== 'pageLink') return 'card';
  return node.attrs?.style === 'small' ? 'small' : 'card';
});
const currentPageLinkTargetId = computed(() => {
  const node = getHandleNode();
  if (!node || node.type?.name !== 'pageLink') return '';
  return typeof node.attrs?.pageId === 'string' ? node.attrs.pageId : '';
});
const currentPageLinkAttribute = computed(() => {
  const node = getHandleNode();
  if (!node || node.type?.name !== 'pageLink') return '';
  return typeof node.attrs?.attribute === 'string' ? node.attrs.attribute : '';
});
const currentPageLinkAttributeParts = computed(() => parsePageLinkAttribute(currentPageLinkAttribute.value));
const currentPageLinkAttributeData = computed(() => getPageLinkAttributeData(currentPageLinkTargetId.value));
const currentPageLinkDatabasePageId = computed(() => currentPageLinkAttributeData.value?.databasePageId || '');
const currentPageLinkAttributeFields = computed(() => {
  const fields = currentPageLinkAttributeData.value?.database?.fields || [];
  return fields.filter((field) => getPageLinkFieldSource(field) !== 'page');
});
const currentPageLinkAttributeLabel = computed(() => {
  const selection = currentPageLinkAttributeParts.value;
  if (!selection.kind) return 'Page link';
  if (selection.kind === 'builtin') {
    return pageLinkBuiltinAttributes.find((item) => item.id === `builtin:${selection.key}`)?.label || 'Attribute';
  }
  const match = currentPageLinkAttributeFields.value.find((field) => field?.id === selection.key);
  return match?.name || 'Attribute';
});
const currentPageLinkAttributeLoading = computed(() => {
  const databasePageId = currentPageLinkDatabasePageId.value;
  if (!databasePageId) return false;
  return !!pageLinkDatabaseLoading[databasePageId];
});
const currentPageLinkAttributeError = computed(() => {
  const databasePageId = currentPageLinkDatabasePageId.value;
  if (!databasePageId) return '';
  return pageLinkDatabaseErrors[databasePageId] || '';
});
const handleTextColor = computed(() => {
  const node = getHandleNode();
  if (!node) return '';
  let color = '';
  let mixed = false;
  node.descendants((child) => {
    if (mixed) return false;
    if (!child.isText) return;
    const mark = child.marks.find((item) => item.type?.name === 'textStyle' && item.attrs?.color);
    if (!mark?.attrs?.color) return false;
    if (!color) {
      color = mark.attrs.color;
      return false;
    }
    if (color !== mark.attrs.color) {
      mixed = true;
    }
    return false;
  });
  return mixed ? '' : color;
});
const tuneTextColor = computed(() => {
  const node = getHandleNode();
  if (node?.type?.name === 'horizontalRule') {
    return currentHorizontalRuleColor.value || 'var(--surface-border)';
  }
  return handleTextColor.value || currentColor.value || 'var(--context-menu-text)';
});
const handleHighlightColor = computed(() => {
  const node = getHandleNode();
  if (!node) return '';
  let color = '';
  let mixed = false;
  node.descendants((child) => {
    if (mixed) return false;
    if (!child.isText) return;
    const mark = child.marks.find((item) => item.type?.name === 'highlight' && item.attrs?.color);
    if (!mark?.attrs?.color) return false;
    if (!color) {
      color = mark.attrs.color;
      return false;
    }
    if (color !== mark.attrs.color) {
      mixed = true;
    }
    return false;
  });
  return mixed ? '' : color;
});
const tuneHighlightColor = computed(() => handleHighlightColor.value || currentHighlightColor.value || '');

const getSelectionBoundingRect = () => {
  if (typeof window === 'undefined') return null;
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const editorRoot = editor?.value?.view?.dom;
  const container = range.commonAncestorContainer;
  if (editorRoot && container && !editorRoot.contains(container)) return null;
  const rects = Array.from(range.getClientRects?.() || []);
  const combined = rectFromClientRects(rects);
  if (combined) return combined;
  const rect = range.getBoundingClientRect?.();
  if (!rect) return null;
  return {
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    x: rect.x ?? rect.left,
    y: rect.y ?? rect.top,
    toJSON: () => ({}),
  };
};

const getBubbleMenuVirtualElement = () => {
  const rect = getSelectionBoundingRect();
  if (!rect) return null;
  return {
    getBoundingClientRect: () => rect,
    getClientRects: () => [rect],
  };
};

const shouldShowBubble = ({ editor: ed, state, view }) => {
  if (!ed || ed.isDestroyed || !ed.isEditable || !view?.hasFocus?.()) {
    closeBubbleColorMenu();
    closeBubbleHighlightMenu();
    return false;
  }
  if (state.selection.empty) {
    closeBubbleColorMenu();
    closeBubbleHighlightMenu();
    return false;
  }
  return true;
};

const handleDragHandleChange = ({ node, pos }) => {
  const nextPos = typeof pos === 'number' ? pos : -1;
  if (!node) {
    handleState.value = { node: null, pos: -1 };
    return;
  }
  handleState.value = { node, pos: nextPos };
  if (node.type?.name === 'image' && panelState.value !== 'root') {
    panelState.value = 'root';
    tuneMenuDir.value = 'backward';
  }
  if (node.type?.name === 'horizontalRule' && panelState.value === 'highlight') {
    panelState.value = 'root';
    tuneMenuDir.value = 'backward';
  }
  if (node.type?.name !== 'horizontalRule' && panelState.value === 'divider') {
    panelState.value = 'root';
    tuneMenuDir.value = 'backward';
  }
  if (node.type?.name !== 'horizontalRule' && panelState.value === 'dividerAlign') {
    panelState.value = 'root';
    tuneMenuDir.value = 'backward';
  }
  if (node.type?.name !== 'pageLink' && panelState.value === 'pageLinkStyle') {
    panelState.value = 'root';
    tuneMenuDir.value = 'backward';
  }
  if (node.type?.name !== 'pageLink' && panelState.value === 'pageLinkAttributes') {
    panelState.value = 'root';
    tuneMenuDir.value = 'backward';
  }
};
const isImageBlock = computed(() => handleState.value?.node?.type?.name === 'image');
const isCodeBlock = computed(() => handleState.value?.node?.type?.name === 'codeBlock');
const isHorizontalRule = computed(() => handleState.value?.node?.type?.name === 'horizontalRule');
const isPageLinkBlock = computed(() => handleState.value?.node?.type?.name === 'pageLink');
const currentCodeLanguage = computed(() => {
  const handleLang = handleState.value?.node?.attrs?.language;
  if (typeof handleLang === 'string' && handleLang.trim()) return handleLang.trim();
  const selectionLang = editor.value?.getAttributes('codeBlock')?.language;
  return typeof selectionLang === 'string' ? selectionLang.trim() : '';
});
const hoveredCodeBlock = ref(null);
const hoveredCodeLanguage = computed(() => {
  if (!hoveredCodeBlock.value || !editor.value?.state) return '';
  const node = editor.value.state.doc.nodeAt(hoveredCodeBlock.value.pos);
  const lang = node?.attrs?.language;
  return typeof lang === 'string' ? lang.trim() : '';
});
const codeLangMenuOpen = ref(false);
const codeLangButtonRef = ref(null);
const codeLangMenuPos = ref({ top: 0, left: 0 });
const bubbleColorMenuOpen = ref(false);
const bubbleColorButtonRef = ref(null);
const bubbleColorMenuRef = ref(null);
const bubbleColorMenuPos = ref({ top: 0, left: 0 });
const bubbleHighlightMenuOpen = ref(false);
const bubbleHighlightButtonRef = ref(null);
const bubbleHighlightMenuRef = ref(null);
const bubbleHighlightMenuPos = ref({ top: 0, left: 0 });
const hoveredImage = ref(null);
const hoveredSyncedSource = ref(null);
const syncedSourceBubblePos = ref({ top: 0, left: 0 });
const activeTableEl = ref(null);
const tableCellBubblePos = ref({ top: 0, left: 0, width: 0, clamped: false });
const tableAddRowPos = ref({ top: 0, left: 0 });
const hoveredSyncedSourceId = computed(() => {
  if (!hoveredSyncedSource.value || !editor.value?.state) return null;
  const node = editor.value.state.doc.nodeAt(hoveredSyncedSource.value.pos);
  return node?.attrs?.id || null;
});
const hoveredSyncedLocked = computed(() => isSyncedLocked(hoveredSyncedSourceId.value));
const blockBubbleStyle = { position: 'absolute', top: '6px', right: '6px', zIndex: 5 };

const withHandleSelection = (fn) => {
  if (!editor.value) return false;
  const { pos } = handleState.value;
  if (pos == null || pos < 0) return false;
  const safePos = Math.max(1, Math.min(pos + 1, editor.value.state.doc.content.size - 1));
  return fn(editor.value.chain().focus().setTextSelection(safePos));
};

const withHandleRangeTransaction = (fn) => {
  if (!editor.value) return false;
  const { node, pos } = handleState.value;
  if (!node || pos == null || pos < 0) return false;
  const { state, view } = editor.value;
  const start = Math.max(1, pos + 1);
  const end = Math.min(pos + Math.max(1, node.nodeSize - 1), state.doc.content.size);
  const nextTr = fn(state.tr, start, end, state);
  if (!nextTr) return false;
  view.dispatch(nextTr);
  return true;
};

const clearHoveredCodeBlock = () => {
  if (codeLangMenuOpen.value) return;
  hoveredCodeBlock.value = null;
  codeLangMenuOpen.value = false;
};

const showBlockCopyBanner = (blockId) => {
  if (typeof window === 'undefined' || !blockId) return;
  const target = document.querySelector(`[data-block-id="${blockId}"]`);
  if (!(target instanceof HTMLElement)) return;
  const rect = target.getBoundingClientRect();
  const banner = document.createElement('div');
  banner.className = 'block-copy-banner';
  banner.textContent = 'Link copied';
  const left = Math.min(rect.right - 6, window.innerWidth - 8);
  const top = Math.min(Math.max(rect.top, 24), window.innerHeight - 8);
  banner.style.left = `${left}px`;
  banner.style.top = `${top}px`;
  document.body.appendChild(banner);
  window.setTimeout(() => {
    banner.remove();
  }, 1400);
};

const copyBlockLink = async () => {
  const pos = handleState.value?.pos;
  if (!editor.value || !props.pageId) return;
  const node = handleState.value?.node;
  let blockId = node?.attrs?.id;
  if (!blockId && typeof pos === 'number' && pos >= 0) {
    blockId = editor.value.state.doc.nodeAt(pos)?.attrs?.id;
  }
  if (!blockId) {
    // fallback to current selection block
    try {
      const $from = editor.value.state.selection.$from;
      const parent = $from?.node($from.depth);
      blockId = parent?.attrs?.id || null;
    } catch {
      blockId = null;
    }
  }
  if (!blockId) {
    window.alert('Could not find a block ID to copy.');
    return;
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const page = getResolvedPage(props.pageId);
  const workspaceId = page?.workspaceId || workspace.activePageWorkspaceId || null;
  if (!workspaceId) {
    window.alert('Current page is missing a workspace. Please reload or re-open the page.');
    return;
  }
  const url = `${origin}/ws/${encodeURIComponent(workspaceId)}/doc/${props.pageId}#${blockId}`;
  try {
    await navigator.clipboard.writeText(url);
    closeTuneMenu();
    showBlockCopyBanner(blockId);
  } catch {
    window.prompt('Copy block link', url);
  }
};

const isSyncedHandle = computed(() => !!handleState.value?.node?.attrs?.[SYNCED_FROM_ATTR]);

const clearBlockFocus = () => {
  if (!editor.value) return;
  const { state, view } = editor.value;
  const tr = state.tr.setMeta(blockHighlightKey, { clearHighlight: true });
  view.dispatch(tr);
  if (typeof window !== 'undefined') {
    window.removeEventListener('click', clearBlockFocus, { capture: true });
  }
};

const blockScrollRetry = ref(null);

const focusBlockById = (blockId) => {
  if (!editor.value || typeof window === 'undefined' || !blockId) return;
  let targetPos = null;
  editor.value.state.doc.descendants((node, pos) => {
    if (node.isBlock && node.attrs?.id === blockId && targetPos === null) {
      targetPos = pos;
      return false;
    }
    return undefined;
  });
  if (targetPos === null) return;
  const { state, view } = editor.value;
  const SelectionCtor = state.selection.constructor;
  const sel = SelectionCtor.near(state.doc.resolve(targetPos));
  const tr = state.tr.setSelection(sel).setMeta(blockHighlightKey, { highlightId: blockId, highlightType: 'link' });
  view.dispatch(tr);
  if (blockScrollRetry.value) {
    clearInterval(blockScrollRetry.value);
    blockScrollRetry.value = null;
  }
  const attemptScroll = () => {
    const el = document.querySelector(`[data-block-id="${blockId}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return true;
    }
    return false;
  };
  requestAnimationFrame(() => {
    if (!attemptScroll()) {
      blockScrollRetry.value = setInterval(() => {
        if (attemptScroll()) {
          clearInterval(blockScrollRetry.value);
          blockScrollRetry.value = null;
        }
      }, 120);
    }
  });
  const handleClick = () => {
    clearBlockFocus();
  };
  window.addEventListener('click', handleClick, { capture: true, once: true });
};

const setHoveredCodeBlockFromElement = (element) => {
  if (!editor.value?.state || !element) return;
  const posAttr = element.getAttribute('data-pos');
  const pos = posAttr ? parseInt(posAttr, 10) : NaN;
  if (!Number.isFinite(pos)) {
    clearHoveredCodeBlock();
    return;
  }
  let node = null;
  try {
    node = editor.value.state.doc.nodeAt(pos);
  } catch {
    node = null;
  }
  if (!node || node.type?.name !== 'codeBlock') {
    clearHoveredCodeBlock();
    return;
  }
  if (hoveredCodeBlock.value?.pos === pos && hoveredCodeBlock.value?.element === element) return;
  hoveredCodeBlock.value = { pos, element };
};

const handleHoverMove = (event) => {
  const blockEl = event.target?.closest?.('.tiptap-codeblock');
  const isBubble = event.target?.closest?.('.codeblock-bubble-menu');
  const isDropdown = event.target?.closest?.('.code-lang-menu');
  const imageEl = event.target?.closest?.('.tiptap-image-resizable');
  const syncedSourceEl = event.target?.closest?.('.synced-source-block');
  const isSyncedBubble = event.target?.closest?.('.synced-source-bubble-menu');
  const onCodeBlock = !!blockEl;
  const onImage = !!imageEl;
  if (blockEl) {
    setHoveredCodeBlockFromElement(blockEl);
  }
  if (imageEl) {
    setHoveredImageFromElement(imageEl);
  }
  if (syncedSourceEl) {
    setHoveredSyncedSourceFromElement(syncedSourceEl);
  } else if (!isSyncedBubble) {
    clearHoveredSyncedSource();
  }
  if (!onCodeBlock && !isBubble && !isDropdown && !codeLangMenuOpen.value) {
    clearHoveredCodeBlock();
  }
  if (!onImage && !event.target?.closest?.('.image-bubble-menu')) {
    clearHoveredImage();
  }
  updateBlockHandleFromEvent(event);
};

const shouldShowCodeBlockBubble = () => {
  if (!editor.value || editor.value.isDestroyed || !editor.value.isEditable) return false;
  if (!hoveredCodeBlock.value) return false;
  const node = editor.value.state.doc.nodeAt(hoveredCodeBlock.value.pos);
  return !!node && node.type?.name === 'codeBlock';
};

const setHoveredSyncedSourceFromElement = (element) => {
  if (!editor.value?.state || !element) return;
  const posAttr = element.getAttribute('data-block-pos') || element.getAttribute('data-pos');
  let pos = posAttr ? parseInt(posAttr, 10) : NaN;
  if (!Number.isFinite(pos)) {
    try {
      pos = editor.value.view.posAtDOM(element, 0);
    } catch {
      pos = NaN;
    }
  }
  if (!Number.isFinite(pos)) {
    clearHoveredSyncedSource();
    return;
  }
  let node = null;
  try {
    node = editor.value.state.doc.nodeAt(pos);
  } catch {
    node = null;
  }
  if (!node || !node.isBlock || node.attrs?.[SYNCED_FROM_ATTR]) {
    clearHoveredSyncedSource();
    return;
  }
  const rect = element.getBoundingClientRect?.();
  if (rect) {
    syncedSourceBubblePos.value = {
      top: rect.top + 6,
      left: rect.right - 6,
    };
  }
  if (hoveredSyncedSource.value?.pos === pos && hoveredSyncedSource.value?.element === element) return;
  hoveredSyncedSource.value = { pos, element };
};

const clearHoveredSyncedSource = () => {
  hoveredSyncedSource.value = null;
  syncedSourceBubblePos.value = { top: 0, left: 0 };
};

const shouldShowSyncedSourceBubble = () => {
  if (!editor.value || editor.value.isDestroyed || !editor.value.isEditable) return false;
  if (!hoveredSyncedSource.value) return false;
  const node = editor.value.state.doc.nodeAt(hoveredSyncedSource.value.pos);
  return !!node && node.isBlock && !node.attrs?.[SYNCED_FROM_ATTR];
};

const setHoveredImageFromElement = (element) => {
  if (!editor.value?.state || !element) return;
  const posAttr = element.getAttribute('data-pos');
  const pos = posAttr ? parseInt(posAttr, 10) : NaN;
  if (!Number.isFinite(pos)) {
    clearHoveredImage();
    return;
  }
  let node = null;
  try {
    node = editor.value.state.doc.nodeAt(pos);
  } catch {
    node = null;
  }
  if (!node || node.type?.name !== 'image') {
    clearHoveredImage();
    return;
  }
  if (hoveredImage.value?.pos === pos && hoveredImage.value?.element === element) return;
  hoveredImage.value = { pos, element };
};

const clearHoveredImage = () => {
  hoveredImage.value = null;
};

const clearAllHoveredBlocks = () => {
  clearHoveredCodeBlock();
  clearHoveredImage();
  clearHoveredSyncedSource();
};

const shouldShowImageBubble = () => {
  if (!editor.value || editor.value.isDestroyed || !editor.value.isEditable) return false;
  if (!hoveredImage.value) return false;
  const node = editor.value.state.doc.nodeAt(hoveredImage.value.pos);
  return !!node && node.type?.name === 'image';
};

const tableIsFullWidth = computed(() => {
  if (!activeTableEl.value || !editor.value) return false;
  return editor.value.getAttributes('table').fullWidth === true;
});

const toggleTableFullWidth = () => {
  if (!editor.value) return;
  editor.value.chain().focus().updateAttributes('table', { fullWidth: !tableIsFullWidth.value }).run();
};

const syncTableDomAttributes = () => {
  if (!editor.value || editor.value.isDestroyed) return;
  const view = editor.value.view;
  editor.value.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return;
    const domNode = view.nodeDOM(pos);
    if (!domNode) return;
    const tableEl = domNode instanceof HTMLTableElement ? domNode : domNode.querySelector?.('table');
    if (!tableEl) return;
    if (node.attrs.fullWidth) {
      tableEl.setAttribute('data-full-width', 'true');
    } else {
      tableEl.removeAttribute('data-full-width');
    }
  });
};

const updateActiveTable = () => {
  if (!editor.value || editor.value.isDestroyed || !editor.value.isEditable) {
    activeTableEl.value = null;
    return;
  }
  const inTable = editor.value.isActive('tableCell') || editor.value.isActive('tableHeader');
  if (!inTable) {
    activeTableEl.value = null;
    return;
  }
  const domSel = window.getSelection();
  if (!domSel || domSel.rangeCount === 0) return;
  const anchor = domSel.anchorNode;
  const el = anchor instanceof Element ? anchor : anchor?.parentElement;
  const wrapper = el?.closest?.('.tableWrapper');
  if (!wrapper) return;
  activeTableEl.value = wrapper;
  const tableEl = wrapper.querySelector('table') || wrapper;
  const tableRect = tableEl.getBoundingClientRect();
  const wrapperRect = wrapper.getBoundingClientRect();
  const rawTop = tableRect.top;
  const clamped = rawTop < 0 && wrapperRect.bottom > 0;
  tableCellBubblePos.value = {
    top: clamped ? 0 : rawTop,
    left: wrapperRect.left,
    width: wrapperRect.width,
    clamped,
  };
  tableAddRowPos.value = { top: wrapperRect.bottom + 6, left: wrapperRect.left + wrapperRect.width / 2 };
};

const replaceHoveredImageSrc = () => {
  if (!editor.value || !hoveredImage.value) return;
  const pos = hoveredImage.value.pos;
  pickImageFile()
    .then((file) => (file ? uploadImageFile(file) : null))
    .then((src) => {
      if (!src) return;
      editor.value
        .chain()
        .focus()
        .command(({ tr }) => {
          const node = tr.doc.nodeAt(pos);
          if (!node || node.type?.name !== 'image') return false;
          tr.setNodeMarkup(pos, node.type, { ...node.attrs, src }, node.marks);
          return true;
        })
        .run();
    })
    .catch((err) => {
      console.warn('Replace image failed', err);
    });
};

const handleCodeLangOutsideClick = (event) => {
  if (!codeLangMenuOpen.value) return;
  const target = event?.target;
  const isTrigger = target?.closest?.('.code-lang-trigger');
  const isMenu = target?.closest?.('.code-lang-menu');
  if (!isTrigger && !isMenu) {
    closeCodeLangMenu();
  }
};

const handleBubbleColorOutsideClick = (event) => {
  if (!bubbleColorMenuOpen.value) return;
  const target = event?.target;
  const isTrigger = target?.closest?.('.bubble-color-trigger');
  const isMenu = target?.closest?.('.bubble-color-menu');
  if (!isTrigger && !isMenu) {
    closeBubbleColorMenu();
  }
};

const handleBubbleHighlightOutsideClick = (event) => {
  if (!bubbleHighlightMenuOpen.value) return;
  const target = event?.target;
  const isTrigger = target?.closest?.('.bubble-highlight-trigger');
  const isMenu = target?.closest?.('.bubble-highlight-menu');
  if (!isTrigger && !isMenu) {
    closeBubbleHighlightMenu();
  }
};

const { setHandleLocked, LIST_CONTAINER_TYPES, LIST_ITEM_TYPE, setListHandleTriggerHover, setListHandleSelfHover, resolveListItemFromPos, resolveListItemFromTarget, resolveListHandleTarget, applyListHandleSelection, updateBlockHandleFromEvent } = useBlockHandles({ handleState, handleVisible, handleLocked, handlePos, wrapperRef, listHandleState, listHandlePos, listHandleTriggerHover, listHandleSelfHover, LIST_HANDLE_OFFSET, LIST_HANDLE_WIDTH, LIST_HANDLE_HOVER_PADDING, handleDragHandleChange, getEditor: () => editor?.value });

const setMainframeScrollLocked = (locked) => {
  const frame = document.querySelector('.wikid-mainframe');
  if (!frame) return;
  frame.classList.toggle('wikid-mainframe--lock-scroll', !!locked);
};

let dragScrollRestoreActive = false;
const getScrollContainer = () => {
  if (typeof document === 'undefined') return null;
  return document.querySelector('.wikid-mainframe') || document.scrollingElement || document.documentElement;
};
const captureScrollSnapshot = () => {
  const container = getScrollContainer();
  if (!container) return null;
  return { container, top: container.scrollTop, left: container.scrollLeft };
};
const restoreScrollSnapshot = (snapshot) => {
  if (!snapshot?.container) return;
  snapshot.container.scrollTop = snapshot.top;
  snapshot.container.scrollLeft = snapshot.left;
};

const clearTuneMenuBlockHighlight = () => {
  if (tuneMenuBlockEl.value) {
    tuneMenuBlockEl.value.classList.remove('tiptap-block-selected');
    tuneMenuBlockEl.value = null;
  }
};

const updateTuneMenuBlockHighlight = () => {
  clearTuneMenuBlockHighlight();
  if (!showTuneMenu.value || !editor.value) return;
  const pos = handleState.value?.pos;
  if (pos == null || pos < 0) return;
  const root = editor.value.view?.dom;
  if (!root?.querySelector) return;
  const target = root.querySelector(`[data-block-pos="${pos}"]`);
  if (target instanceof HTMLElement) {
    target.classList.add('tiptap-block-selected');
    tuneMenuBlockEl.value = target;
  }
};

watch(
  () => showTuneMenu.value || slashMenuOpen.value,
  (locked) => setMainframeScrollLocked(locked),
  { immediate: true }
);

watch(
  () => [showTuneMenu.value, handleState.value?.pos],
  () => {
    if (!showTuneMenu.value) {
      clearTuneMenuBlockHighlight();
      return;
    }
    updateTuneMenuBlockHighlight();
  }
);

watch(
  () => props.collab,
  () => {
    if (isCollabEnabled.value) {
      setupCollabProvider();
      updateAwarenessUser();
      setupSyncedWorkspaceProvider();
    } else {
      teardownCollabProvider();
      teardownSyncedWorkspaceProvider();
    }
  },
  { deep: true }
);

watch(
  [collabProvider, cursorUser],
  () => {
    updateAwarenessUser();
  },
  { immediate: true }
);

watch(
  () => activeWorkspaceId.value,
  () => {
    if (isCollabEnabled.value) {
      setupSyncedWorkspaceProvider();
    }
  },
  { immediate: true }
);

const closeTuneMenu = () => {
  showTuneMenu.value = false;
  panelState.value = 'root';
  tuneMenuDir.value = 'forward';
  tuneMenuFlipped.value = false;
  clearTuneMenuBlockHighlight();
  if (!slashMenuOpen.value) {
    setHandleLocked(false);
  }
};

const openTuneMenu = async (event) => {
  const rect = event?.currentTarget?.getBoundingClientRect?.();
  tuneMenuFlipped.value = false;
  if (rect) {
    tuneMenuPos.value = { top: rect.top + rect.height / 2, left: rect.left };
  }
  showTuneMenu.value = true;
  panelState.value = 'root';
  tuneMenuDir.value = 'forward';
  setHandleLocked(true);
  await nextTick();
  if (rect && tuneMenuRef.value) {
    const menuRect = tuneMenuRef.value.getBoundingClientRect();
    const margin = 8;
    const flipped = rect.left - menuRect.width < margin;
    tuneMenuFlipped.value = flipped;
    let top, left;
    if (flipped) {
      // Open below the first line at the same x (right edge of menu aligns with handle left)
      top = rect.bottom;
      left = rect.left;
      if (top + menuRect.height > window.innerHeight - margin) {
        top = window.innerHeight - margin - menuRect.height;
      }
      top = Math.max(margin, top);
    } else {
      top = rect.top + rect.height / 2;
      left = rect.left;
      const menuBottom = top + menuRect.height / 2;
      if (menuBottom > window.innerHeight - margin) {
        top = window.innerHeight - margin - menuRect.height / 2;
      }
      top = Math.max(margin + menuRect.height / 2, top);
    }
    tuneMenuPos.value = { top, left };
  }
};

const openListTuneMenu = (event) => {
  if (!applyListHandleSelection()) return;
  openTuneMenu(event);
};

const insertNewListBlockBelow = () => {
  if (!applyListHandleSelection()) return;
  insertNewBlockBelow();
};

const handleListDragStart = (event) => {
  const listTarget = resolveListHandleTarget();
  if (!listTarget?.node || listTarget.pos == null || listTarget.pos < 0) return;
  handleDragHandleChange({ node: listTarget.node, pos: listTarget.pos });
  handleBlockDragStart(event, { pos: listTarget.pos, node: listTarget.node, ignoreRangeSelection: true, source: 'list' });
};

const handleOutsideClick = (event) => {
  if (!showTuneMenu.value) return;
  const target = event.target;
  const isInsideMenu = tuneMenuRef.value && tuneMenuRef.value.contains(target);
  const isHandle = target?.closest?.('.drag-handle');
  if (!isInsideMenu && !isHandle) {
    closeTuneMenu();
  }
};

const handleGlobalDragStart = (event) => {
  if (!editor.value?.view?.dom?.contains?.(event.target)) return;
  // A cancelled drag never gets a dragend, so make sure it leaves nothing behind.
  // Tiptap cancels drags that start inside a node view (e.g. orbiting the splat viewer),
  // but ProseMirror still records them as a pending move, and Tiptap's window dragstart
  // listener remembers this editor as a drag source; the next drop from the block handle
  // (which sits outside the editor) then made Tiptap delete the dropped block.
  if (event.defaultPrevented) {
    event.stopPropagation();
    editor.value.view.dragging = null;
    return;
  }
  hideAwarenessCursor();
};

const handleGlobalDragEnd = (event) => {
  if (!editor.value?.view?.dom?.contains?.(event.target)) return;
  // Let selection settle, then restore awareness cursor
  requestAnimationFrame(() => restoreAwarenessCursor());
  dragScrollRestoreActive = false;
};

const handleBlockDragStart = (event, options = {}) => {
  if (!editor.value?.view || !event?.dataTransfer) return;
  dragScrollRestoreActive = true;
  const { state, view } = editor.value;
  const overridePos = typeof options.pos === 'number' ? options.pos : null;
  let targetPos = overridePos ?? handleState.value?.pos;
  if (targetPos == null || targetPos < 0) return;
  let targetNode = options.node || state.doc.nodeAt(targetPos);
  if (!targetNode) return;
  if (options.source !== 'list' && LIST_CONTAINER_TYPES.has(targetNode.type?.name)) {
    const listItemTarget = resolveListItemFromTarget(event.target, event.clientY);
    if (listItemTarget?.node && typeof listItemTarget.pos === 'number') {
      targetPos = listItemTarget.pos;
      targetNode = listItemTarget.node;
      handleDragHandleChange({ node: targetNode, pos: targetPos });
    } else if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
      const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
      const listItemFromCoords = resolveListItemFromPos(coords?.pos);
      if (listItemFromCoords?.node && typeof listItemFromCoords.pos === 'number') {
        targetPos = listItemFromCoords.pos;
        targetNode = listItemFromCoords.node;
        handleDragHandleChange({ node: targetNode, pos: targetPos });
      }
    }
  }
  const ignoreRangeSelection =
    typeof options.ignoreRangeSelection === 'boolean'
      ? options.ignoreRangeSelection
      : targetNode.type?.name === LIST_ITEM_TYPE;
  const columnInfo = findColumnAncestor(state, targetPos);
  const onlyColumnBlock = columnInfo ? getColumnOnlyBlock(columnInfo.node, columnInfo.pos) : null;
  const shouldCleanupColumn = !!(onlyColumnBlock && onlyColumnBlock.pos === targetPos);
  handleLocked.value = true;
  let selection = null;
  if (!ignoreRangeSelection && state.selection instanceof NodeRangeSelection) {
    const ranges = state.selection.ranges || [];
    const includesPos = ranges.some((range) => targetPos >= range.$from.pos && targetPos < range.$to.pos);
    if (includesPos) {
      selection = state.selection;
    }
  }
  if (!selection) {
    try {
      selection = NodeSelection.create(state.doc, targetPos);
    } catch (err) {
      console.warn('Failed to create node selection for drag handle', err);
      handleLocked.value = false;
      return;
    }
  }
  const slice = selection.content();
  const wrapper = document.createElement('div');
  const dragRanges = selection instanceof NodeRangeSelection
    ? selection.ranges
    : [{ $from: selection.$from }];
  dragRanges.forEach((range) => {
    const element = view.nodeDOM(range.$from.pos);
    if (element instanceof HTMLElement) {
      wrapper.append(cloneElement(element));
    }
  });
  wrapper.style.position = 'absolute';
  wrapper.style.top = '-10000px';
  document.body.append(wrapper);
  event.dataTransfer.clearData();
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setDragImage(wrapper, 0, 0);
  view.dragging = { slice, move: true };
  const selectionTr = state.tr.setSelection(selection);
  if (shouldCleanupColumn && columnInfo && !(selection instanceof NodeRangeSelection)) {
    selectionTr.setMeta(columnCleanupKey, { pending: { pos: columnInfo.pos } });
  }
  view.dispatch(selectionTr);
  const cleanup = () => removeNode(wrapper);
  document.addEventListener('drop', cleanup, { once: true });
  document.addEventListener('dragend', () => {
    cleanup();
    handleLocked.value = false;
    dragScrollRestoreActive = false;
    if (editor.value) {
      const { state: endState, view: endView } = editor.value;
      endView.dispatch(endState.tr.setMeta(columnCleanupKey, { clear: true }));
    }
  }, { once: true });
};

const turnIntoParagraph = () => {
  withHandleSelection((chain) => chain.setParagraph().run());
  closeTuneMenu();
};

const turnIntoHeading = (level) => {
  withHandleSelection((chain) => chain.toggleHeading({ level }).run());
  closeTuneMenu();
};

const toggleTodo = () => {
  withHandleSelection((chain) => chain.toggleTaskList().run());
  closeTuneMenu();
};

const toggleBullet = () => {
  withHandleSelection((chain) => chain.toggleBulletList().run());
  closeTuneMenu();
};

const toggleOrdered = () => {
  withHandleSelection((chain) => chain.toggleOrderedList().run());
  closeTuneMenu();
};

const turnIntoCodeBlock = () => {
  withHandleSelection((chain) => chain.setCodeBlock().run());
  closeTuneMenu();
};

const setCodeBlockLanguage = (language) => {
  const next = typeof language === 'string' ? language : '';
  withHandleSelection((chain) => chain.updateAttributes('codeBlock', { language: next || null }).run());
  closeTuneMenu();
};

const setHoveredCodeBlockLanguage = (language) => {
  if (!editor.value || !hoveredCodeBlock.value) return;
  const pos = hoveredCodeBlock.value.pos;
  const next = typeof language === 'string' ? language.trim() : '';
  editor.value
    .chain()
    .focus()
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(pos);
      if (!node || node.type?.name !== 'codeBlock') return false;
      tr.setNodeMarkup(pos, node.type, { ...node.attrs, language: next || null }, node.marks);
      return true;
    })
    .run();
};

const updateCodeLangMenuPos = () => {
  const el = codeLangButtonRef.value;
  if (!el?.getBoundingClientRect) return;
  const rect = el.getBoundingClientRect();
  const menuHeight = 300; // approximate max height of the language menu
  const spaceBelow = window.innerHeight - rect.bottom;
  const top = spaceBelow < menuHeight + 6
    ? rect.top - menuHeight - 6
    : rect.bottom + 6;
  codeLangMenuPos.value = {
    top: Math.max(6, top),
    left: rect.left,
  };
};

const toggleCodeLangMenu = (event) => {
  if (event?.currentTarget) {
    codeLangButtonRef.value = event.currentTarget;
  }
  if (!codeLangMenuOpen.value) {
    updateCodeLangMenuPos();
  }
  codeLangMenuOpen.value = !codeLangMenuOpen.value;
};

const closeCodeLangMenu = () => {
  codeLangMenuOpen.value = false;
};

const updateBubbleColorMenuPos = () => {
  positionBubbleMenu(bubbleColorButtonRef, bubbleColorMenuRef, bubbleColorMenuPos);
};

const toggleBubbleColorMenu = async (event) => {
  if (event?.currentTarget) {
    bubbleColorButtonRef.value = event.currentTarget;
  }
  if (bubbleColorMenuOpen.value) {
    closeBubbleColorMenu();
    return;
  }
  bubbleHighlightMenuOpen.value = false;
  bubbleColorMenuOpen.value = true;
  await nextTick();
  updateBubbleColorMenuPos();
};

const closeBubbleColorMenu = () => {
  bubbleColorMenuOpen.value = false;
};

const updateBubbleHighlightMenuPos = () => {
  positionBubbleMenu(bubbleHighlightButtonRef, bubbleHighlightMenuRef, bubbleHighlightMenuPos);
};

const toggleBubbleHighlightMenu = async (event) => {
  if (event?.currentTarget) {
    bubbleHighlightButtonRef.value = event.currentTarget;
  }
  if (bubbleHighlightMenuOpen.value) {
    closeBubbleHighlightMenu();
    return;
  }
  bubbleColorMenuOpen.value = false;
  bubbleHighlightMenuOpen.value = true;
  await nextTick();
  updateBubbleHighlightMenuPos();
};

const closeBubbleHighlightMenu = () => {
  bubbleHighlightMenuOpen.value = false;
};

const applyBubbleHighlightOption = (color) => {
  if (!editor.value) return;
  const { state, view } = editor.value;
  const { from, to } = state.selection;
  const markType = state.schema.marks.highlight;
  if (!markType) return;
  view.dispatch(state.tr.addMark(from, to, markType.create({ color })));
  closeBubbleHighlightMenu();
};

const resetBubbleHighlightOption = () => {
  if (!editor.value) return;
  const { state, view } = editor.value;
  const { from, to } = state.selection;
  const markType = state.schema.marks.highlight;
  if (!markType) return;
  view.dispatch(state.tr.removeMark(from, to, markType));
  closeBubbleHighlightMenu();
};

const applyBubbleTextColorOption = (color) => {
  if (!editor.value) return;
  editor.value.chain().focus().setColor(color).run();
  closeBubbleColorMenu();
};

const resetBubbleTextColorOption = () => {
  if (!editor.value) return;
  editor.value.chain().focus().unsetColor().run();
  closeBubbleColorMenu();
};

const updateHorizontalRuleAttrs = (attrs) => {
  if (!editor.value) return false;
  const node = getHandleNode();
  const pos = handleState.value?.pos;
  if (!node || node.type?.name !== 'horizontalRule' || pos == null || pos < 0) return false;
  const { state, view } = editor.value;
  const nextAttrs = { ...node.attrs, ...attrs };
  const tr = state.tr.setNodeMarkup(pos, node.type, nextAttrs);
  view.dispatch(tr);
  return true;
};

const setHorizontalRuleColor = (color) => updateHorizontalRuleAttrs({ color });
const clearHorizontalRuleColor = () => updateHorizontalRuleAttrs({ color: null });
const setHorizontalRuleSize = (size) => updateHorizontalRuleAttrs({ size });
const setHorizontalRuleAlign = (align) => updateHorizontalRuleAttrs({ align });

const updatePageLinkAttrs = (attrs) => {
  if (!editor.value) return false;
  const node = getHandleNode();
  const pos = handleState.value?.pos;
  if (!node || node.type?.name !== 'pageLink' || pos == null || pos < 0) return false;
  const { state, view } = editor.value;
  const nextAttrs = { ...node.attrs, ...attrs };
  const tr = state.tr.setNodeMarkup(pos, node.type, nextAttrs);
  view.dispatch(tr);
  return true;
};
const setPageLinkStyle = (style) => {
  const next = style === 'small' ? 'small' : 'card';
  updatePageLinkAttrs({ style: next });
  closeTuneMenu();
};
const setPageLinkAttribute = (attribute) => {
  const next = typeof attribute === 'string' ? attribute : '';
  updatePageLinkAttrs({ attribute: next });
  closeTuneMenu();
};

const applyTextColorOption = (color) => {
  if (isHorizontalRule.value) {
    setHorizontalRuleColor(color);
    return;
  }
  setTextColor(color);
};

const resetTextColorOption = () => {
  if (isHorizontalRule.value) {
    clearHorizontalRuleColor();
    return;
  }
  clearTextColor();
};

const setTextColor = (color) => {
  withHandleRangeTransaction((tr, start, end, state) => {
    const markType = state.schema.marks.textStyle;
    if (!markType) return null;
    return tr.addMark(start, end, markType.create({ color }));
  });
};

const clearTextColor = () => {
  withHandleRangeTransaction((tr, start, end, state) => {
    const markType = state.schema.marks.textStyle;
    if (!markType) return null;
    return tr.removeMark(start, end, markType);
  });
};

const setHighlightColor = (color) => {
  withHandleRangeTransaction((tr, start, end, state) => {
    const markType = state.schema.marks.highlight;
    if (!markType) return null;
    return tr.addMark(start, end, markType.create({ color }));
  });
};

const clearHighlight = () => {
  withHandleRangeTransaction((tr, start, end, state) => {
    const markType = state.schema.marks.highlight;
    if (!markType) return null;
    return tr.removeMark(start, end, markType);
  });
};

const openPanel = (next) => {
  if (isImageBlock.value && next !== 'root') return;
  if (isHorizontalRule.value && next === 'highlight') return;
  if (!isHorizontalRule.value && next === 'divider') return;
  if (!isHorizontalRule.value && next === 'dividerAlign') return;
  panelState.value = next;
  tuneMenuDir.value = next === 'root' ? 'backward' : 'forward';
  if (next === 'pageLinkAttributes') {
    loadPageLinkAttributes(currentPageLinkTargetId.value);
  }
};

const insertNewBlockBelow = () => {
  if (!editor.value) return;
  const { node, pos } = handleState.value;
  if (!node || pos == null || pos < 0) return;
  const insertPos = pos + node.nodeSize;
  editor.value
    .chain()
    .focus()
    .insertContentAt(insertPos, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
    .setTextSelection(insertPos + 2)
    .run();
  // Nudge the drag handle to the new block by faking a mouse move over it.
  const view = editor.value.view;
  const domNode = view?.nodeDOM(insertPos);
  const rect = domNode?.getBoundingClientRect?.();
  if (rect && view?.dom) {
    const syntheticMove = new MouseEvent('mousemove', {
      clientX: rect.left + 1,
      clientY: rect.top + 1,
      bubbles: true,
      cancelable: true,
      view: window,
    });
    view.dom.dispatchEvent(syntheticMove);
  }
  closeTuneMenu();
};

const deleteBlock = () => {
  if (!editor.value) return;
  const { node, pos } = handleState.value;
  if (!node || pos == null || pos < 0) return;
  editor.value
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.delete(pos, pos + node.nodeSize);
      return true;
    })
    .run();
  closeTuneMenu();
};

const handleMainframeScroll = () => {
  if (activeTableEl.value) updateActiveTable();
};

onMounted(() => {
  document.addEventListener('mousedown', handleOutsideClick);
  document.addEventListener('dragstart', handleGlobalDragStart);
  document.addEventListener('dragend', handleGlobalDragEnd);
  document.addEventListener('mousemove', handleHoverMove);
  document.addEventListener('mouseleave', clearAllHoveredBlocks);
  document.addEventListener('mousedown', handleCodeLangOutsideClick);
  document.addEventListener('mousedown', handleBubbleColorOutsideClick);
  document.addEventListener('mousedown', handleBubbleHighlightOutsideClick);
  document.querySelector('.wikid-mainframe')?.addEventListener('scroll', handleMainframeScroll, { passive: true });
  document.addEventListener('mousemove', handleSuggestionMousemove);
});

watch(
  () => props.doc,
  (next) => {
    if (!editor.value) return;
    if (isCollabEnabled.value) return; // Yjs manages content when collaboration is on
    const nextDoc = editorDocToTiptap(next);
    const current = editor.value.getJSON();
    if (!sameContent(current?.content, nextDoc.content)) {
      editor.value.commands.setContent(nextDoc, false);
    }
  },
  { deep: true }
);

onBeforeUnmount(() => {
  editor.value?.destroy();
  teardownCollabProvider();
  disposeSyncedBlocks();
  pageLinkCollabState.forEach((_, databasePageId) => {
    teardownPageLinkCollabState(databasePageId);
  });
  stopUnsyncedWatcher();
  clearSavedDelay();
  document.removeEventListener('mousedown', handleOutsideClick);
  document.removeEventListener('dragstart', handleGlobalDragStart);
  document.removeEventListener('dragend', handleGlobalDragEnd);
  document.removeEventListener('mousemove', handleHoverMove);
  document.removeEventListener('mouseleave', clearAllHoveredBlocks);
  document.removeEventListener('mousedown', handleCodeLangOutsideClick);
  document.removeEventListener('mousedown', handleBubbleColorOutsideClick);
  document.removeEventListener('mousedown', handleBubbleHighlightOutsideClick);
  document.removeEventListener('mousemove', handleSuggestionMousemove);
  document.querySelector('.wikid-mainframe')?.removeEventListener('scroll', handleMainframeScroll);
  setHandleLocked(false);
  setMainframeScrollLocked(false);
});

const blurEditor = () => {
  activeTableEl.value = null;
  editor.value?.commands.blur();
};

defineExpose({
  collabDoc,
  collabProvider,
  collabReady,
  isCollabEnabled,
  focusBlockById,
  insertParagraphAtTop,
  blurEditor,
  // AI suggestion API
  serializeBlocksForAi,
  applyAiSuggestions,
  revertSuggestion,
  acceptSuggestion,
  revertAllSuggestions,
  acceptAllSuggestions,
  activeSuggestions,
  // Block summarizer state
  summarizationPending,
  summarizationStats,
  summarizeForAi,
});
</script>

<template>
  <div ref="wrapperRef" class="tiptap-wrapper">
    <BubbleMenu
      v-if="editor"
      :editor="editor"
      class="bubble-menu"
      :options="{ duration: 150, interactive: true, hideOnClick: false, zIndex: 5000 }"
      :should-show="shouldShowBubble"
      :get-referenced-virtual-element="getBubbleMenuVirtualElement"
    >
      <button
        class="bubble-menu__btn"
        :class="{ active: editor.isActive('bold') }"
        type="button"
        aria-pressed="editor.isActive('bold')"
        @mousedown.prevent
        @click.prevent="toggleBold"
      >
        B
      </button>
      <button
        class="bubble-menu__btn"
        :class="{ active: editor.isActive('italic') }"
        type="button"
        aria-pressed="editor.isActive('italic')"
        @mousedown.prevent
        @click.prevent="toggleItalic"
      >
        I
      </button>
      <button
        class="bubble-menu__btn bubble-menu__btn--strike"
        :class="{ active: editor.isActive('strike') }"
        type="button"
        aria-pressed="editor.isActive('strike')"
        @mousedown.prevent
        @click.prevent="toggleStrike"
      >
        S
      </button>
      <button
        class="bubble-menu__btn"
        :class="{ active: editor.isActive('link') }"
        type="button"
        aria-pressed="editor.isActive('link')"
        @mousedown.prevent
        @click.prevent="promptLink"
      >
        Link
      </button>
      <button
        class="bubble-menu__btn bubble-color-trigger"
        type="button"
        :style="{ color: currentColor || undefined }"
        @mousedown.prevent
        :aria-expanded="bubbleColorMenuOpen"
        aria-haspopup="menu"
        @click.prevent="toggleBubbleColorMenu($event)"
      >
        Color
      </button>
      <button
        class="bubble-menu__btn bubble-highlight-trigger"
        :class="{ active: !!currentHighlightColor }"
        type="button"
        @mousedown.prevent
        :aria-expanded="bubbleHighlightMenuOpen"
        aria-haspopup="menu"
        @click.prevent="toggleBubbleHighlightMenu($event)"
      >
        Highlight
      </button>
      <span class="bubble-menu__divider" aria-hidden="true"></span>
      <template v-if="!aiStreaming">
        <button class="bubble-menu__btn bubble-menu__btn--ai" type="button" title="Improve writing" @mousedown.prevent @click.prevent="runAiBubbleAction('improve')">✦ Improve</button>
        <button class="bubble-menu__btn bubble-menu__btn--ai" type="button" title="Summarise" @mousedown.prevent @click.prevent="runAiBubbleAction('summarise')">Summarise</button>
        <button class="bubble-menu__btn bubble-menu__btn--ai" type="button" title="Make shorter" @mousedown.prevent @click.prevent="runAiBubbleAction('shorten')">Shorten</button>
        <button class="bubble-menu__btn bubble-menu__btn--ai" type="button" title="Expand with more detail" @mousedown.prevent @click.prevent="runAiBubbleAction('expand')">Expand</button>
      </template>
      <span v-else class="bubble-menu__ai-streaming" aria-live="polite">✦ Writing…</span>
    </BubbleMenu>
    <Teleport to="body">
      <div
        v-if="bubbleColorMenuOpen"
        class="bubble-menu__dropdown bubble-color-menu"
        ref="bubbleColorMenuRef"
        role="menu"
        :style="{ position: 'fixed', top: `${bubbleColorMenuPos.top}px`, left: `${bubbleColorMenuPos.left}px` }"
      >
        <div class="block-menu__submenu-section">
          <div class="block-menu__group-title">Text color</div>
          <div class="block-menu__color-list">
            <button
              class="block-menu__color-btn"
              type="button"
              :aria-selected="!currentColor"
              @mousedown.prevent
              @click.prevent="resetBubbleTextColorOption"
            >
              <span class="block-menu__color-dot block-menu__color-dot--default"></span>
              <span class="block-menu__color-label">Default</span>
            </button>
            <button
              v-for="option in textColorOptions"
              :key="option.value"
              class="block-menu__color-btn"
              type="button"
              :aria-selected="currentColor === option.value"
              @mousedown.prevent
              @click.prevent="applyBubbleTextColorOption(option.value)"
            >
              <span class="block-menu__color-dot" :style="{ backgroundColor: option.value }"></span>
              <span class="block-menu__color-label">{{ option.name }}</span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="bubbleHighlightMenuOpen"
        class="bubble-menu__dropdown bubble-highlight-menu"
        ref="bubbleHighlightMenuRef"
        role="menu"
        :style="{ position: 'fixed', top: `${bubbleHighlightMenuPos.top}px`, left: `${bubbleHighlightMenuPos.left}px` }"
      >
        <div class="block-menu__submenu-section">
          <div class="block-menu__group-title">Highlight</div>
          <div class="block-menu__color-list">
            <button
              class="block-menu__color-btn"
              type="button"
              :aria-selected="!currentHighlightColor"
              @mousedown.prevent
              @click.prevent="resetBubbleHighlightOption"
            >
              <span class="block-menu__color-dot block-menu__color-dot--reset"></span>
              <span class="block-menu__color-label">None</span>
            </button>
            <button
              v-for="option in highlightOptions"
              :key="option.value"
              class="block-menu__color-btn"
              type="button"
              :aria-selected="currentHighlightColor === option.value"
              @mousedown.prevent
              @click.prevent="applyBubbleHighlightOption(option.value)"
            >
              <span class="block-menu__color-dot" :style="{ backgroundColor: option.value }"></span>
              <span class="block-menu__color-label">{{ option.name }}</span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
    <div
      v-if="editor && listHandleVisible"
      class="drag-handle drag-handle--floating drag-handle--list"
      :style="listHandleStyle"
      @mouseenter="setListHandleSelfHover(true)"
      @mouseleave="setListHandleSelfHover(false)"
    >
      <span
        class="drag-handle__brace"
        :style="listHandleBraceStyle"
        aria-hidden="true"
        @mouseenter="setListHandleSelfHover(true)"
        @mouseleave="setListHandleSelfHover(false)"
      ></span>
      <button
        class="drag-handle__btn drag-handle__btn--insert"
        type="button"
        aria-label="Insert block after list"
        @pointerdown.stop
        @click.stop="insertNewListBlockBelow"
      >
        <i class="bi bi-plus" aria-hidden="true"></i>
      </button>
      <button
        class="drag-handle__btn drag-handle__btn--drag"
        type="button"
        aria-label="Drag or open list menu"
        draggable="true"
        @click.stop="openListTuneMenu"
        @dragstart="handleListDragStart"
      >
        <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
        <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
      </button>
    </div>
    <div
      v-if="editor && (handleVisible || handleLocked)"
      ref="handleRef"
      class="drag-handle drag-handle--floating"
      :style="handleStyle"
      @mouseenter="setListHandleTriggerHover(true)"
      @mouseleave="setListHandleTriggerHover(false)"
    >
      <button class="drag-handle__btn drag-handle__btn--insert" type="button" aria-label="Insert block" @pointerdown.stop @click.stop="insertNewBlockBelow">
        <i class="bi bi-plus" aria-hidden="true"></i>
      </button>
      <button
        class="drag-handle__btn drag-handle__btn--drag"
        type="button"
        aria-label="Drag or open block menu"
        draggable="true"
        @click.stop="openTuneMenu"
        @dragstart="handleBlockDragStart"
      >
        <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
        <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
      </button>
    </div>
    <EditorContent :editor="editor" />
    <Teleport v-if="shouldShowCodeBlockBubble() && hoveredCodeBlock?.element" :to="hoveredCodeBlock.element">
      <div class="bubble-menu codeblock-bubble-menu" :style="blockBubbleStyle">
        <div class="bubble-menu__group code-lang-dropdown">
          <button
            class="bubble-menu__btn code-lang-trigger"
            type="button"
            aria-haspopup="listbox"
            :aria-expanded="codeLangMenuOpen"
            @mousedown.prevent
            @click.prevent="toggleCodeLangMenu($event)"
          >
            {{ hoveredCodeLanguage || 'Plain' }}
          </button>
        </div>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="shouldShowSyncedSourceBubble() && hoveredSyncedSource?.element"
        class="bubble-menu synced-source-bubble-menu"
        :style="{
          position: 'fixed',
          top: `${syncedSourceBubblePos.top}px`,
          left: `${syncedSourceBubblePos.left}px`,
          transform: 'translate(-100%, 0)',
          zIndex: 2100,
        }"
      >
        <div class="bubble-menu__group">
          <button class="bubble-menu__btn" type="button" @mousedown.prevent @click.prevent="toggleSyncedLock">
            {{ hoveredSyncedLocked ? '🔒 Locked' : '🔓 Unlocked' }}
          </button>
          <span class="bubble-menu__label">
            {{ hoveredSyncedLocked ? 'Edits flow to references' : 'References are editable' }}
          </span>
        </div>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="codeLangMenuOpen"
        class="bubble-menu__dropdown code-lang-menu"
        role="listbox"
        :style="{ position: 'fixed', top: `${codeLangMenuPos.top}px`, left: `${codeLangMenuPos.left}px` }"
      >
        <button
          class="bubble-menu__dropdown-item"
          type="button"
          :aria-selected="(hoveredCodeLanguage || '') === ''"
          @mousedown.prevent
          @click.prevent="setHoveredCodeBlockLanguage(''); closeCodeLangMenu()"
        >
          Plain
        </button>
        <button
          v-for="lang in codeBlockLanguages.filter(Boolean)"
          :key="lang"
          class="bubble-menu__dropdown-item"
          type="button"
          :aria-selected="hoveredCodeLanguage === lang"
          @mousedown.prevent
          @click.prevent="setHoveredCodeBlockLanguage(lang); closeCodeLangMenu()"
        >
          {{ lang }}
        </button>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="showTuneMenu"
        ref="tuneMenuRef"
        class="block-menu"
        :style="{ top: `${tuneMenuPos.top}px`, left: `${tuneMenuPos.left}px`, position: 'fixed', transform: tuneMenuFlipped ? 'translate(0, 0)' : 'translate(-100%, -50%)', zIndex: 2100 }"
      >
        <div class="block-menu__panel-stack">
          <transition :name="tuneMenuDir === 'backward' ? 'block-menu-slide-back' : 'block-menu-slide'" mode="out-in">
            <div :key="panelState" class="block-menu__panel">
              <template v-if="panelState === 'root'">
                <div class="block-menu__panel-scroll block-menu__panel-scroll--root">
                  <button v-if="!isImageBlock" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('turnInto')">
                    <span class="block-menu__icon"><i class="bi bi-arrow-repeat" aria-hidden="true"></i></span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Turn into…</span>
                      <span class="block-menu__hint">Change block type</span>
                    </span>
                    <span class="block-menu__chevron">›</span>
                  </button>
                  <button v-if="isCodeBlock" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('code')">
                    <span class="block-menu__icon"><i class="bi bi-code-square" aria-hidden="true"></i></span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Code options</span>
                      <span class="block-menu__hint">Set language</span>
                    </span>
                    <span class="block-menu__chevron">›</span>
                  </button>
                  <button v-if="isPageLinkBlock" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('pageLinkStyle')">
                    <span class="block-menu__icon">St</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Style</span>
                      <span class="block-menu__hint">Card or small</span>
                    </span>
                    <span class="block-menu__chevron">›</span>
                  </button>
                  <button v-if="isPageLinkBlock" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('pageLinkAttributes')">
                    <span class="block-menu__icon">At</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Attributes</span>
                      <span class="block-menu__hint">{{ currentPageLinkAttributeLabel }}</span>
                    </span>
                    <span class="block-menu__chevron">›</span>
                  </button>
                  <div v-if="!isImageBlock" class="block-menu__divider" role="separator" aria-hidden="true"></div>
                  <button v-if="!isImageBlock" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('colour')">
                    <span class="block-menu__icon block-menu__icon--text" :style="{ color: tuneTextColor }">
                      <i class="bi bi-alphabet" aria-hidden="true"></i>
                    </span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Colour</span>
                      <span class="block-menu__hint">Text colour</span>
                    </span>
                    <span class="block-menu__chevron">›</span>
                  </button>
                  <button v-if="isHorizontalRule" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('divider')">
                    <span class="block-menu__icon"><i class="bi bi-arrows-vertical" aria-hidden="true"></i></span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Divider height</span>
                      <span class="block-menu__hint">Small, medium, large</span>
                    </span>
                    <span class="block-menu__chevron">›</span>
                  </button>
                  <button v-if="isHorizontalRule" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('dividerAlign')">
                    <span class="block-menu__icon"><i class="bi bi-align-middle" aria-hidden="true"></i></span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Divider alignment</span>
                      <span class="block-menu__hint">Top, middle, bottom</span>
                    </span>
                    <span class="block-menu__chevron">›</span>
                  </button>
                  <button v-if="!isImageBlock && !isHorizontalRule" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('highlight')">
                    <span class="block-menu__icon block-menu__icon--highlight" :style="{ color: tuneTextColor }">
                      <span class="block-menu__icon-highlight" :style="{ '--block-menu-highlight-color': tuneHighlightColor || 'transparent' }">
                        <i class="bi bi-alphabet" aria-hidden="true"></i>
                      </span>
                    </span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Highlight</span>
                      <span class="block-menu__hint">Highlight text</span>
                    </span>
                    <span class="block-menu__chevron">›</span>
                  </button>
                  <button class="block-menu__item" type="button" @click="copyBlockLink">
                    <span class="block-menu__icon">🔗</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Copy block link</span>
                      <span class="block-menu__hint">Link to this block</span>
                    </span>
                  </button>
                  <div v-if="isSyncedHandle" class="block-menu__notice">You are editing the original synced block!</div>
                  <button class="block-menu__item" type="button" @click="deleteBlock">
                    <span class="block-menu__icon">x</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Delete</span>
                      <span class="block-menu__hint">Remove this block</span>
                      </span>
                    </button>
                </div>
              </template>
              <template v-else-if="panelState === 'turnInto'">
                <div class="block-menu__panel-header">
                  <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
                  <span class="block-menu__panel-title">Turn into</span>
                </div>
                <div class="block-menu__panel-scroll">
                  <button class="block-menu__item" type="button" @click="turnIntoParagraph">
                    <span class="block-menu__icon">Tx</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Paragraph</span>
                      <span class="block-menu__hint">Turn into text</span>
                    </span>
                  </button>
                  <button class="block-menu__item" type="button" @click="turnIntoHeading(1)">
                    <span class="block-menu__icon">H1</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Heading 1</span>
                      <span class="block-menu__hint">Large heading</span>
                    </span>
                  </button>
                  <button class="block-menu__item" type="button" @click="turnIntoHeading(2)">
                    <span class="block-menu__icon">H2</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Heading 2</span>
                      <span class="block-menu__hint">Section heading</span>
                    </span>
                  </button>
                  <button class="block-menu__item" type="button" @click="turnIntoHeading(3)">
                    <span class="block-menu__icon">H3</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Heading 3</span>
                      <span class="block-menu__hint">Sub heading</span>
                    </span>
                  </button>
                  <button class="block-menu__item" type="button" @click="turnIntoCodeBlock">
                    <span class="block-menu__icon">&lt;/&gt;</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Code block</span>
                      <span class="block-menu__hint">Monospace block</span>
                    </span>
                  </button>
                  <button class="block-menu__item" type="button" @click="toggleTodo">
                    <span class="block-menu__icon">[ ]</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">To-do</span>
                      <span class="block-menu__hint">Checkbox list</span>
                    </span>
                  </button>
                  <button class="block-menu__item" type="button" @click="toggleBullet">
                    <span class="block-menu__icon">*</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Bulleted list</span>
                      <span class="block-menu__hint">Turn into bullets</span>
                    </span>
                  </button>
                  <button class="block-menu__item" type="button" @click="toggleOrdered">
                    <span class="block-menu__icon">1.</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Numbered list</span>
                      <span class="block-menu__hint">Turn into ordered</span>
                    </span>
                  </button>
                </div>
              </template>
              <template v-else-if="panelState === 'colour'">
                <div class="block-menu__panel-header">
                  <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
                  <span class="block-menu__panel-title">Colour</span>
                </div>
                <div class="block-menu__panel-scroll">
                  <div class="block-menu__group block-menu__submenu-section">
                    <div class="block-menu__group-title">{{ isHorizontalRule ? 'Rule colour' : 'Text colour' }}</div>
                    <div class="block-menu__color-list">
                      <button
                        class="block-menu__color-btn"
                        type="button"
                        :aria-label="isHorizontalRule ? 'Default rule color' : 'Default text color'"
                        @click="resetTextColorOption"
                      >
                        <span class="block-menu__color-dot block-menu__color-dot--default"></span>
                        <span class="block-menu__color-label">Default</span>
                      </button>
                      <button
                        v-for="option in textColorOptions"
                        :key="option.value"
                        class="block-menu__color-btn"
                        type="button"
                        :aria-label="(isHorizontalRule ? 'Rule color ' : 'Text color ') + option.name"
                        @click="applyTextColorOption(option.value)"
                      >
                        <span class="block-menu__color-dot" :style="{ backgroundColor: option.value }"></span>
                        <span class="block-menu__color-label">{{ option.name }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </template>
              <template v-else-if="panelState === 'highlight'">
                <div class="block-menu__panel-header">
                  <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
                  <span class="block-menu__panel-title">Highlight</span>
                </div>
                <div class="block-menu__panel-scroll">
                  <div class="block-menu__group block-menu__submenu-section">
                    <div class="block-menu__group-title">Highlight</div>
                    <div class="block-menu__color-list">
                      <button class="block-menu__color-btn" type="button" aria-label="No highlight" @click="clearHighlight">
                        <span class="block-menu__color-dot block-menu__color-dot--reset"></span>
                        <span class="block-menu__color-label">None</span>
                      </button>
                      <button
                        v-for="option in highlightOptions"
                        :key="option.value"
                        class="block-menu__color-btn"
                        type="button"
                        :aria-label="'Highlight color ' + option.name"
                        @click="setHighlightColor(option.value)"
                      >
                        <span class="block-menu__color-dot" :style="{ backgroundColor: option.value }"></span>
                        <span class="block-menu__color-label">{{ option.name }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </template>
              <template v-else-if="panelState === 'pageLinkStyle'">
                <div class="block-menu__panel-header">
                  <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
                  <span class="block-menu__panel-title">Page link style</span>
                </div>
                <div class="block-menu__panel-scroll">
                  <button class="block-menu__item" type="button" @click="setPageLinkStyle('card')">
                    <span class="block-menu__icon">Cd</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Card</span>
                      <span class="block-menu__hint">Full card layout</span>
                    </span>
                    <span v-if="currentPageLinkStyle === 'card'" class="block-menu__chevron">✓</span>
                  </button>
                  <button class="block-menu__item" type="button" @click="setPageLinkStyle('small')">
                    <span class="block-menu__icon">Sm</span>
                    <span class="block-menu__text">
                      <span class="block-menu__title">Small</span>
                      <span class="block-menu__hint">Icon + title only</span>
                    </span>
                    <span v-if="currentPageLinkStyle === 'small'" class="block-menu__chevron">✓</span>
                  </button>
                </div>
              </template>
              <template v-else-if="panelState === 'pageLinkAttributes'">
                <div class="block-menu__panel-header">
                  <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
                  <span class="block-menu__panel-title">Page link attributes</span>
                </div>
                <div class="block-menu__panel-scroll">
                  <div v-if="!currentPageLinkTargetId" class="block-menu__notice">Link a page to show attributes.</div>
                  <div v-else-if="currentPageLinkAttributeError" class="block-menu__notice">{{ currentPageLinkAttributeError }}</div>
                  <div v-else-if="currentPageLinkAttributeLoading" class="block-menu__notice">Loading attributes...</div>
                  <div class="block-menu__group block-menu__submenu-section">
                    <div class="block-menu__group-title">Display</div>
                    <button class="block-menu__item" type="button" @click="setPageLinkAttribute('')">
                      <span class="block-menu__icon">--</span>
                      <span class="block-menu__text">
                        <span class="block-menu__title">None</span>
                        <span class="block-menu__hint">Show Page link label</span>
                      </span>
                      <span v-if="!currentPageLinkAttributeParts.kind" class="block-menu__chevron">✓</span>
                    </button>
                  </div>
                  <div class="block-menu__group block-menu__submenu-section">
                    <div class="block-menu__group-title">Page</div>
                    <button
                      v-for="option in pageLinkBuiltinAttributes"
                      :key="option.id"
                      class="block-menu__item"
                      type="button"
                      @click="setPageLinkAttribute(option.id)"
                    >
                      <span class="block-menu__icon">Pg</span>
                      <span class="block-menu__text">
                        <span class="block-menu__title">{{ option.label }}</span>
                      </span>
                      <span v-if="currentPageLinkAttribute === option.id" class="block-menu__chevron">✓</span>
                    </button>
                  </div>
                  <div v-if="currentPageLinkDatabasePageId" class="block-menu__group block-menu__submenu-section">
                    <div class="block-menu__group-title">Database</div>
                    <button
                      v-for="field in currentPageLinkAttributeFields"
                      :key="field.id"
                      class="block-menu__item"
                      type="button"
                      @click="setPageLinkAttribute(`field:${field.id}`)"
                    >
                      <span class="block-menu__icon">Db</span>
                      <span class="block-menu__text">
                        <span class="block-menu__title">{{ field.name || 'Field' }}</span>
                      </span>
                      <span v-if="currentPageLinkAttribute === `field:${field.id}`" class="block-menu__chevron">✓</span>
                    </button>
                    <div v-if="!currentPageLinkAttributeFields.length && !currentPageLinkAttributeLoading" class="block-menu__notice">
                      No database attributes.
                    </div>
                  </div>
                </div>
              </template>
              <template v-else-if="panelState === 'divider'">
                <div class="block-menu__panel-header">
                  <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
                  <span class="block-menu__panel-title">Divider height</span>
                </div>
                <div class="block-menu__panel-scroll">
                  <div class="block-menu__group block-menu__submenu-section">
                    <div class="block-menu__group-title">Height</div>
                    <div class="block-menu__color-list">
                      <button
                        v-for="option in dividerSizeOptions"
                        :key="option.value"
                        class="block-menu__color-btn"
                        type="button"
                        :aria-label="'Divider height ' + option.name"
                        @click="setHorizontalRuleSize(option.value)"
                      >
                        <span class="block-menu__color-dot block-menu__color-dot--divider" :data-size="option.value"></span>
                        <span class="block-menu__color-label">
                          {{ option.name }}
                          <span v-if="currentHorizontalRuleSize === option.value">(current)</span>
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </template>
              <template v-else-if="panelState === 'dividerAlign'">
                <div class="block-menu__panel-header">
                  <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
                  <span class="block-menu__panel-title">Divider alignment</span>
                </div>
                <div class="block-menu__panel-scroll">
                  <div class="block-menu__group block-menu__submenu-section">
                    <div class="block-menu__group-title">Alignment</div>
                    <div class="block-menu__color-list">
                      <button
                        v-for="option in dividerAlignOptions"
                        :key="option.value"
                        class="block-menu__color-btn"
                        type="button"
                        :aria-label="'Divider alignment ' + option.name"
                        @click="setHorizontalRuleAlign(option.value)"
                      >
                        <span class="block-menu__color-dot block-menu__color-dot--divider-align" :data-align="option.value"></span>
                        <span class="block-menu__color-label">
                          {{ option.name }}
                          <span v-if="currentHorizontalRuleAlign === option.value">(current)</span>
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </template>
              <template v-else-if="panelState === 'code'">
                <div class="block-menu__panel-header">
                  <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
                  <span class="block-menu__panel-title">Code block</span>
                </div>
                <div class="block-menu__panel-scroll">
                  <div class="block-menu__group block-menu__submenu-section">
                    <div class="block-menu__group-title">Language</div>
                    <div class="block-menu__color-list">
                      <button
                        v-for="lang in codeBlockLanguages"
                        :key="lang || 'plain'"
                        class="block-menu__color-btn"
                        type="button"
                        :aria-label="'Language ' + (lang || 'Plain text')"
                        @click="setCodeBlockLanguage(lang)"
                      >
                        <span class="block-menu__color-dot"></span>
                        <span class="block-menu__color-label">
                          {{ lang || 'Plain text' }}
                          <span v-if="currentCodeLanguage === (lang || '')">(current)</span>
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </transition>
        </div>
      </div>
    </Teleport>
    <Teleport v-if="shouldShowImageBubble() && hoveredImage?.element" :to="hoveredImage.element">
      <div class="bubble-menu image-bubble-menu" :style="blockBubbleStyle">
        <button class="bubble-menu__btn" type="button" @mousedown.prevent @click.prevent="replaceHoveredImageSrc">
          Replace image
        </button>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="activeTableEl && tableCellBubblePos.width > 0"
        class="bubble-menu table-cell-bubble-menu"
        :class="{ 'table-cell-bubble-menu--clamped': tableCellBubblePos.clamped }"
        :style="{
          position: 'fixed',
          top: `${tableCellBubblePos.top}px`,
          left: `${tableCellBubblePos.left}px`,
          width: `${tableCellBubblePos.width}px`,
          transform: tableCellBubblePos.clamped ? 'translateY(0)' : 'translateY(-100%)',
          zIndex: 2100,
        }"
      >
        <div class="bubble-menu__group">
          <button class="bubble-menu__btn" type="button" title="Add column left" @mousedown.prevent @click.prevent="editor.chain().focus().addColumnBefore().run()">
            <i class="bi bi-arrow-bar-left" aria-hidden="true"></i>
          </button>
          <button class="bubble-menu__btn" type="button" title="Add column right" @mousedown.prevent @click.prevent="editor.chain().focus().addColumnAfter().run()">
            <i class="bi bi-arrow-bar-right" aria-hidden="true"></i>
          </button>
          <button class="bubble-menu__btn" type="button" title="Add row above" @mousedown.prevent @click.prevent="editor.chain().focus().addRowBefore().run()">
            <i class="bi bi-arrow-bar-up" aria-hidden="true"></i>
          </button>
          <button class="bubble-menu__btn" type="button" title="Add row below" @mousedown.prevent @click.prevent="editor.chain().focus().addRowAfter().run()">
            <i class="bi bi-arrow-bar-down" aria-hidden="true"></i>
          </button>
        </div>
        <div class="bubble-menu__group">
          <button class="bubble-menu__btn bubble-menu__btn--danger" type="button" title="Delete column" @mousedown.prevent @click.prevent="editor.chain().focus().deleteColumn().run()">
            Del col
          </button>
          <button class="bubble-menu__btn bubble-menu__btn--danger" type="button" title="Delete row" @mousedown.prevent @click.prevent="editor.chain().focus().deleteRow().run()">
            Del row
          </button>
        </div>
        <div class="bubble-menu__group table-ribbon__spacer">
          <button
            class="bubble-menu__btn"
            :class="{ active: tableIsFullWidth }"
            type="button"
            :title="tableIsFullWidth ? 'Collapse to page width' : 'Expand to full width'"
            @mousedown.prevent
            @click.prevent="toggleTableFullWidth"
          >
            <i :class="tableIsFullWidth ? 'bi bi-fullscreen-exit' : 'bi bi-fullscreen'" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </Teleport>
    <Teleport to="body">
      <button
        v-if="activeTableEl"
        class="table-add-row-btn"
        type="button"
        title="Add row"
        :style="{
          position: 'fixed',
          top: `${tableAddRowPos.top}px`,
          left: `${tableAddRowPos.left}px`,
          transform: 'translateX(-50%)',
          zIndex: 2100,
        }"
        @mousedown.prevent
        @click.prevent="editor.chain().focus().addRowAfter().run()"
      >
        <i class="bi bi-plus" aria-hidden="true"></i>
      </button>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="hoveredSuggestionIndex !== null && activeSuggestions.length"
        class="ai-suggestion-widget"
        :style="{ top: `${suggestionWidgetPos.top}px`, left: `${suggestionWidgetPos.left}px` }"
        @mouseenter="hoveredSuggestionIndex = hoveredSuggestionIndex"
        @mouseleave="hoveredSuggestionIndex = null"
      >
        <button
          class="ai-suggestion-widget__btn ai-suggestion-widget__btn--revert"
          type="button"
          @click="revertSuggestion(hoveredSuggestionIndex)"
        >↩ Revert</button>
        <button
          class="ai-suggestion-widget__btn ai-suggestion-widget__btn--accept"
          type="button"
          @click="acceptSuggestion(hoveredSuggestionIndex)"
        >✓ Keep</button>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="aiPromptVisible"
        class="ai-prompt-overlay"
        :style="{ top: `${aiPromptPos.top}px`, left: `${aiPromptPos.left}px` }"
        @keydown.escape.stop="closeAiPrompt"
      >
        <form class="ai-prompt-form" @submit.prevent="submitAiPrompt">
          <span class="ai-prompt-icon" aria-hidden="true">✦</span>
          <input
            ref="aiPromptInputRef"
            v-model="aiPromptText"
            class="ai-prompt-input"
            type="text"
            placeholder="Ask AI to write something…"
            autocomplete="off"
          />
          <button class="ai-prompt-submit" type="submit" :disabled="!aiPromptText.trim()">Generate</button>
          <button class="ai-prompt-cancel" type="button" @click="closeAiPrompt">✕</button>
        </form>
      </div>
    </Teleport>
  </div>
</template>
