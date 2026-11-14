<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { getMarkRange } from '@tiptap/core';
import { TextSelection, NodeSelection } from 'prosemirror-state';
import * as Y from 'yjs';
import { createCollabProvider, providerStatus } from '../services/collabSocket';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap';
import { NodeRangeSelection } from '@tiptap/extension-node-range';
import { editorDocToTiptap } from '../utils/editorDoc';
import { api } from '../api/client';
import { useWorkspaceStore } from '../stores/workspace';
import { useBlockSummarizer } from '../composables/useBlockSummarizer';
import { blockElementPos, blockHighlightKey } from '../tiptap/blockIds';
import { columnCleanupKey } from '../tiptap/columnGuards';
import { SYNCED_FROM_ATTR, findColumnAncestor } from '../tiptap/editorShared';
import { createColumnsPayload, createToggleHeadingPayload, getColumnOnlyBlock } from '../tiptap/blockPayloads';
import { codeBlockLanguages } from '../tiptap/editorMenuOptions';
import { findBlockById } from '../tiptap/syncedBlocks';
import { blockDebugEnabled, describeUndoOrigin, describeUndoStacks, logDuplicateBlockDetails, logSetup, logUndoDebug, undoDebugEnabled } from '../utils/editorDebug';
import { colorFromId } from '../utils/presenceColor';

import { usePageLinkAttributes } from '../composables/usePageLinkAttributes';
import { createEditorExtensions } from '../tiptap/editorExtensions';
import { createDragScrollRestore } from '../utils/dragScrollRestore';
import { createEditorProps } from '../tiptap/editorInputHandlers';
import BlockMenu from './BlockMenu.vue';
import TextBubbleMenu from './TextBubbleMenu.vue';
import { useEditorAi } from '../composables/useEditorAi';
import { createSlashItems } from '../tiptap/slashItems';
import { pageLinkTarget } from '../utils/editorLinks';
import { mentionLabel } from '../tiptap/pageMentionLabel';
import LinkEditor from './LinkEditor.vue';
import { useBlockHandles } from '../composables/useBlockHandles';
import { useSyncedBlocks } from '../composables/useSyncedBlocks';
import { useSaveStatus } from '../composables/useSaveStatus';
import { useClickPlaceholder } from '../composables/useClickPlaceholder';
import { useCollabSeeding } from '../composables/useCollabSeeding';
import { imageSizeAttrs, readImageSize } from '../utils/imageSize';
import { withUploadPlaceholder } from '../tiptap/imageUploads';
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

const emit = defineEmits(['update:doc', 'status', 'collabready', 'contentready']);
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
    if (!page || page.isDeleted || page.isTemplate) return false;
    if (page.isHidden && !isDatabaseRowPage(page)) return false;
    if (workspaceId && page.workspaceId !== workspaceId) return false;
    return true;
  });
};

