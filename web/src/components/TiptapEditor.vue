<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { Extension, textInputRule } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, NodeSelection, Selection } from 'prosemirror-state';
import { Mapping } from 'prosemirror-transform';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Slice } from 'prosemirror-model';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { yDocToProsemirrorJSON, ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap';
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
import { editorDocToTiptap, renderDatabaseAsMarkdownTable } from '../utils/editorDoc';
import { nodeToInlineMarkdown, markdownToInlineFragment, markdownToBlockNode } from '../utils/aiMarkdown';
import { api } from '../api/client';
import { useWorkspaceStore } from '../stores/workspace';
import { useBlockSummarizer } from '../composables/useBlockSummarizer';
import { blockSummaryCache } from '../services/blockSummaryCache';
import { AiSuggestionExtension, aiSuggestionKey } from '../tiptap/aiSuggestions';
import { BLOCK_ID_TYPES, blockHighlightKey, createBlockIdExtension, createBlockPositionExtension, isEmptyParagraphNode, parseBlockIdCounter } from '../tiptap/blockIds';
import { createBulletDepthPlugin } from '../tiptap/bulletDepth';
import { ColumnCleanupExtension, ColumnInputGuardExtension, columnCleanupKey } from '../tiptap/columnGuards';
import { ORIGIN_META_KEY, SYNCED_FROM_ATTR, findColumnAncestor, isEmptyParagraph } from '../tiptap/editorShared';
import { createInputSelectionGuardExtension } from '../tiptap/inputSelectionGuard';
import { createColumnsPayload, createDatabaseViewConfig, createToggleHeadingPayload, getColumnOnlyBlock } from '../tiptap/blockPayloads';
import { codeBlockLanguages, dividerAlignOptions, dividerSizeOptions, highlightOptions, textColorOptions } from '../tiptap/editorMenuOptions';
import { INDENT_EXCLUDED_ANCESTORS, applyCodeBlockIndentation, collectIndentTargets, findIndentTarget, hasAncestorOfType } from '../tiptap/indentation';
import { SYNCED_PAYLOAD_FROM, createSyncedMirrorExtension, createSyncedNodeFromSource, findBlockById, resolveWorkspaceSyncedKey, selectionSyncedReferenceId, serializeSyncedNode, sourceKey, syncedPayloadContent, withSyncedOrigin, workspaceSyncedKey } from '../tiptap/syncedBlocks';
import { AI_SERIALIZABLE_TYPES, SMALL_PAGE_THRESHOLD, detectTargetSection } from '../utils/aiContext';
import { blockDebugEnabled, describeUndoOrigin, describeUndoStacks, logBlockDebug, logDuplicateBlockDetails, logSetup, logUndoDebug, summarizeBlockStats, undoDebugEnabled } from '../utils/editorDebug';
import { normalizeLinkHref, parseBlockUrl } from '../utils/editorLinks';
import { markdownToHtml, shouldHandleMarkdownPaste } from '../utils/markdownPaste';
import { positionBubbleMenu, rectFromClientRects } from '../utils/menuPosition';
import { colorFromId } from '../utils/presenceColor';
import { buildPageLinkFieldsFromCollab, buildPageLinkRowsFromCollab, getPageLinkFieldSource, isPageLinkCollabEmpty, pageLinkBuiltinAttributes, parsePageLinkAttribute, resolvePageLinkRow } from '../utils/pageLinkAttributes';

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

const syncedWorkspaceDocName = computed(() => {
  const workspaceId = activeWorkspaceId.value;
  if (!workspaceId) return null;
  return `ws:${workspaceId}:synced-blocks`;
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
    const provider = new HocuspocusProvider({
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



// Track last known cursor position so serializeBlocksForAi can detect the
// target section even after the editor loses focus (e.g. user clicked AI panel)
const lastKnownCursorPos = ref(null);

const serializeBlocksForAi = async () => {
  if (!editor.value) return [];
  const doc = editor.value.state.doc;
  const blocks = [];

  let serializableCount = 0;
  doc.forEach((node) => { if (AI_SERIALIZABLE_TYPES.has(node.type.name)) serializableCount++; });

  const cursorPos = lastKnownCursorPos.value;
  // For small pages or when no cursor position is known, send everything as full text
  const targetIndices =
    cursorPos != null && serializableCount > SMALL_PAGE_THRESHOLD
      ? detectTargetSection(cursorPos, doc)
      : null;

  // Pre-fetch database data for any inline databaseView nodes in parallel
  const dbViewNodes = [];
  doc.forEach((node, _offset, index) => {
    if (node.type.name === 'databaseView' && node.attrs.pageId) {
      dbViewNodes.push({ pageId: node.attrs.pageId, title: node.attrs.title, index });
    }
  });
  const dbData = {};
  if (dbViewNodes.length) {
    const user = workspace.activeUser;
    await Promise.all(dbViewNodes.map(async ({ pageId }) => {
      try {
        dbData[pageId] = await api.getDatabase(pageId, { userId: user?.id, userName: user?.name });
      } catch {
        // falls back to stub below
      }
    }));
  }

  doc.forEach((node, _offset, index) => {
    if (node.type.name === 'databaseView') {
      const db = dbData[node.attrs.pageId];
      const text = db
        ? renderDatabaseAsMarkdownTable(db, node.attrs.title)
        : `[Database: ${node.attrs.title || 'Untitled'}]`;
      blocks.push({ index, type: 'databaseView', text });
      return;
    }

    if (!AI_SERIALIZABLE_TYPES.has(node.type.name)) return;
    const plainText = node.textContent;
    if (!plainText) return; // skip empty blocks

    if (targetIndices === null || targetIndices.has(index)) {
      // Full fidelity: inline markdown preserves bold, italic, code, links, etc.
      const text = nodeToInlineMarkdown(node);
      blocks.push({ index, type: node.type.name, text: text || plainText });
    } else {
      // Use cached LLM summary; fall back to first 80 chars if not yet cached
      const hash = blockSummaryCache.hash(plainText);
      const entry = blockSummaryCache.get(hash);
      const summary = entry
        ? entry.summary
        : `${plainText.slice(0, 80)}${plainText.length > 80 ? '…' : ''}`;
      blocks.push({ index, type: node.type.name, text: `[CONTEXT: ${summary}]` });
    }
  });

  return blocks;
};

const applyAiSuggestions = (changes) => {
  if (!editor.value || !changes?.length) return;
  const { state } = editor.value.view;

  // Collect top-level block positions before any changes
  const blockPositions = [];
  state.doc.forEach((node, offset) => {
    blockPositions.push({ node, offset });
  });

  // Apply bottom-up (highest index first) to avoid position drift
  const sorted = [...changes].sort((a, b) => b.index - a.index);

  // Build a single chained transaction
  let tr = state.tr;
  const suggestions = [];

  for (const change of sorted) {
    const block = blockPositions[change.index];
    if (!block) continue;
    const { node, offset } = block;

    // Only apply to serializable block types
    if (!AI_SERIALIZABLE_TYPES.has(node.type.name)) continue;

    const from = offset;
    const to   = offset + node.nodeSize;
    const textFrom = offset + 1;        // inside opening token
    const textTo   = offset + node.nodeSize - 1; // before closing token

    // Store original node for revert — the full ProseMirror Node with all marks preserved
    suggestions.push({
      nodeIndex: change.index,
      from,
      to,
      originalNode: node,
      newText: change.newText,
    });

    // For structured block types (lists, callouts), replace the entire node
    const AI_STRUCTURED_TYPES = new Set(['bulletList', 'orderedList', 'taskList', 'callout']);
    if (AI_STRUCTURED_TYPES.has(node.type.name)) {
      const newNode = markdownToBlockNode(change.newText, state.schema, node.type.name);
      if (newNode) {
        tr = tr.replaceWith(from, to, newNode);
        continue;
      }
      // Fall through to inline replacement if block parse fails
    }

    // Parse markdown from AI back into rich inline content and replace
    const fragment = markdownToInlineFragment(change.newText, state.schema);
    tr = tr.replace(textFrom, textTo, new Slice(fragment, 0, 0));
  }

  // Dispatch the content changes
  tr.setMeta('addToHistory', true);
  editor.value.view.dispatch(tr);

  // In a separate transaction, set the suggestion decorations
  // (positions will have shifted; recalculate from the updated doc)
  const newState = editor.value.view.state;
  const decorTr = newState.tr;
  const updatedSuggestions = [];

  const changedIndices = new Set(suggestions.map((s) => s.nodeIndex));
  newState.doc.forEach((node, offset, index) => {
    if (!changedIndices.has(index)) return;
    const original = suggestions.find((s) => s.nodeIndex === index);
    if (!original) return;
    updatedSuggestions.push({
      nodeIndex: index,
      from: offset,
      to: offset + node.nodeSize,
      originalNode: original.originalNode,
      newText: original.newText,
    });
  });

  decorTr.setMeta(aiSuggestionKey, { type: 'set', suggestions: updatedSuggestions });
  decorTr.setMeta('addToHistory', false);
  editor.value.view.dispatch(decorTr);
};

const revertSuggestion = (nodeIndex) => {
  if (!editor.value) return;
  const pluginState = aiSuggestionKey.getState(editor.value.state);
  const suggestion = pluginState?.suggestions?.find((s) => s.nodeIndex === nodeIndex);
  if (!suggestion) return;

  const { state } = editor.value.view;
  const currentNode = state.doc.nodeAt(suggestion.from);
  if (!currentNode) return;

  // Replace the entire block node with the original (all marks preserved)
  const tr = state.tr.replaceWith(
    suggestion.from,
    suggestion.from + currentNode.nodeSize,
    suggestion.originalNode,
  );
  tr.setMeta('addToHistory', true);
  tr.setMeta(aiSuggestionKey, { type: 'remove', nodeIndex });
  editor.value.view.dispatch(tr);
};

const acceptSuggestion = (nodeIndex) => {
  if (!editor.value) return;
  const tr = editor.value.state.tr;
  tr.setMeta(aiSuggestionKey, { type: 'remove', nodeIndex });
  tr.setMeta('addToHistory', false);
  editor.value.view.dispatch(tr);
};

const revertAllSuggestions = () => {
  if (!editor.value) return;
  const pluginState = aiSuggestionKey.getState(editor.value.state);
  const suggestions = pluginState?.suggestions ?? [];
  if (!suggestions.length) return;

  // Revert bottom-up to preserve positions
  const sorted = [...suggestions].sort((a, b) => b.nodeIndex - a.nodeIndex);
  const { state } = editor.value.view;
  let tr = state.tr;

  for (const s of sorted) {
    const currentNode = state.doc.nodeAt(s.from);
    if (!currentNode) continue;
    tr = tr.replaceWith(s.from, s.from + currentNode.nodeSize, s.originalNode);
  }

  tr.setMeta('addToHistory', true);
  tr.setMeta(aiSuggestionKey, { type: 'clear' });
  editor.value.view.dispatch(tr);
};

const acceptAllSuggestions = () => {
  if (!editor.value) return;
  const tr = editor.value.state.tr;
  tr.setMeta(aiSuggestionKey, { type: 'clear' });
  tr.setMeta('addToHistory', false);
  editor.value.view.dispatch(tr);
};

const activeSuggestions = computed(() => {
  if (!editor.value) return [];
  return aiSuggestionKey.getState(editor.value.state)?.suggestions ?? [];
});

// Hover widget for per-block accept/revert
const hoveredSuggestionIndex = ref(null);
const suggestionWidgetPos = ref({ top: 0, left: 0 });

let _suggestionHideTimer = null;

const handleSuggestionMousemove = (e) => {
  // If mouse is over the widget itself, keep it visible
  if (e.target?.closest?.('.ai-suggestion-widget')) {
    clearTimeout(_suggestionHideTimer);
    _suggestionHideTimer = null;
    return;
  }

  const el = e.target?.closest?.('.ai-suggestion-block');
  if (!el) {
    // Delay hide so the mouse can travel from block edge to widget
    if (_suggestionHideTimer == null) {
      _suggestionHideTimer = setTimeout(() => {
        hoveredSuggestionIndex.value = null;
        _suggestionHideTimer = null;
      }, 300);
    }
    return;
  }

  clearTimeout(_suggestionHideTimer);
  _suggestionHideTimer = null;

  const idx = Number(el.dataset.suggestionIndex);
  if (isNaN(idx)) return;
  hoveredSuggestionIndex.value = idx;
  const rect = el.getBoundingClientRect();
  suggestionWidgetPos.value = {
    top:  rect.top,
    left: rect.right + 8,
  };
};
// ─────────────────────────────────────────────────────────────────────────────

// ── AI integration ──────────────────────────────────────────────────────────
const aiPromptVisible = ref(false);
const aiPromptPos = ref({ top: 0, left: 0 });
const aiPromptRange = ref(null);
const aiPromptText = ref('');
const aiPromptInputRef = ref(null);
const aiStreaming = ref(false);

const showAiPrompt = (range, editorInstance) => {
  const { view } = editorInstance;
  const coords = view.coordsAtPos(range.from);
  // Position below the cursor line
  aiPromptPos.value = { top: coords.bottom + 6, left: Math.max(coords.left, 16) };
  aiPromptRange.value = range;
  aiPromptText.value = '';
  aiPromptVisible.value = true;
};

const closeAiPrompt = () => {
  aiPromptVisible.value = false;
  aiPromptRange.value = null;
  aiPromptText.value = '';
};

const runAiInsertion = async (prompt, range) => {
  if (!editor.value) return;
  closeAiPrompt();
  editor.value.chain().focus().deleteRange(range).run();
  aiStreaming.value = true;
  try {
    for await (const chunk of api.streamAiGenerate({ prompt, mode: 'write' })) {
      editor.value?.commands.insertContent(chunk);
    }
  } catch (err) {
    console.error('[AI] generation failed:', err);
  } finally {
    aiStreaming.value = false;
  }
};

const submitAiPrompt = () => {
  const val = aiPromptText.value.trim();
  if (!val || !aiPromptRange.value) return;
  runAiInsertion(val, aiPromptRange.value);
};

const runAiBubbleAction = async (mode) => {
  if (!editor.value || aiStreaming.value) return;
  const { from, to } = editor.value.state.selection;
  if (from === to) return;
  const selectedText = editor.value.state.doc.textBetween(from, to, '\n');
  if (!selectedText.trim()) return;
  editor.value.chain().focus().deleteRange({ from, to }).run();
  aiStreaming.value = true;
  try {
    for await (const chunk of api.streamAiGenerate({ prompt: selectedText, mode })) {
      editor.value?.commands.insertContent(chunk);
    }
  } catch (err) {
    console.error('[AI] bubble action failed:', err);
  } finally {
    aiStreaming.value = false;
  }
};

watch(aiPromptVisible, async (val) => {
  if (val) {
    await nextTick();
    aiPromptInputRef.value?.focus();
  }
});
// ─────────────────────────────────────────────────────────────────────────────

const slashItems = [
  { title: 'Text', icon: 'Tx', hint: 'Paragraph', search: ['text', 'paragraph', 'p'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run() },
  { title: 'Heading 1', icon: 'H1', hint: 'Big heading', search: ['h1', 'heading'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run() },
  { title: 'Heading 2', icon: 'H2', hint: 'Section heading', search: ['h2', 'heading'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run() },
  { title: 'Heading 3', icon: 'H3', hint: 'Sub heading', search: ['h3', 'heading'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run() },
  { title: 'Toggle heading 1', icon: 'T1', hint: 'Collapsible heading', search: ['toggle', 'heading', 'collapse'], command: ({ editor, range }) => insertToggleHeading(editor, range, 1) },
  { title: 'Toggle heading 2', icon: 'T2', hint: 'Collapsible heading', search: ['toggle', 'heading', 'collapse'], command: ({ editor, range }) => insertToggleHeading(editor, range, 2) },
  { title: 'Toggle heading 3', icon: 'T3', hint: 'Collapsible heading', search: ['toggle', 'heading', 'collapse'], command: ({ editor, range }) => insertToggleHeading(editor, range, 3) },
  { title: 'Code block', icon: '</>', hint: 'Monospace block', search: ['code', 'snippet'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCodeBlock().run() },
  { title: 'To-do list', icon: '[ ]', hint: 'Task list', search: ['todo', 'task', 'checkbox'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run() },
  { title: 'Bulleted list', icon: '*', hint: 'Bullet points', search: ['bullet', 'ul', 'list'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
  { title: 'Numbered list', icon: '1.', hint: 'Ordered list', search: ['number', 'ol', 'list'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
  { title: 'Divider', icon: '---', hint: 'Horizontal rule', search: ['divider', 'hr', 'rule'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
  {
    title: 'Table of contents',
    icon: 'toc',
    hint: 'Outline headings on this page',
    search: ['toc', 'table of contents', 'outline', 'contents'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'tableOfContents' }).run();
    },
  },
  {
    title: 'Callout',
    icon: '💡',
    hint: 'Highlighted note',
    search: ['callout', 'note', 'info', 'hint'],
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'callout', attrs: { icon: '💡' }, content: [{ type: 'paragraph', content: [] }] })
        .run();
    },
  },
  {
    title: '2 columns',
    icon: '2c',
    hint: 'Two column layout',
    search: ['columns', 'two', 'layout', '2 columns'],
    command: ({ editor, range }) => insertColumns(editor, range, 2),
  },
  {
    title: '3 columns',
    icon: '3c',
    hint: 'Three column layout',
    search: ['columns', 'three', 'layout', '3 columns'],
    command: ({ editor, range }) => insertColumns(editor, range, 3),
  },
  {
    title: '4 columns',
    icon: '4c',
    hint: 'Four column layout',
    search: ['columns', 'four', 'layout', '4 columns'],
    command: ({ editor, range }) => insertColumns(editor, range, 4),
  },
  {
    title: 'Table',
    icon: 'tbl',
    hint: 'Insert table',
    search: ['table', 'grid', 'rows', 'columns'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: 'Database view',
    icon: 'db',
    hint: 'Embed a table view',
    search: ['database', 'table', 'view', 'db'],
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'databaseView',
          attrs: { pageId: '', title: '', icon: '', view: createDatabaseViewConfig() },
        })
        .run();
    },
  },
  {
    title: 'Form',
    icon: 'fm',
    hint: 'Embed a form',
    search: ['form', 'database form', 'embed form'],
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'databaseForm',
          attrs: { formId: '', name: '', databasePageId: '' },
        })
        .run();
    },
  },
  {
    title: 'Diagram',
    icon: '⬡',
    hint: 'draw.io diagram',
    search: ['diagram', 'drawio', 'draw', 'chart', 'flow', 'flowchart'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'drawio', attrs: { xml: '', svg: '' } }).run();
    },
  },
  {
    title: '3D Splat',
    icon: '◎',
    hint: '3D Gaussian splat viewer',
    search: ['3d', 'splat', 'gaussian', 'spz', '3dgs', 'point cloud'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: 'gaussianSplat', attrs: { src: '' } }).run();
    },
  },
  {
    title: 'Link',
    icon: 'lnk',
    hint: 'Add a link',
    search: ['link', 'url'],
    command: ({ editor, range }) => {
      const url = window.prompt('Enter a URL');
      if (url === null) return;
      const href = normalizeLinkHref(url);
      if (!href) return;
      const label = url.trim();
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setLink({ href, target: '_blank' })
        .insertContent(label)
        .run();
    },
  },
  {
    title: 'Image',
    icon: 'img',
    hint: 'Upload an image',
    search: ['image', 'img', 'picture', 'photo'],
    command: ({ editor, range }) => {
      insertImageFromUpload(editor, range);
    },
  },
  {
    title: 'Page link',
    icon: 'pg',
    hint: 'Link another page',
    search: ['page', 'link', 'subpage'],
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'pageLink', attrs: { pageId: '', title: '', icon: '' } })
        .run();
    },
  },
  {
    title: 'Add page',
    icon: '+pg',
    hint: 'Create a sub-page',
    search: ['page', 'new', 'sub', 'subpage', 'child', 'add page', 'create page'],
    command: ({ editor, range }) => {
      // Delete the slash trigger immediately so the menu closes cleanly
      editor.chain().focus().deleteRange(range).run();
      // Create the child page async, then insert the link
      (async () => {
        const parentPage = props.pageId ? getResolvedPage(props.pageId) : workspace.currentPage;
        if (!parentPage) return;
        const newPage = await workspace.createChildPageRecord(parentPage);
        if (!newPage) return;
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'pageLink',
            attrs: { pageId: newPage.id, title: newPage.title || 'Untitled page', icon: newPage.icon || '' },
          })
          .run();
      })();
    },
  },
  {
    title: 'AI Writer',
    icon: '✦',
    hint: 'Write with AI',
    search: ['ai', 'write', 'generate', 'claude', 'gpt', 'assistant'],
    command: ({ editor, range }) => {
      showAiPrompt(range, editor);
    },
  },
];



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



















