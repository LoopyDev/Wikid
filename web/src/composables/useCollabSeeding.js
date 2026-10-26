import { ref } from 'vue';
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import { BLOCK_ID_TYPES, isEmptyParagraphNode, parseBlockIdCounter } from '../tiptap/blockIds';
import { blockDebugEnabled, logBlockDebug, logSetup, summarizeBlockStats } from '../utils/editorDebug';
import { editorDocToTiptap } from '../utils/editorDoc';
import { findBlockById } from '../tiptap/syncedBlocks';

// Fills a page's live-editing document the first time it's opened: from the page's saved
// content (or the seed the page was set up with), once, and tidies block ids afterwards.
export function useCollabSeeding({ props, isCollabEnabled, collabDoc, collabField, collabMetaKey, currentDocName, getEditor }) {
  const initialContentSeeded = ref(false);
  const setupSeededAfterSync = ref(false);
  const initialAutoBlockId = ref(null);
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
    if (!getEditor() || !initialAutoBlockId.value) return;
    const { state, view } = getEditor();
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
  const seedCollabDocFromProps = (target = getEditor(), options = {}) => {
    const instance = target || getEditor();
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
    if (!getEditor() || props.readonly) return false;
    const { state, view } = getEditor();
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

  return { captureInitialAutoBlock, dedupeBlockIds, getCollabDocSnapshot, hasTiptapContent, initialContentSeeded, isCollabInitialized, logBlockSummary, markCollabInitialized, pruneInitialAutoBlock, resolveSeedDoc, seedCollabDocFromProps, setupSeededAfterSync };
}