// The link editor (LinkEditor.vue): open under the words it's for, or where the cursor is. With the
// cursor in a link, or words chosen within one, that link is the one edited ("/link" always makes a
// new one). Its place is kept as live-editing positions, which stay with the words whatever else
// changes (someone else typing earlier on); without live editing, it follows each change here.
const linkEditorState = ref(null);
let followLinkRange = null;
const stopFollowingLinkRange = () => {
  if (followLinkRange) editor.value?.off('transaction', followLinkRange);
  followLinkRange = null;
};
const liveSync = (state) => {
  const sync = ySyncPluginKey.getState(state);
  return sync?.binding?.mapping && sync.type && sync.doc ? sync : null;
};
// The link editor's words where they are now (null if they've gone)
const linkRangeNow = (state, target) => {
  if (!target.live) return { from: target.from, to: target.to };
  const sync = liveSync(state);
  if (!sync) return null;
  const from = relativePositionToAbsolutePosition(sync.doc, sync.type, target.live.from, sync.binding.mapping);
  const to = relativePositionToAbsolutePosition(sync.doc, sync.type, target.live.to, sync.binding.mapping);
  if (from == null || to == null || to < from) return null;
  return { from, to };
};
const openLinkEditor = ({ newLink = false } = {}) => {
  const ed = editor.value;
  if (!ed || !ed.isEditable) return;
  const { state, view } = ed;
  const linkType = state.schema.marks.link;
  const { selection } = state;
  // A page mention next to the cursor (just before it, else just after): edited as one, to change
  // its page or make it linked words
  const { $from } = selection;
  const mentionBefore = selection.empty && $from.nodeBefore?.type.name === 'pageMention' ? $from.nodeBefore : null;
  const mentionAfter = selection.empty && !mentionBefore && $from.nodeAfter?.type.name === 'pageMention' ? $from.nodeAfter : null;
  const mentionNode = mentionBefore || mentionAfter;
  if (!newLink && mentionNode) {
    const mentionFrom = mentionBefore ? $from.pos - mentionNode.nodeSize : $from.pos;
    const mentionTo = mentionFrom + mentionNode.nodeSize;
    const at = view.coordsAtPos(mentionFrom);
    const page = getResolvedPage(mentionNode.attrs.pageId);
    const sync = liveSync(state);
    linkEditorState.value = {
      from: mentionFrom,
      to: mentionTo,
      live: sync
        ? {
            from: absolutePositionToRelativePosition(mentionFrom, sync.type, sync.binding.mapping),
            to: absolutePositionToRelativePosition(mentionTo, sync.type, sync.binding.mapping),
          }
        : null,
      text: '',
      href: `/doc/${mentionNode.attrs.pageId}`,
      editing: true,
      mention: true,
      mentionTitle: mentionLabel(page),
      mentionPage: { id: mentionNode.attrs.pageId, title: mentionLabel(page), icon: page?.icon || '' },
      textEditable: true,
      anchor: { left: at.left, bottom: at.bottom },
    };
    return;
  }
  // (Not in code, which can't hold links)
  if (!linkType || !selection.$from.parent.type.allowsMarkType(linkType)) return;
  let { from, to } = selection;
  const linkAtCursor = newLink ? null : getMarkRange(selection.$from, linkType) || null;
  // Chosen words only edit a link they lie within (not one just before them)
  const linkRange = linkAtCursor && !selection.empty && (from < linkAtCursor.from || to > linkAtCursor.to) ? null : linkAtCursor;
  if (linkRange) ({ from, to } = linkRange);
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);
  const sync = liveSync(state);
  linkEditorState.value = {
    from,
    to,
    live: sync
      ? {
          from: absolutePositionToRelativePosition(from, sync.type, sync.binding.mapping),
          to: absolutePositionToRelativePosition(to, sync.type, sync.binding.mapping),
        }
      : null,
    text: state.doc.textBetween(from, to, ' '),
    href: linkRange ? linkHrefAt(state, linkRange) : '',
    editing: !!linkRange,
    // Words in one block can be rewritten; across several, only linked (rewriting merged them)
    textEditable: state.doc.resolve(from).sameParent(state.doc.resolve(to)),
    anchor: { left: start.left, bottom: Math.max(start.bottom, end.bottom) },
  };
  stopFollowingLinkRange();
  if (sync) return;
  followLinkRange = ({ transaction }) => {
    const current = linkEditorState.value;
    if (!current || !transaction.docChanged) return;
    const mappedFrom = transaction.mapping.map(current.from, current.from === current.to ? -1 : 1);
    const mappedTo = transaction.mapping.map(current.to, -1);
    linkEditorState.value = { ...current, from: mappedFrom, to: Math.max(mappedFrom, mappedTo) };
  };
  ed.on('transaction', followLinkRange);
};
const linkHrefAt = (state, range) => {
  let href = '';
  state.doc.nodesBetween(range.from, range.to, (node) => {
    const mark = !href && node.marks?.find((m) => m.type.name === 'link');
    if (mark) href = mark.attrs.href || '';
  });
  return href;
};
// Back to the page at once: Tiptap's focus() waits a frame, and a key typed straight after saving
// (a space after the link) went nowhere
const returnToPage = (ed) => {
  linkEditorState.value = null;
  stopFollowingLinkRange();
  if (ed && !ed.isDestroyed) ed.view.focus();
};
const closeLinkEditor = () => {
  returnToPage(editor.value);
  editor.value?.commands.focus();
};
const linkAttrs = (href) => ({ href, target: pageLinkTarget(href) ? null : '_blank' });
const saveLink = ({ text, href, mention, pageId }) => {
  const ed = editor.value;
  const target = linkEditorState.value;
  returnToPage(ed);
  if (!ed || !target) return;
  const range = linkRangeNow(ed.state, target);
  if (!range) return;
  const { from, to } = range;
  if (mention) {
    // The page as a mention, in place of the words (or where the cursor was), a space after it
    // unless one follows already
    const after = ed.state.doc.textBetween(to, Math.min(to + 1, ed.state.doc.content.size), ' ');
    const content = [{ type: 'pageMention', attrs: { pageId } }, ...(after === ' ' ? [] : [{ type: 'text', text: ' ' }])];
    ed.chain().focus().insertContentAt({ from, to }, content).run();
    return;
  }
  if (target.mention) {
    // A mention made words linked to its page: its title, unless other words were given
    ed.chain()
      .focus()
      .insertContentAt({ from, to }, { type: 'text', text: text || target.mentionTitle, marks: [{ type: 'link', attrs: linkAttrs(href) }] })
      .run();
    return;
  }
  if (from !== to && (text === target.text || !target.textEditable)) {
    // The same words: linked where they are (across several blocks too)
    ed.chain().focus().setTextSelection({ from, to }).setLink(linkAttrs(href)).setTextSelection(to).run();
    return;
  }
  // New words: in place of the old ones, linked, with the cursor after them. They keep the old
  // words' bold, italic, colour...
  const kept = (from !== to ? ed.state.doc.nodeAt(from)?.marks : ed.state.doc.resolve(from).marks()) || [];
  const marks = [...kept.filter((mark) => mark.type.name !== 'link').map((mark) => mark.toJSON()), { type: 'link', attrs: linkAttrs(href) }];
  ed.chain()
    .focus()
    .insertContentAt({ from, to }, { type: 'text', text, marks })
    .setTextSelection(from + text.length)
    .run();
};
const removeLink = () => {
  const ed = editor.value;
  const target = linkEditorState.value;
  returnToPage(ed);
  if (!ed || !target) return;
  const range = linkRangeNow(ed.state, target);
  if (!range) return;
  if (target.mention) {
    // A mention taken off: its title, as plain words
    ed.chain().focus().insertContentAt(range, { type: 'text', text: target.mentionTitle }).run();
    return;
  }
  ed.chain().focus().setTextSelection(range).unsetLink().setTextSelection(range.to).run();
};
// The pages a link can go to, for the link editor's search
const linkablePages = computed(() =>
  linkEditorState.value ? listWorkspacePages().map((page) => ({ id: page.id, title: page.title, icon: page.icon })) : []
);
// A link to a page here: opened in place (loaded if it isn't in the list, or a word on why it can't
// be opened), at the block it names if it does. The address loses the old page's "#block-…".
const openLinkedPage = async (pageId, hash) => {
  if (typeof window !== 'undefined' && window.location.hash) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
  await workspace.openPageFromLink(pageId);
  if (hash && typeof window !== 'undefined') window.location.hash = hash;
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
      const node = state.schema.nodeFromJSON(payload);
      const { $from } = tr.selection;
      // On an empty line, in its place (put inside it, it left the line empty above)
      if ($from.parent.type.name === 'paragraph' && !$from.parent.content.size && $from.depth >= 1 && $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), node.type)) {
        const start = $from.before();
        tr.replaceWith(start, $from.after(), node);
        tr.setSelection(TextSelection.create(tr.doc, start + 2));
        return true;
      }
      const insertPos = tr.selection.from;
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