const fetchBlockFromPage = async (pageId, blockId) => {
  if (!pageId || !blockId) return null;
  if (!workspace.hasApi) return null;
  if (!editor.value?.schema) return null;
  try {
    const user = workspace.activeUser || {};
    const page = await api.getPage(pageId, { userId: user.id, userName: user.name });
    const docJson = editorDocToTiptap(page?.content || page);
    const pmDoc = editor.value.schema.nodeFromJSON(docJson);
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
let listHandleHoverTimer = null;
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
const collabProvider = ref(null);
const currentDocName = ref(props.collab?.docName || null);
const initialContentSeeded = ref(false);
const setupSeededAfterSync = ref(false);
const initialAutoBlockId = ref(null);
const unsyncedWatcher = ref(null);
const syncedLockNoticeAt = ref(0);
const savingShownAt = ref(0);
const savedDelayTimer = ref(null);
const isCollabEnabled = computed(
  () => !!props.collab && !!props.collab.docName && !!props.collab.token && !!props.collab.url
);
const collabReady = computed(() => isCollabEnabled.value && !!collabProvider.value);
const cursorUser = computed(() => ({
  name: workspace.activeUser?.name || 'Guest',
  color: colorFromId(workspace.activeUser?.id || 'guest'),
}));

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

bindSyncedLocksMap(collabDoc.value);

const createNodeFromSyncedPayload = (payload) => {
  if (!editor.value?.schema || !payload) return null;
  try {
    return editor.value.schema.nodeFromJSON(syncedPayloadContent(payload));
  } catch {
    return null;
  }
};

const applyExternalSyncedUpdates = () => {
  const map = syncedWorkspaceMap.value;
  if (!map || !editor.value) return;
  const { state, view } = editor.value;
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
    if (!editor.value || editor.value.isDestroyed) return;
    const { state, view } = editor.value;
    view.dispatch(state.tr.setMeta('synced-ref-refresh', true));
  });
};