// Whether images can be uploaded here, saying why not
// quiet: no message saying why not (pictures pasted with text: the text goes in regardless)
const canUploadImages = ({ quiet = false } = {}) => {
  const say = (message) => !quiet && window.alert(message);
  if (props.readonly) return false;
  if (!workspace.hasApi) {
    say('API unavailable.');
    return false;
  }
  if (!props.pageId) {
    say('Save this page before uploading images.');
    return false;
  }
  if (!workspace.activeUser?.id) {
    say('Login required to upload images.');
    return false;
  }
  return true;
};

const uploadImageFile = async (file, onProgress, { quiet = false } = {}) => {
  const user = workspace.activeUser;
  try {
    const res = await api.uploadImage(file, { pageId: props.pageId, userId: user.id, userName: user.name, onProgress });
    return res?.file?.url || null;
  } catch (err) {
    console.warn('Image upload failed', err);
    if (!quiet) window.alert('Image upload failed.');
    return null;
  }
};

// Image files, each uploaded and put in at `pos` as it finishes, showing its progress there till
// then. `pos` follows any edits (anyone's) made meanwhile. With paragraphAfter, a paragraph follows
// each, to carry on typing in.
// Resolves to how many of the images went in
const insertImageFiles = async (files, pos, { paragraphAfter = false } = {}) => {
  const ed = editor?.value;
  if (!ed || !files.length || !canUploadImages()) return 0;
  const inserted = await Promise.all(files.map(async (file) => {
    const size = await readImageSize(file);
    const { result: src, pos: at } = await withUploadPlaceholder(ed, pos, file, size, (onProgress) => uploadImageFile(file, onProgress));
    if (!src || at == null || ed.isDestroyed) return false;
    const image = { type: 'image', attrs: { src, ...imageSizeAttrs(size) } };
    ed.chain().focus().insertContentAt(at, paragraphAfter ? [image, { type: 'paragraph' }] : image).run();
    return true;
  }));
  return inserted.filter(Boolean).length;
};

// Pictures pasted with text (from Word): each uploaded, and handed to `done` (its index, and its
// address and size, or null if it failed: its placeholder stays, to upload by hand) as it finishes.
// One message however many fail, unless the page has gone meanwhile.
const uploadPastedImages = async (files, done) => {
  let failed = 0;
  await Promise.all(files.map(async (file, i) => {
    if (!file) return;
    const [src, size] = await Promise.all([uploadImageFile(file, undefined, { quiet: true }), readImageSize(file)]);
    if (!src) failed += 1;
    done(i, src ? { src, attrs: imageSizeAttrs(size) } : null);
  }));
  if (failed && editor?.value && !editor.value.isDestroyed) {
    window.alert(failed === 1 ? "A pasted picture couldn't be uploaded: its placeholder is there to upload it by hand." : `${failed} pasted pictures couldn't be uploaded: their placeholders are there to upload them by hand.`);
  }
};
// Whether pictures can be uploaded here at all (not on an unsaved page, say), without saying why not
const canUploadPastedImages = () => canUploadImages({ quiet: true });

const insertImageFromUpload = async (editor, range) => {
  if (props.readonly) return;
  const file = await pickImageFile();
  if (!file) return;
  if (range) editor.chain().focus().deleteRange(range).run();
  await insertImageFiles([file], editor.state.selection.from, { paragraphAfter: true });
};

const { lastKnownCursorPos, serializeBlocksForAi, applyAiSuggestions, revertSuggestion, acceptSuggestion, revertAllSuggestions, acceptAllSuggestions, activeSuggestions, hoveredSuggestionIndex, suggestionWidgetPos, handleSuggestionMousemove, aiPromptVisible, aiPromptPos, aiPromptText, aiPromptInputRef, aiStreaming, showAiPrompt, closeAiPrompt, submitAiPrompt, runAiBubbleAction } = useEditorAi({ workspace, getEditor: () => editor?.value });

const slashItems = createSlashItems({ insertToggleHeading, insertColumns, insertImageFromUpload, props, getResolvedPage, workspace, showAiPrompt, openLinkEditor: () => openLinkEditor({ newLink: true }) });

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
const lastPointerDownAt = ref(0);

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
const tuneMenuPos = ref({ top: 0, left: 0 });
const tuneMenuFlipped = ref(false);
const tuneMenuRef = ref(null);
const tuneMenuBlockEl = ref(null);
const collabField = 'default';
const collabMetaKey = 'wikidMeta';
const createCollabDoc = () => {
  const guid = props.collab?.docName || `wikid-temp-${Math.random().toString(16).slice(2)}`;
  // (Never made reactive: see utils/yjsNotReactive.js)
  const doc = new Y.Doc({ guid });
  doc.getXmlFragment(collabField);
  return doc;
};
const collabDoc = shallowRef(createCollabDoc());
// Leaving (closing or reloading the tab) with changes the server hasn't got yet would lose them:
// offline, or the server unreachable. The browser asks first.
// Only for changes made here (a reconnect alone can look like unsent changes until the server answers).
const hasOwnUnsentChanges = ref(false);
const clearOwnUnsentWhenSynced = (count) => {
  if (!count) hasOwnUnsentChanges.value = false;
};
const warnBeforeLeavingUnsaved = (event) => {
  if (!isCollabEnabled.value || !hasOwnUnsentChanges.value || !collabProvider.value?.hasUnsyncedChanges) return;
  event.preventDefault();
  event.returnValue = '';
};
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
    collabProvider.value.off?.('unsyncedChanges', clearOwnUnsentWhenSynced);
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
  hasOwnUnsentChanges.value = false;
  // Changes not from the server (the provider) are this person's own
  collabDoc.value.on('update', (_update, origin) => {
    if (origin !== collabProvider.value) hasOwnUnsentChanges.value = true;
  });
  bindSyncedLocksMap(collabDoc.value);
  bindUndoOriginObserver();
  currentDocName.value = props.collab.docName || null;
  initialContentSeeded.value = false;
  setupSeededAfterSync.value = false;
  contentSynced.value = false;
  logSetup('provider', { docName: currentDocName.value });
  try {
    collabProvider.value = createCollabProvider({
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
    collabProvider.value.on('unsyncedChanges', clearOwnUnsentWhenSynced);
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

// The page's content is still on its way from the server, so it isn't really empty yet
const contentSynced = ref(false);
const waitingForContent = computed(() => isCollabEnabled.value && !contentSynced.value);

const handleCollabSynced = (synced) => {
  if (!synced) return;
  // Tells the page its content is in (the first time), with the document's name
  if (!contentSynced.value) emit('contentready', currentDocName.value);
  contentSynced.value = true;
  // The page's synced blocks and references, now that its content is in
  scheduleSyncedWorkspaceSourceUpdate();
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

const { isSyncedLocked, hasWorkspaceSyncedReference, insertSyncedBlockFromUrl, toggleSyncedLock, notifySyncedBlockLocked, bindSyncedLocksMap, unbindSyncedLocksMap, scheduleSyncedWorkspaceRefresh, scheduleSyncedWorkspaceSourceUpdate, setupSyncedWorkspaceProvider, teardownSyncedWorkspaceProvider, disposeSyncedBlocks } = useSyncedBlocks({ props, workspace, activeWorkspaceId, getResolvedPage, collabDoc, isCollabEnabled, getEditor: () => editor?.value, getHoveredSyncedSourceId: () => hoveredSyncedSourceId?.value, isContentIn: () => !isCollabEnabled.value || contentSynced.value });
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

const dragScroll = createDragScrollRestore();
editor = useEditor({
  content: isCollabEnabled.value ? undefined : editorDocToTiptap(props.doc),
  editable: !props.readonly,
  editorProps: createEditorProps({ lastTextInputAt, lastTextInputInfo, props, isCollabEnabled, isSyncedLocked, notifySyncedBlockLocked, insertSyncedBlockFromUrl, insertImageFiles, uploadPastedImages, canUploadPastedImages, shouldInsertClickPlaceholder, insertClickPlaceholder, dragScroll, getEditor: () => editor?.value }),
  extensions: createEditorExtensions({
    collab: isCollabEnabled.value
      ? { document: collabDoc.value, provider: collabReady.value ? collabProvider.value : null, user: cursorUser.value }
      : null,
    isCollabEnabled,
    isSyncedLocked,
    hasWorkspaceSyncedReference,
    focusTitle: () => focusPageTitle(),
    openBlockMenu: () => openTuneMenuForCursor(),
    closeMenus: () => closeMenusOnEscape(),
    pageLinks: {
      resolvePage: getResolvedPage,
      createChildPage,
      listWorkspacePages,
      openPage,
      deletePage,
      restorePage,
      getPageLinkAttributeData,
      loadPageLinkAttributes,
    },
    databaseViews: {
      resolvePage: getResolvedPage,
      listDatabasePages,
      createDatabasePage,
      openPage,
      restorePage,
      getHostPageId: () => props.pageId || null,
    },
    pageMentions: {
      resolvePage: getResolvedPage,
      listPages: listWorkspacePages,
      openPage: (pageId) => openLinkedPage(pageId, ''),
    },
    links: {
      open: () => openLinkEditor(),
      openPage: (pageId, hash) => openLinkedPage(pageId, hash),
    },
    slashCommands: {
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
    },
    getPlaceholder: () => props.placeholder,
    lastTextInputAt,
    lastTextInputInfo,
    lastPointerDownAt,
    dragBlock: (event, options) => handleBlockDragStart(event, options),
  }),
  onMount({ editor: ed }) {
    // An image placeholder's Upload button uploads through the editor, as a pasted image does
    if (ed.storage.imagePlaceholder && !props.readonly) ed.storage.imagePlaceholder.upload = (files, pos) => insertImageFiles(files, pos);
    // Taking over from the editor a new page was started in: its content goes in, and the cursor at
    // its end, as soon as this one's on the page, so nothing typed in between goes astray
    if (!props.seedCollabOnMount || !isCollabEnabled.value) return;
    logSetup('mount-seed', { docName: currentDocName.value });
    captureInitialAutoBlock(ed.state.doc);
    seedCollabDocFromProps(ed, { force: true });
    if (props.readonly) return;
    ed.commands.focus('end');
    // focus() waits a frame, and a keystroke can come in that frame. The editor's put on the page
    // a few ticks after it's made (by EditorContent), all before the next keystroke can, so it
    // takes focus as soon as it's there
    const focusOnPage = async () => {
      for (let tries = 0; tries < 10 && !ed.isDestroyed; tries += 1) {
        if (ed.view.dom.isConnected) {
          ed.view.focus();
          return;
        }
        await nextTick();
      }
    };
    focusOnPage();
  },
  onCreate({ editor: ed }) {
    logSetup('create', {
      docName: currentDocName.value,
      collabEnabled: isCollabEnabled.value,
      seedOnMount: props.seedCollabOnMount,
    });
    captureInitialAutoBlock(ed.state.doc);
    nextTick(() => syncTableDomAttributes());
  },
  // Blocks remembered by where they are (the one the handle and its menu are on, the code block or
  // image under the mouse) follow the page as it changes, here or by someone else: a menu acting on
  // a stale position changed the wrong block, and one past the end of a shrunk page took the editor down
  onTransaction({ transaction }) {
    if (transaction.docChanged) followDocChange(transaction);
  },
  onSelectionUpdate({ editor: ed }) {
    clearClickPlaceholderIfNeeded(ed?.view);
    followCursorCodeBlock(ed);
    updateActiveTable();
    lastKnownCursorPos.value = ed.state.selection.from;
  },
  onBlur({ editor: ed, event }) {
    // The language picker the cursor brought up goes when focus goes somewhere else (the title, a
    // click away); not on Escape out of the page (nowhere yet: the next Tab reaches the picker), nor
    // into the picker itself
    const to = event?.relatedTarget;
    const intoPicker = to instanceof Element && !!to.closest('.codeblock-bubble-menu, .code-lang-menu');
    if (codeBlockFromCursor && !codeLangMenuOpen.value && to && !intoPicker) {
      codeBlockFromCursor = false;
      clearHoveredCodeBlock();
    }
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
      if (providerStatus(collabProvider.value) === 'connected') {
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
    // Ids in someone else's change are theirs to fix (see blockIds.js), not every browser's
    if (transaction?.getMeta?.(ySyncPluginKey)) {
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

// ArrowUp on the first line: to the page's title, the cursor at its end (see keyboardWayOut.js)
const focusPageTitle = () => {
  const title = editor.value?.view?.dom?.closest?.('.page-surface')?.querySelector('textarea.page-title');
  if (!title || title.readOnly) return false;
  title.focus({ preventScroll: true });
  title.setSelectionRange(title.value.length, title.value.length);
  return true;
};
// ArrowDown from the title: to the start of the page
const focusStart = () => {
  if (!editor.value || editor.value.isDestroyed) return false;
  editor.value.chain().focus('start').run();
  return true;
};

// Enter in the title: the cursor to a new empty first line of the page (an empty one already there
// does). At once, not a frame later as the editor's own focus is, or a key typed straight after
// Enter went into the title.
const insertParagraphAtTop = () => {
  if (!editor.value || editor.value.isDestroyed) return false;
  const paragraph = editor.value.schema?.nodes?.paragraph;
  if (!paragraph) return false;
  const { view } = editor.value;
  view.focus();
  // Read after focusing, which can itself change the state
  const state = editor.value.state;
  const first = state.doc.firstChild;
  const tr = state.tr;
  if (!(first?.type === paragraph && first.content.size === 0)) tr.insert(0, paragraph.create());
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, 1)).scrollIntoView());
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

const handleDragHandleChange = ({ node, pos }) => {
  // The block menu keeps the block it was opened for (from the keyboard, the pointer's elsewhere, and
  // the handle reported no block under it, leaving the menu nothing to act on)
  if (showTuneMenu.value) return;
  const nextPos = typeof pos === 'number' ? pos : -1;
  if (!node) {
    handleState.value = { node: null, pos: -1 };
    return;
  }
  handleState.value = { node, pos: nextPos };
};
const hoveredCodeBlock = ref(null);
const hoveredCodeLanguage = computed(() => {
  if (!hoveredCodeBlock.value || !editor.value?.state) return '';
  const node = nodeAtSafe(hoveredCodeBlock.value.pos);
  const lang = node?.attrs?.language;
  return typeof lang === 'string' ? lang.trim() : '';
});
const codeLangMenuOpen = ref(false);
const codeLangButtonRef = ref(null);
const codeLangMenuPos = ref({ top: 0, left: 0 });
const hoveredImage = ref(null);
const hoveredSyncedSource = ref(null);
const syncedSourceBubblePos = ref({ top: 0, left: 0 });
const activeTableEl = ref(null);
const tableCellBubblePos = ref({ top: 0, left: 0, width: 0, clamped: false });
const tableAddRowPos = ref({ top: 0, left: 0 });
const hoveredSyncedSourceId = computed(() => {
  if (!hoveredSyncedSource.value || !editor.value?.state) return null;
  const node = nodeAtSafe(hoveredSyncedSource.value.pos);
  return node?.attrs?.id || null;
});
const hoveredSyncedLocked = computed(() => isSyncedLocked(hoveredSyncedSourceId.value));
// Bubbles drawn inside a block's own element (a code block's language, an image's buttons): not part
// of what can be selected or typed over, or a triple-click took them in and typing replaced their
// text on screen while the page itself didn't change
const blockBubbleStyle = { position: 'absolute', top: '6px', right: '6px', zIndex: 5, userSelect: 'none' };

// The node at a position kept from earlier, or null if there's none there now
const nodeAtSafe = (pos) => {
  const doc = editor.value?.state?.doc;
  if (!doc || !Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return null;
  try {
    return doc.nodeAt(pos);
  } catch {
    return null;
  }
};

// Where a remembered block is now: found by its id, as a change to it (its colour, someone typing in
// it) can replace it whole; by its position mapped through the change if it has none. Null if it's
// gone, or isn't the kind it was.
const followBlock = (entry, transaction, type) => {
  if (!entry || !Number.isInteger(entry.pos) || entry.pos < 0) return entry;
  const id = entry.id ?? entry.node?.attrs?.id ?? null;
  let found = null;
  if (id) {
    found = findBlockById(transaction.doc, id);
  } else {
    const pos = transaction.mapping.map(entry.pos, 1);
    let node = null;
    try {
      node = transaction.doc.nodeAt(pos);
    } catch {
      node = null;
    }
    found = node ? { node, pos } : null;
  }
  if (!found || (type && found.node.type.name !== type)) return null;
  return { ...entry, pos: found.pos, ...('node' in entry ? { node: found.node } : {}), ...(id ? { id } : {}) };
};

// A block being dragged by its handle: what's dropped is taken as the drag starts, so it's taken
// again as the page changes (someone's typing in it meanwhile was lost), from the block itself, by
// its id. If it's gone (deleted by someone else), there's nothing to drop.
let blockDrag = null; // { id } while one is under way

const followDrag = (view) => {
  if (!blockDrag) return;
  if (!view.dragging) {
    blockDrag = null;
    return;
  }
  const state = editor.value.state;
  if (!blockDrag.id) {
    // Several blocks, or one without an id: the selection follows them
    const selection = state.selection;
    if (selection instanceof NodeSelection || selection instanceof NodeRangeSelection) {
      view.dragging = { slice: selection.content(), move: true };
    }
    return;
  }
  const found = findBlockById(state.doc, blockDrag.id);
  if (!found) {
    view.dragging = null;
    blockDrag = null;
    return;
  }
  view.dragging = { slice: NodeSelection.create(state.doc, found.pos).content(), move: true };
  // The drop removes what's selected from where it was: the dragged block, not one the selection
  // slid onto when the page changed
  const selected = state.selection;
  if (!(selected instanceof NodeSelection && selected.from === found.pos)) {
    queueMicrotask(() => {
      const current = editor.value?.state;
      const again = current && blockDrag?.id ? findBlockById(current.doc, blockDrag.id) : null;
      if (again) view.dispatch(current.tr.setSelection(NodeSelection.create(current.doc, again.pos)));
    });
  }
};

const followDocChange = (transaction) => {
  const view = editor.value?.view;
  if (view) followDrag(view);
  if (handleState.value?.pos >= 0) {
    const next = followBlock(handleState.value, transaction, handleState.value.node?.type?.name);
    if (next) {
      handleState.value = next;
    } else {
      handleState.value = { node: null, pos: -1 };
      // Its block went (deleted, perhaps by someone else): nothing for its menu to act on
      if (showTuneMenu.value) closeTuneMenu();
    }
  }
  if (hoveredCodeBlock.value) {
    hoveredCodeBlock.value = followBlock(hoveredCodeBlock.value, transaction, 'codeBlock');
    if (!hoveredCodeBlock.value) codeLangMenuOpen.value = false;
  }
  if (hoveredImage.value) hoveredImage.value = followBlock(hoveredImage.value, transaction, 'image');
  if (hoveredSyncedSource.value) hoveredSyncedSource.value = followBlock(hoveredSyncedSource.value, transaction);
};

// A code block's language picker shows while the cursor's in it, not only under the pointer (a
// keyboard couldn't reach it): set from the cursor, and gone when the cursor leaves (if not hovered)
let codeBlockFromCursor = false;
const followCursorCodeBlock = (ed) => {
  if (!ed || ed.isDestroyed) return;
  const { $from } = ed.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== 'codeBlock') continue;
    const pos = $from.before(depth);
    const dom = ed.view.nodeDOM(pos);
    const element = dom instanceof HTMLElement ? dom.closest('.tiptap-codeblock') || dom.querySelector?.('.tiptap-codeblock') : null;
    if (element && (hoveredCodeBlock.value?.pos !== pos || hoveredCodeBlock.value?.element !== element)) {
      hoveredCodeBlock.value = { pos, element, id: node.attrs?.id ?? null };
    }
    codeBlockFromCursor = !!element;
    return;
  }
  if (codeBlockFromCursor) {
    codeBlockFromCursor = false;
    clearHoveredCodeBlock();
  }
};

const clearHoveredCodeBlock = () => {
  if (codeLangMenuOpen.value) return;
  hoveredCodeBlock.value = null;
  codeLangMenuOpen.value = false;
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

// Selects and scrolls to a block; false if it isn't (yet) on the page
const focusBlockById = (blockId) => {
  if (!editor.value || typeof window === 'undefined' || !blockId) return false;
  let targetPos = null;
  editor.value.state.doc.descendants((node, pos) => {
    if (node.isBlock && node.attrs?.id === blockId && targetPos === null) {
      targetPos = pos;
      return false;
    }
    return undefined;
  });
  if (targetPos === null) return false;
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
  return true;
};

const setHoveredCodeBlockFromElement = (element) => {
  if (!editor.value?.state || !element) return;
  // (Looked up: the node view's own data-pos can be behind)
  const pos = blockElementPos(editor.value.view, element) ?? NaN;
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
  hoveredCodeBlock.value = { pos, element, id: node.attrs?.id ?? null };
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
    codeBlockFromCursor = false;
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
  if (!onCodeBlock && !isBubble && !isDropdown && !codeLangMenuOpen.value && !codeBlockFromCursor) {
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
  const node = nodeAtSafe(hoveredCodeBlock.value.pos);
  return !!node && node.type?.name === 'codeBlock';
};

const setHoveredSyncedSourceFromElement = (element) => {
  if (!editor.value?.state || !element) return;
  const pos = blockElementPos(editor.value.view, element) ?? NaN;
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
  hoveredSyncedSource.value = { pos, element, id: node.attrs?.id ?? null };
};

const clearHoveredSyncedSource = () => {
  hoveredSyncedSource.value = null;
  syncedSourceBubblePos.value = { top: 0, left: 0 };
};

const shouldShowSyncedSourceBubble = () => {
  if (!editor.value || editor.value.isDestroyed || !editor.value.isEditable) return false;
  if (!hoveredSyncedSource.value) return false;
  const node = nodeAtSafe(hoveredSyncedSource.value.pos);
  return !!node && node.isBlock && !node.attrs?.[SYNCED_FROM_ATTR];
};

const setHoveredImageFromElement = (element) => {
  if (!editor.value?.state || !element) return;
  // (Looked up: the node view's own data-pos can be behind)
  const pos = blockElementPos(editor.value.view, element) ?? NaN;
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
  hoveredImage.value = { pos, element, id: node.attrs?.id ?? null };
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
  const node = nodeAtSafe(hoveredImage.value.pos);
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
    .then((file) => (file ? Promise.all([uploadImageFile(file), readImageSize(file)]) : []))
    .then(([src, size]) => {
      if (!src) return;
      editor.value
        .chain()
        .focus()
        .command(({ tr }) => {
          const node = tr.doc.nodeAt(pos);
          if (!node || node.type?.name !== 'image') return false;
          tr.setNodeMarkup(pos, node.type, { ...node.attrs, src, ...imageSizeAttrs(size) }, node.marks);
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

const { setHandleLocked, LIST_CONTAINER_TYPES, isListItem, setListHandleTriggerHover, setListHandleSelfHover, resolveListItemFromPos, resolveListItemFromTarget, resolveListHandleTarget, applyListHandleSelection, updateBlockHandleFromEvent } = useBlockHandles({ handleState, handleVisible, handleLocked, handlePos, wrapperRef, listHandleState, listHandlePos, listHandleTriggerHover, listHandleSelfHover, LIST_HANDLE_OFFSET, LIST_HANDLE_WIDTH, LIST_HANDLE_HOVER_PADDING, handleDragHandleChange, getEditor: () => editor?.value });

const setMainframeScrollLocked = (locked) => {
  const frame = document.querySelector('.wikid-mainframe');
  if (!frame) return;
  frame.classList.toggle('wikid-mainframe--lock-scroll', !!locked);
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
  let target = null;
  try {
    target = editor.value.view.nodeDOM(pos);
  } catch {
    target = null;
  }
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
  tuneMenuFlipped.value = false;
  clearTuneMenuBlockHighlight();
  if (!slashMenuOpen.value) {
    setHandleLocked(false);
  }
};

const openTuneMenu = async (event) => {
  tuneMenuFromKeyboard = false;
  const rect = event?.currentTarget?.getBoundingClientRect?.();
  tuneMenuFlipped.value = false;
  if (rect) {
    tuneMenuPos.value = { top: rect.top + rect.height / 2, left: rect.left };
  }
  showTuneMenu.value = true;
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

// The block menu from the keyboard: arrows move between its items, Right goes into a submenu and
// Left back out, Enter or Space picks, Escape closes it and puts the cursor back in the page
const tuneMenuItems = () => [...(tuneMenuRef.value?.querySelectorAll('.block-menu__panel button:not([disabled])') || [])].filter((el) => el.offsetParent !== null);
const focusFirstTuneMenuItem = () => {
  const [first] = tuneMenuItems().filter((el) => !el.classList.contains('block-menu__back'));
  (first || tuneMenuItems()[0])?.focus({ preventScroll: true });
};
// Moving between panels from the keyboard: focus waits on the menu itself while the old panel
// slides out (its focused item goes, and focus fell out of the menu, keys going elsewhere), and goes
// to the new panel's first item once it has slid in (BlockMenu's panel-entered)
let tunePanelFromKeys = false;
const focusTuneMenuItemSoon = () => {
  tunePanelFromKeys = true;
  tuneMenuRef.value?.focus({ preventScroll: true });
};
const handleTunePanelEntered = () => {
  if (!tunePanelFromKeys) return;
  tunePanelFromKeys = false;
  focusFirstTuneMenuItem();
};
const handleTuneMenuKeydown = (event) => {
  const items = tuneMenuItems();
  const at = items.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!items.length) return;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    // (from no item: Down to the first, Up to the last)
    const next = at === -1 ? (step === 1 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  } else if (event.key === 'ArrowRight' && document.activeElement?.classList.contains('block-menu__item--submenu')) {
    event.preventDefault();
    document.activeElement.click();
    focusTuneMenuItemSoon();
  } else if (event.key === 'ArrowLeft') {
    const back = tuneMenuRef.value?.querySelector('.block-menu__back');
    if (!back) return;
    event.preventDefault();
    back.click();
    focusTuneMenuItemSoon();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    // Back to typing if it was opened from there (Ctrl/Cmd+/); opened with the pointer, it just closes
    const fromKeyboard = tuneMenuFromKeyboard;
    closeTuneMenu();
    // (at once: Tiptap's focus waits a frame, and a key straight after went nowhere)
    if (fromKeyboard && editor.value && !editor.value.isDestroyed) editor.value.view.focus();
  } else if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.classList.contains('block-menu__item--submenu')) {
    // Opened here, not by the browser's own click on the key (focus moves on to the menu meanwhile)
    event.preventDefault();
    document.activeElement.click();
    focusTuneMenuItemSoon();
  }
};
// Escape for a block menu opened with the pointer (focus is still in the page, or on the handle):
// it closes, and the page keeps the cursor. True if there was something to close.
const closeMenusOnEscape = () => {
  if (codeLangMenuOpen.value) {
    closeCodeLangMenu();
    return true;
  }
  if (showTuneMenu.value) {
    closeTuneMenu();
    return true;
  }
  return false;
};
const handleDocumentEscape = (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented || !showTuneMenu.value) return;
  if (tuneMenuRef.value?.contains(event.target) || editor.value?.view.dom.contains(event.target)) return;
  closeTuneMenu();
};
// Ctrl/Cmd+/ in the page: the block menu for the block the cursor is in
let tuneMenuFromKeyboard = false;
const openTuneMenuForCursor = () => {
  const ed = editor.value;
  if (!ed || ed.isDestroyed || !ed.isEditable) return false;
  // (one open from the pointer goes first: this one's for the cursor's block)
  if (showTuneMenu.value) closeTuneMenu();
  const { $from } = ed.state.selection;
  if ($from.depth < 1) return false;
  // In a list, the item the cursor's in (as its own handle does), not the whole list
  let depth = 1;
  for (let d = $from.depth; d > 0; d -= 1) {
    if (['listItem', 'taskItem'].includes($from.node(d).type.name)) {
      depth = d;
      break;
    }
  }
  const pos = $from.before(depth);
  const node = ed.state.doc.nodeAt(pos);
  const dom = ed.view.nodeDOM(pos);
  if (!node || !(dom instanceof HTMLElement)) return false;
  handleDragHandleChange({ node, pos });
  const opening = openTuneMenu({ currentTarget: dom });
  // At once (an Escape straight after reads it), and focus in only if it's still open
  tuneMenuFromKeyboard = true;
  opening.then(() => {
    if (showTuneMenu.value) focusFirstTuneMenuItem();
  });
  return true;
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
  dragScroll.stop();
};

const handleBlockDragStart = (event, options = {}) => {
  if (!editor.value?.view || !event?.dataTransfer) return;
  dragScroll.start();
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
      : isListItem(targetNode);
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
  blockDrag = { id: selection instanceof NodeSelection ? selection.node.attrs?.id ?? null : null };
  const selectionTr = state.tr.setSelection(selection);
  if (shouldCleanupColumn && columnInfo && !(selection instanceof NodeRangeSelection)) {
    selectionTr.setMeta(columnCleanupKey, { pending: { pos: columnInfo.pos } });
  }
  view.dispatch(selectionTr);
  const cleanup = () => removeNode(wrapper);
  document.addEventListener('drop', cleanup, { once: true });
  document.addEventListener('dragend', () => {
    blockDrag = null;
    cleanup();
    handleLocked.value = false;
    dragScroll.stop();
    if (editor.value) {
      const { state: endState, view: endView } = editor.value;
      endView.dispatch(endState.tr.setMeta(columnCleanupKey, { clear: true }));
    }
  }, { once: true });
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

const handleMainframeScroll = () => {
  if (activeTableEl.value) updateActiveTable();
};

onMounted(() => {
  window.addEventListener('beforeunload', warnBeforeLeavingUnsaved);
  document.addEventListener('mousedown', handleOutsideClick);
  document.addEventListener('keydown', handleDocumentEscape);
  document.addEventListener('dragstart', handleGlobalDragStart);
  document.addEventListener('dragend', handleGlobalDragEnd);
  document.addEventListener('mousemove', handleHoverMove);
  document.addEventListener('mouseleave', clearAllHoveredBlocks);
  document.addEventListener('mousedown', handleCodeLangOutsideClick);
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
  }
  // Not deep: a new page's content is a new object, and walking the whole page on every keystroke
  // took longer the bigger the page
);

onBeforeUnmount(() => {
  stopFollowingLinkRange();
  window.removeEventListener('beforeunload', warnBeforeLeavingUnsaved);
  editor.value?.destroy();
  teardownCollabProvider();
  disposeSyncedBlocks();
  pageLinkCollabState.forEach((_, databasePageId) => {
    teardownPageLinkCollabState(databasePageId);
  });
  stopUnsyncedWatcher();
  clearSavedDelay();
  document.removeEventListener('mousedown', handleOutsideClick);
  document.removeEventListener('keydown', handleDocumentEscape);
  document.removeEventListener('dragstart', handleGlobalDragStart);
  document.removeEventListener('dragend', handleGlobalDragEnd);
  document.removeEventListener('mousemove', handleHoverMove);
  document.removeEventListener('mouseleave', clearAllHoveredBlocks);
  document.removeEventListener('mousedown', handleCodeLangOutsideClick);
  document.removeEventListener('mousemove', handleSuggestionMousemove);
  document.querySelector('.wikid-mainframe')?.removeEventListener('scroll', handleMainframeScroll);
  setHandleLocked(false);
  setMainframeScrollLocked(false);
});

const blurEditor = () => {
  activeTableEl.value = null;
  editor.value?.commands.blur();
};

// Puts a whole page in place of what's there (restoring a version). With live editing it's an
// edit like any other, so everyone with the page open sees it, and it can be undone.
const replaceContent = (doc) => {
  const ed = editor.value;
  if (!ed || ed.isDestroyed) return false;
  ed.commands.setContent(editorDocToTiptap(doc), { emitUpdate: true });
  return true;
};

defineExpose({
  replaceContent,
  focusStart,
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
  <div ref="wrapperRef" class="tiptap-wrapper" :class="{ 'tiptap-wrapper--waiting': waitingForContent }">
    <!-- (Hidden while the link editor is open, not over it; kept, not taken out: taking out its
         plugin had live editing redraw the whole page) -->
    <TextBubbleMenu v-if="editor" :class="{ 'bubble-menu--hidden': !!linkEditorState }" :editor="editor" :ai-streaming="aiStreaming" :ai-enabled="workspace.aiEnabled" @ai-action="runAiBubbleAction" @edit-link="openLinkEditor" />
    <Teleport to="body">
      <LinkEditor
        v-if="linkEditorState"
        :anchor="linkEditorState.anchor"
        :text="linkEditorState.text"
        :href="linkEditorState.href"
        :editing="linkEditorState.editing"
        :text-editable="linkEditorState.textEditable"
        :mention="!!linkEditorState.mention"
        :mention-page="linkEditorState.mentionPage || null"
        :pages="linkablePages"
        @save="saveLink"
        @remove="removeLink"
        @close="closeLinkEditor"
      />
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
      <div class="bubble-menu codeblock-bubble-menu" :style="blockBubbleStyle" contenteditable="false">
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
        role="menu"
        aria-label="Block menu"
        tabindex="-1"
        @keydown="handleTuneMenuKeydown"
        :style="{ top: `${tuneMenuPos.top}px`, left: `${tuneMenuPos.left}px`, position: 'fixed', transform: tuneMenuFlipped ? 'translate(0, 0)' : 'translate(-100%, -50%)', zIndex: 2100 }"
      >
        <BlockMenu
          :editor="editor"
          :handle-state="handleState"
          :page-id="pageId"
          :get-resolved-page="getResolvedPage"
          :page-link-attributes="{ getPageLinkAttributeData, loadPageLinkAttributes, pageLinkDatabaseLoading, pageLinkDatabaseErrors }"
          @close="closeTuneMenu"
          @panel-entered="handleTunePanelEntered"
        />
      </div>
    </Teleport>
    <Teleport v-if="shouldShowImageBubble() && hoveredImage?.element" :to="hoveredImage.element">
      <div class="bubble-menu image-bubble-menu" :style="blockBubbleStyle" contenteditable="false">
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