const updateSyncedWorkspaceSourcesFromDoc = () => {
  const map = syncedWorkspaceMap.value;
  const doc = syncedWorkspaceDoc.value;
  if (!map || !doc || !editor.value || !props.pageId) return;
  const localSourceKeys = new Set();
  editor.value.state.doc.descendants((node) => {
    if (!node.isBlock) return;
    if (node.attrs?.[SYNCED_FROM_ATTR]) return;
    const blockId = node.attrs?.id;
    if (!blockId) return;
    const key = workspaceSyncedKey(props.pageId, blockId);
    if (key) localSourceKeys.add(key);
  });
  const updates = [];
  editor.value.state.doc.descendants((node) => {
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
  if (!refsMap || !doc || !editor.value || !props.pageId) return;
  const pageId = props.pageId;
  const counts = new Map();
  editor.value.state.doc.descendants((node) => {
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

const emitStatus = (text, state) => emit('status', { text, state });
const clearSavedDelay = () => {
  if (savedDelayTimer.value) {
    clearTimeout(savedDelayTimer.value);
    savedDelayTimer.value = null;
  }
};
const emitSaving = () => {
  savingShownAt.value = Date.now();
  clearSavedDelay();
  emitStatus('Saving...', 'saving');
};
const emitSavedWithDelay = () => {
  const elapsed = savingShownAt.value ? Date.now() - savingShownAt.value : Infinity;
  const delay = Math.max(0, 1000 - elapsed);
  clearSavedDelay();
  savedDelayTimer.value = setTimeout(() => {
    emitStatus('Saved', 'saved');
    savedDelayTimer.value = null;
    savingShownAt.value = 0;
  }, delay);
};

const notifySyncedBlockLocked = () => {
  const now = Date.now();
  if (now - syncedLockNoticeAt.value < 1500) return;
  syncedLockNoticeAt.value = now;
  if (typeof window !== 'undefined') {
    window?.alert?.('This synced reference is read-only. Edit the source block or unlock it to make changes.');
  }
};

const isEmptyTextblockNode = (node) => !!node?.isTextblock && node.content?.size === 0;
const isSingleEmptyParagraphDoc = (doc) =>
  Array.isArray(doc?.content) &&
  doc.content.length === 1 &&
  doc.content[0]?.type === 'paragraph' &&
  (!Array.isArray(doc.content[0]?.content) || doc.content[0].content.length === 0);

const clickPlaceholderBlockId = ref(null);

const isSelectionInsideNode = (selection, pos, node) => {
  if (!selection || pos == null || !node) return false;
  const start = pos;
  const end = pos + node.nodeSize;
  return selection.from >= start && selection.to <= end;
};

const clearClickPlaceholderIfNeeded = (view) => {
  if (!view || !clickPlaceholderBlockId.value) return;
  const { state } = view;
  const match = findBlockById(state.doc, clickPlaceholderBlockId.value);
  if (!match) {
    clickPlaceholderBlockId.value = null;
    return;
  }
  const { node, pos } = match;
  if (!isEmptyTextblockNode(node)) {
    clickPlaceholderBlockId.value = null;
    return;
  }
  if (isSelectionInsideNode(state.selection, pos, node)) {
    return;
  }
  view.dispatch(state.tr.delete(pos, pos + node.nodeSize));
  clickPlaceholderBlockId.value = null;
};

const shouldInsertClickPlaceholder = (view, event) => {
  if (!view || !event || props.readonly) return false;
  const { doc } = view.state;
  if (!doc?.childCount) return false;
  const lastBlock = doc.child(doc.childCount - 1);
  if (isEmptyTextblockNode(lastBlock)) return false;
  const root = view.dom;
  if (!root?.querySelectorAll) return false;
  const blocks = root.querySelectorAll('[data-block-pos]');
  if (!blocks.length) return false;
  const lastRect = blocks[blocks.length - 1].getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  if (event.clientY < rootRect.top || event.clientY > rootRect.bottom) return false;
  return event.clientY > lastRect.bottom + 6;
};

const insertClickPlaceholder = (view) => {
  if (!view || props.readonly) return false;
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return false;
  const insertPos = state.doc.content.size;
  const node = paragraph.create();
  let tr = state.tr.insert(insertPos, node);
  const selectionPos = Math.min(insertPos + 1, tr.doc.content.size);
  tr = tr.setSelection(TextSelection.create(tr.doc, selectionPos));
  view.dispatch(tr);
  const lastBlock = view.state.doc.child(view.state.doc.childCount - 1);
  const id = lastBlock?.attrs?.id;
  clickPlaceholderBlockId.value = typeof id === 'string' && id ? id : null;
  view.focus();
  return true;
};

const captureInitialAutoBlock = (doc) => {
  if (!isCollabEnabled.value) return;
  if (initialAutoBlockId.value) return;
  if (!doc || doc.childCount !== 1) return;
  const only = doc.child(0);
  if (!isEmptyParagraphNode(only)) return;
  const id = only.attrs?.id;
  if (typeof id === 'string' && id) {
    initialAutoBlockId.value = id;
  }
};

const pruneInitialAutoBlock = () => {
  if (!editor.value || !initialAutoBlockId.value) return;
  const { state, view } = editor.value;
  const match = findBlockById(state.doc, initialAutoBlockId.value);
  if (!match) {
    initialAutoBlockId.value = null;
    return;
  }
  const { node, pos } = match;
  if (!isEmptyParagraphNode(node)) {
    initialAutoBlockId.value = null;
    return;
  }
  if (state.doc.childCount <= 1) return;
  view.dispatch(state.tr.delete(pos, pos + node.nodeSize));
  initialAutoBlockId.value = null;
};

// If the collab doc is empty (fresh room), seed it with the latest page content so reloads don't start blank.
const hasTiptapContent = (node) => {
  if (!node) return false;
  if (node.type === 'text') return typeof node.text === 'string' && node.text.trim().length > 0;
  const content = Array.isArray(node.content) ? node.content : [];
  if (content.length > 0) return content.some(hasTiptapContent);
  return node.type && node.type !== 'doc' && node.type !== 'paragraph';
};

const getCollabDocSnapshot = () => {
  if (!collabDoc.value) return null;
  try {
    return yDocToProsemirrorJSON(collabDoc.value, collabField);
  } catch (err) {
    logSetup('collab-snapshot-failed', err?.message || err);
    return null;
  }
};

const getCollabMetaMap = () => {
  if (!collabDoc.value) return null;
  return collabDoc.value.getMap(collabMetaKey);
};

const isCollabInitialized = () => {
  const meta = getCollabMetaMap();
  return meta?.get('initialized') === true;
};

const markCollabInitialized = (source) => {
  const meta = getCollabMetaMap();
  if (!meta) return;
  if (meta.get('initialized') === true) return;
  meta.set('initialized', true);
  logSetup('collab-init', { source });
};

const resolveSeedDoc = () => {
  const seedDoc = props.seedDoc ? editorDocToTiptap(props.seedDoc) : null;
  const hasSeedDoc = hasTiptapContent(seedDoc);
  const propDoc = editorDocToTiptap(props.doc);
  const hasPropDoc = hasTiptapContent(propDoc);
  if (hasSeedDoc) {
    return { doc: seedDoc, source: 'seedDoc', hasSeedDoc, hasPropDoc };
  }
  return { doc: propDoc, source: 'doc', hasSeedDoc, hasPropDoc };
};

const seedCollabDocFromProps = (target = editor.value, options = {}) => {
  const instance = target || editor.value;
  if (!instance) return;
  if (!isCollabEnabled.value) return;
  const force = !!options.force;
  if (initialContentSeeded.value && !force) return;

  const current = instance.getJSON();
  const hasCurrent = hasTiptapContent(current);
  const collabSnapshot = getCollabDocSnapshot();
  const hasRemote = hasTiptapContent(collabSnapshot);
  const seed = resolveSeedDoc();
  const initialDoc = seed.doc;
  const hasIncoming = hasTiptapContent(initialDoc);
  const collabInitialized = isCollabInitialized();
  const allowSeed = seed.source === 'seedDoc' || !collabInitialized;
  const shouldApply = (force || !hasCurrent) && hasIncoming && !hasRemote && allowSeed;

  logSetup('seed', {
    docName: currentDocName.value,
    force,
    initialContentSeeded: initialContentSeeded.value,
    hasCurrent,
    hasIncoming,
    seedSource: seed.source,
    hasSeedDoc: seed.hasSeedDoc,
    hasPropDoc: seed.hasPropDoc,
    hasRemote,
    collabInitialized,
    allowSeed,
    shouldApply,
  });

  if (shouldApply) {
    instance.commands.setContent(initialDoc, false);
    markCollabInitialized(seed.source === 'seedDoc' ? 'seed-doc' : 'seed-props');
  } else if (hasRemote) {
    markCollabInitialized('remote-content');
  }

  if (force || hasCurrent || hasIncoming || hasRemote) {
    initialContentSeeded.value = true;
  }
};











const dedupeBlockIds = (reason) => {
  if (!editor.value || props.readonly) return false;
  const { state, view } = editor.value;
  const isSingleEmptyParagraph =
    isCollabEnabled.value
    && state.doc.childCount === 1
    && isEmptyParagraphNode(state.doc.child(0));

  if (isSingleEmptyParagraph) {
    logBlockDebug('block-id-repair-skip', { reason, empty: true });
    return false;
  }
  const seen = new Set();
  let nextId = 1;
  state.doc.descendants((node) => {
    if (!node.isBlock) return;
    if (!BLOCK_ID_TYPES.includes(node.type.name)) return;
    const num = parseBlockIdCounter(node.attrs?.id);
    if (num !== null && num >= nextId) {
      nextId = num + 1;
    }
  });
  let tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (!node.isBlock) return;
    if (!BLOCK_ID_TYPES.includes(node.type.name)) return;
    const currentId = node.attrs?.id;
    const num = parseBlockIdCounter(currentId);
    const isDuplicate = currentId && seen.has(currentId);
    const needsId = !currentId || num === null || isDuplicate;
    if (currentId && !isDuplicate && num !== null) {
      seen.add(currentId);
      return;
    }
    if (!needsId) return;
    const newId = `block-${nextId}`;
    nextId += 1;
    seen.add(newId);
    tr = tr.setNodeMarkup(pos, node.type, { ...node.attrs, id: newId }, node.marks);
  });
  if (tr.docChanged) {
    view.dispatch(tr);
    logBlockDebug('block-id-repair', { reason, updated: true });
    return true;
  }
  logBlockDebug('block-id-repair', { reason, updated: false });
  return false;
};



const lastBlockSummary = ref(null);

const logBlockSummary = (label, doc) => {
  if (!blockDebugEnabled()) return;
  const summary = summarizeBlockStats(doc);
  const last = lastBlockSummary.value;
  const changed =
    !last
    || summary.blocks !== last.blocks
    || summary.paragraphs !== last.paragraphs
    || summary.duplicateIds.length > 0
    || summary.duplicateParagraphs.length > 0;
  if (changed) {
    logBlockDebug(label, summary);
  }
  lastBlockSummary.value = summary;
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

const refreshSaveStatus = () => {
  if (!isCollabEnabled.value) return;
  if (!collabProvider.value) {
    emitStatus('Offline', 'offline');
    return;
  }
  const status = collabProvider.value.status;
  if (status === 'disconnected') {
    emitStatus('Offline', 'offline');
    return;
  }
  if (status === 'connecting') {
    emitStatus('Connecting...', 'connecting');
    return;
  }
  const unsynced = !!collabProvider.value.hasUnsyncedChanges;
  if (unsynced) {
    emitSaving();
  } else {
    emitSavedWithDelay();
  }
};

const stopUnsyncedWatcher = () => {
  if (unsyncedWatcher.value) {
    cancelAnimationFrame(unsyncedWatcher.value);
    unsyncedWatcher.value = null;
  }
};

const handleUnsyncedChanges = (count) => {
  if (!collabProvider.value || collabProvider.value.status !== 'connected') {
    refreshSaveStatus();
    stopUnsyncedWatcher();
    return;
  }
  if (count > 0) {
    emitSaving();
    startUnsyncedWatcher();
  } else {
    emitSavedWithDelay();
    stopUnsyncedWatcher();
  }
};

const startUnsyncedWatcher = () => {
  stopUnsyncedWatcher();
  const tick = () => {
    if (!collabProvider.value) {
      stopUnsyncedWatcher();
      return;
    }
    refreshSaveStatus();
    if (collabProvider.value.status === 'connected' && collabProvider.value.hasUnsyncedChanges) {
      unsyncedWatcher.value = requestAnimationFrame(tick);
    } else {
      stopUnsyncedWatcher();
    }
  };
  unsyncedWatcher.value = requestAnimationFrame(tick);
};

const handleProviderStatus = ({ status }) => {
  logSetup('status', { status, docName: currentDocName.value });
  if (status === 'connecting') {
    emitStatus('Connecting...', 'connecting');
  } else if (status === 'connected') {
    startUnsyncedWatcher();
  } else if (status === 'disconnected') {
    emitStatus('Offline', 'offline');
    stopUnsyncedWatcher();
    clearSavedDelay();
  }
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

const insertSyncedBlockFromUrl = async (url) => {
  if (!editor.value) return;
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
    sourceNode = findBlockById(editor.value.state.doc, parsed.blockId)?.node || null;
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
  const { state, view } = editor.value;
  const tr = state.tr.replaceSelectionWith(node, false).scrollIntoView();
  view.dispatch(tr);
  scheduleSyncedWorkspaceRefresh();
};

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

const toggleSyncedLock = () => {
  const sourceId = hoveredSyncedSourceId.value;
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

const setHandleLocked = (locked) => {
  handleLocked.value = !!locked;
  if (!editor.value) return;
  const { state, view } = editor.value;
  const tr = state.tr.setMeta('lockDragHandle', locked);
  view.dispatch(tr);
};

const LIST_CONTAINER_TYPES = new Set(['bulletList', 'orderedList']);
const LIST_ITEM_TYPE = 'listItem';

const clearListHandle = () => {
  listHandleState.value = { node: null, pos: -1, element: null };
  listHandlePos.value = { top: 0, left: 0, height: 0 };
  listHandleTriggerHover.value = false;
  listHandleSelfHover.value = false;
  if (listHandleHoverTimer) {
    clearTimeout(listHandleHoverTimer);
    listHandleHoverTimer = null;
  }
};

const setListHandleTriggerHover = (next) => {
  if (listHandleHoverTimer) {
    clearTimeout(listHandleHoverTimer);
    listHandleHoverTimer = null;
  }
  if (next) {
    listHandleTriggerHover.value = true;
    return;
  }
  listHandleHoverTimer = setTimeout(() => {
    listHandleTriggerHover.value = false;
    listHandleHoverTimer = null;
  }, 120);
};

const setListHandleSelfHover = (next) => {
  listHandleSelfHover.value = !!next;
};

const resolveListItemFromPos = (pos) => {
  if (!editor.value?.state || !editor.value?.view) return null;
  if (!Number.isFinite(pos)) return null;
  const { state, view } = editor.value;
  const $pos = state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node?.type?.name === LIST_ITEM_TYPE) {
      const itemPos = $pos.before(depth);
      const element = view.nodeDOM(itemPos);
      if (element instanceof HTMLElement) {
        return { element, node, pos: itemPos };
      }
      return null;
    }
  }
  return null;
};

const resolveListContainerFromPos = (pos) => {
  if (!editor.value?.state || !editor.value?.view) return null;
  if (!Number.isFinite(pos)) return null;
  const { state, view } = editor.value;
  const $pos = state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (LIST_CONTAINER_TYPES.has(node?.type?.name)) {
      const listPos = $pos.before(depth);
      const element = view.nodeDOM(listPos);
      if (element instanceof HTMLElement) {
        return { element, node, pos: listPos };
      }
      return null;
    }
  }
  return null;
};

const resolveListItemFromTarget = (target, clientY) => {
  if (!editor.value?.view) return null;
  const listEl = target?.closest?.('ul, ol');
  if (!(listEl instanceof HTMLElement)) return null;
  const items = Array.from(listEl.querySelectorAll('li')).filter((item) => item instanceof HTMLElement);
  if (!items.length) return null;
  const y = typeof clientY === 'number' ? clientY : null;
  const getDepth = (item) => {
    let depth = 0;
    let node = item.parentElement;
    while (node && node !== listEl) {
      if (node.tagName === 'UL' || node.tagName === 'OL') {
        depth += 1;
      }
      node = node.parentElement;
    }
    return depth;
  };
  const candidates = items
    .map((item) => {
      const rect = item.getBoundingClientRect?.();
      if (!rect) return null;
      return { item, rect, depth: getDepth(item) };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.rect.top !== b.rect.top) return a.rect.top - b.rect.top;
      if (a.depth !== b.depth) return b.depth - a.depth;
      return a.rect.height - b.rect.height;
    });
  if (!candidates.length) return null;
  let chosen = null;
  if (y != null) {
    const inside = candidates.filter((entry) => y >= entry.rect.top && y <= entry.rect.bottom);
    if (inside.length) {
      inside.sort((a, b) => {
        if (a.depth !== b.depth) return b.depth - a.depth;
        return a.rect.height - b.rect.height;
      });
      chosen = inside[0];
    } else {
      const nextIndex = candidates.findIndex((entry) => y < entry.rect.top);
      if (nextIndex === -1) {
        chosen = candidates[candidates.length - 1];
      } else if (nextIndex === 0) {
        chosen = candidates[0];
      } else {
        chosen = candidates[nextIndex - 1];
      }
    }
  }
  if (!chosen) {
    const fallback = target?.closest?.('li');
    if (fallback instanceof HTMLElement) {
      chosen = candidates.find((entry) => entry.item === fallback) || candidates[0];
    } else {
      chosen = candidates[0];
    }
  }
  if (!chosen?.item) return null;
  let pos = null;
  try {
    pos = editor.value.view.posAtDOM(chosen.item, 0);
  } catch {
    pos = null;
  }
  if (!Number.isFinite(pos)) return null;
  return resolveListItemFromPos(pos);
};

const resolveOutermostListContainerFromPos = (pos) => {
  if (!editor.value?.state || !editor.value?.view) return null;
  if (!Number.isFinite(pos)) return null;
  const { state, view } = editor.value;
  const $pos = state.doc.resolve(pos);
  let target = null;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (!LIST_CONTAINER_TYPES.has(node?.type?.name)) continue;
    const listPos = $pos.before(depth);
    const element = view.nodeDOM(listPos);
    if (element instanceof HTMLElement) {
      target = { element, node, pos: listPos };
    }
  }
  return target;
};

const updateListHandleFromHit = (hit, wrapperRect) => {
  if (!hit?.node || hit.node.type?.name !== LIST_ITEM_TYPE) {
    clearListHandle();
    return;
  }
  const listHit = resolveListContainerFromPos(hit.pos);
  if (!listHit?.element) {
    clearListHandle();
    return;
  }
  const rect = listHit.element.getBoundingClientRect?.();
  if (!rect) {
    clearListHandle();
    return;
  }
  const topOffset = wrapperRect ? rect.top - wrapperRect.top : rect.top;
  const baseLeft = Number.isFinite(handlePos.value.left)
    ? handlePos.value.left
    : wrapperRect
      ? rect.left - wrapperRect.left
      : rect.left;
  listHandleState.value = listHit;
  listHandlePos.value = {
    top: topOffset + rect.height / 2,
    left: baseLeft - LIST_HANDLE_OFFSET,
    height: rect.height,
  };
};

const isListHandleHoverGutter = (event, wrapperRect) => {
  const { height, top } = listHandlePos.value;
  const handleLeft = handlePos.value.left;
  if (!Number.isFinite(handleLeft) || !Number.isFinite(height) || height <= 0) return false;
  if (typeof event?.clientX !== 'number' || typeof event?.clientY !== 'number') return false;
  const localX = wrapperRect ? event.clientX - wrapperRect.left : event.clientX;
  const localY = wrapperRect ? event.clientY - wrapperRect.top : event.clientY;
  const topEdge = top - height / 2;
  const bottomEdge = top + height / 2;
  if (localY < topEdge || localY > bottomEdge) return false;
  const zoneLeft = handleLeft - (LIST_HANDLE_OFFSET + LIST_HANDLE_WIDTH + LIST_HANDLE_HOVER_PADDING);
  const zoneRight = handleLeft;
  return localX >= zoneLeft && localX <= zoneRight;
};

const resolveListHandleTarget = () => {
  const listHandle = listHandleState.value;
  if (listHandle?.pos != null && listHandle.pos >= 0) {
    if (LIST_CONTAINER_TYPES.has(listHandle.node?.type?.name)) {
      return listHandle;
    }
    const fromListPos = resolveListContainerFromPos(listHandle.pos);
    if (fromListPos) return fromListPos;
  }
  const handlePos = handleState.value?.pos;
  if (handleState.value?.node?.type?.name === LIST_ITEM_TYPE && typeof handlePos === 'number' && handlePos >= 0) {
    return resolveListContainerFromPos(handlePos);
  }
  return null;
};

const applyListHandleSelection = () => {
  const listTarget = resolveListHandleTarget();
  if (!listTarget?.node || listTarget.pos == null || listTarget.pos < 0) return false;
  handleDragHandleChange({ node: listTarget.node, pos: listTarget.pos });
  return true;
};

const resolveHandleCandidate = (event) => {
  if (!editor.value?.view || !event) return null;
  if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return null;
  const { view, state } = editor.value;
  const listItemTarget = resolveListItemFromTarget(event.target, event.clientY);
  if (listItemTarget) {
    return listItemTarget;
  }
  const closestBlock = event.target?.closest?.('[data-block-pos],[data-pos]');
  const blockPosAttr = closestBlock?.getAttribute?.('data-block-pos') || closestBlock?.getAttribute?.('data-pos');
  const attrPos = blockPosAttr ? parseInt(blockPosAttr, 10) : NaN;
  if (Number.isFinite(attrPos)) {
    const nodeAt = state.doc.nodeAt(attrPos);
    if (nodeAt?.isBlock) {
      const typeName = nodeAt.type?.name;
      if (typeName === 'heading') {
        const $pos = state.doc.resolve(attrPos);
        for (let depth = $pos.depth; depth > 0; depth -= 1) {
          const parent = $pos.node(depth);
          if (parent?.type?.name === 'toggleHeading') {
            const togglePos = $pos.before(depth);
            const element = view.nodeDOM(togglePos);
            if (element instanceof HTMLElement) {
              return { element, node: parent, pos: togglePos };
            }
            break;
          }
        }
      }
      if (LIST_CONTAINER_TYPES.has(typeName)) {
        const listEl = view.nodeDOM(attrPos);
        const listItemFromContainer = resolveListItemFromTarget(listEl, event.clientY);
        if (listItemFromContainer) {
          return listItemFromContainer;
        }
      }
      const listItemHit = resolveListItemFromPos(attrPos);
      if (listItemHit) {
        const listItemFromContainer = resolveListItemFromTarget(listItemHit.element, event.clientY);
        if (listItemFromContainer) {
          return listItemFromContainer;
        }
        return listItemHit;
      }
      if (typeName === 'column') {
        const only = getColumnOnlyBlock(nodeAt, attrPos);
        if (only) {
          const element = view.nodeDOM(only.pos);
          if (element instanceof HTMLElement) {
            return { element, node: only.node, pos: only.pos };
          }
        }
      } else if (typeName !== 'columns' && !LIST_CONTAINER_TYPES.has(typeName)) {
        const element = closestBlock instanceof HTMLElement ? closestBlock : view.nodeDOM(attrPos);
        if (element instanceof HTMLElement) {
          return { element, node: nodeAt, pos: attrPos };
        }
      }
    }
  }
  let resolvedPos = null;
  if (resolvedPos == null) {
    const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!coords?.pos && coords?.pos !== 0) return null;
    resolvedPos = coords.pos;
  }
  const listItemHit = resolveListItemFromPos(resolvedPos);
  if (listItemHit) {
    const listItemFromContainer = resolveListItemFromTarget(listItemHit.element, event.clientY);
    if (listItemFromContainer) {
      return listItemFromContainer;
    }
    return listItemHit;
  }
  const $pos = state.doc.resolve(resolvedPos);
  let inColumn = false;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth)?.type?.name === 'column') {
      inColumn = true;
      break;
    }
  }
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (!node?.isBlock) continue;
    const pos = $pos.before(depth);
    const typeName = node.type?.name;
    if (LIST_CONTAINER_TYPES.has(typeName)) {
      const listEl = view.nodeDOM(pos);
      const listItemFromContainer = resolveListItemFromTarget(listEl, event.clientY);
      if (listItemFromContainer) {
        return listItemFromContainer;
      }
      continue;
    }
    if (typeName === 'column') {
      const only = getColumnOnlyBlock(node, pos);
      if (only) {
        const element = view.nodeDOM(only.pos);
        if (element instanceof HTMLElement) {
          return { element, node: only.node, pos: only.pos };
        }
      }
      continue;
    }
    if (typeName === 'columns') continue;
    const isTopLevel = depth === 1;
    if (!isTopLevel && !inColumn) continue;
    let element = view.nodeDOM(pos);
    if (!(element instanceof HTMLElement)) {
      if (closestBlock instanceof HTMLElement) {
        element = closestBlock;
      } else {
        continue;
      }
    }
    return { element, node, pos };
  }
  return null;
};

const hideBlockHandle = () => {
  if (handleLocked.value) return;
  handleVisible.value = false;
  handleDragHandleChange({ node: null, pos: -1 });
  clearListHandle();
};

const updateBlockHandleFromEvent = (event) => {
  if (!editor.value || editor.value.isDestroyed || !editor.value.isEditable) {
    hideBlockHandle();
    return;
  }
  if (handleLocked.value) return;
  const target = event?.target;
  const isFormControl =
    target?.closest?.('.form-page')
    && !!target?.closest?.('input, select, textarea, button, .form-input, .form-submit-btn, .form-checkbox');
  if (isFormControl) {
    hideBlockHandle();
    return;
  }
  const isHandle = target?.closest?.('.drag-handle');
  const isMenu = target?.closest?.('.block-menu') || target?.closest?.('.bubble-menu') || target?.closest?.('.emoji-menu');
  if (isHandle || isMenu) return;
  const hit = resolveHandleCandidate(event);
  if (!hit?.element) {
    hideBlockHandle();
    return;
  }
  const rect = hit.element.getBoundingClientRect();
  if (!rect) {
    hideBlockHandle();
    return;
  }
  const wrapperEl = wrapperRef.value;
  const wrapperRect = wrapperEl?.getBoundingClientRect?.();
  const topOffset = wrapperRect ? rect.top - wrapperRect.top : rect.top;
  const listContainer = hit.node?.type?.name === LIST_ITEM_TYPE ? resolveOutermostListContainerFromPos(hit.pos) : null;
  const leftRect = listContainer?.element?.getBoundingClientRect?.() || rect;
  const leftOffset = wrapperRect ? leftRect.left - wrapperRect.left : leftRect.left;
  const styles = getComputedStyle(hit.element);
  const lineHeight = Number.parseFloat(styles.lineHeight);
  const fontSize = Number.parseFloat(styles.fontSize);
  const effectiveLineHeight = Number.isFinite(lineHeight)
    ? lineHeight
    : Number.isFinite(fontSize)
      ? fontSize * 1.4
      : rect.height;
  const topAligned = rect.height > effectiveLineHeight * 1.4;
  handleVisible.value = true;
  handlePos.value = {
    top: topOffset + (topAligned ? effectiveLineHeight / 2 : rect.height / 2),
    left: leftOffset,
  };
  updateListHandleFromHit(hit, wrapperRect);
  if (hit.node?.type?.name === LIST_ITEM_TYPE) {
    setListHandleTriggerHover(isListHandleHoverGutter(event, wrapperRect));
  } else {
    setListHandleTriggerHover(false);
  }
  if (handleState.value?.pos !== hit.pos || handleState.value?.node !== hit.node) {
    handleDragHandleChange({ node: hit.node, pos: hit.pos });
  }
};

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
  teardownSyncedWorkspaceProvider();
  unbindSyncedLocksMap();
  pageLinkCollabState.forEach((_, databasePageId) => {
    teardownPageLinkCollabState(databasePageId);
  });
  stopUnsyncedWatcher();
  clearSavedDelay();
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
  document.removeEventListener('mousedown', handleOutsideClick);
  document.removeEventListener('dragstart', handleGlobalDragStart);
  document.removeEventListener('dragend', handleGlobalDragEnd);
  document.removeEventListener('mousemove', handleHoverMove);
  document.removeEventListener('mouseleave', clearAllHoveredBlocks);
  document.removeEventListener('mousedown', handleCodeLangOutsideClick);
  document.removeEventListener('mousedown', handleBubbleColorOutsideClick);
  document.removeEventListener('mousedown', handleBubbleHighlightOutsideClick);
  document.removeEventListener('mousemove', handleSuggestionMousemove);
  clearTimeout(_suggestionHideTimer);
  document.querySelector('.wikid-mainframe')?.removeEventListener('scroll', handleMainframeScroll);
  if (listHandleHoverTimer) {
    clearTimeout(listHandleHoverTimer);
    listHandleHoverTimer = null;
  }
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
