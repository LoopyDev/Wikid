import { ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap';
import { SYNCED_FROM_ATTR } from '../tiptap/editorShared';

// Optional debug logging for the editor, switched on per area from the browser console.

export const undoDebugEnabled = () =>
  typeof window !== 'undefined' && window.localStorage?.getItem('wikid:debug-undo') === '1';

export const logUndoDebug = (...args) => {
  if (undoDebugEnabled()) {
    console.log('[undo-debug]', ...args);
  }
};

export const describeUndoOrigin = (origin, undoManager) => {
  if (origin === ySyncPluginKey) return 'ySyncPluginKey';
  if (origin === undoManager) return 'undoManager';
  if (origin === null || origin === undefined) return 'null';
  if (typeof origin === 'string') return origin;
  if (typeof origin === 'number' || typeof origin === 'boolean') return String(origin);
  if (origin && typeof origin === 'object') {
    return origin.constructor?.name || 'object';
  }
  return typeof origin;
};

export const describeUndoStacks = (state) => {
  const undoState = state ? yUndoPluginKey.getState(state) : null;
  const undoManager = undoState?.undoManager || null;
  return {
    undo: undoManager?.undoStack?.length ?? null,
    redo: undoManager?.redoStack?.length ?? null,
  };
};

export const setupDebugEnabled = () =>
  typeof window !== 'undefined' && window.localStorage?.getItem('wikid:debug-setup') === '1';

export const logSetup = (...args) => {
  if (setupDebugEnabled()) {
    console.log('[setup-collab]', ...args);
  }
};

export const blockDebugEnabled = () =>
  typeof window !== 'undefined' && window.localStorage?.getItem('wikid:debug-blocks') === '1';

export const logBlockDebug = (...args) => {
  if (blockDebugEnabled()) {
    console.log('[block-debug]', ...args);
  }
};

export const collectDuplicateBlockDetails = (pmDoc) => {
  if (!pmDoc?.descendants) return [];
  const occurrences = new Map();
  pmDoc.descendants((node, pos) => {
    if (!node.isBlock) return;
    const id = node.attrs?.id;
    if (typeof id !== 'string' || !id) return;
    const list = occurrences.get(id) || [];
    list.push({
      pos,
      type: node.type?.name || 'unknown',
      syncedFrom: node.attrs?.[SYNCED_FROM_ATTR] || null,
      text: node.textContent ? node.textContent.trim().slice(0, 80) : '',
    });
    occurrences.set(id, list);
  });
  const duplicates = [];
  occurrences.forEach((entries, id) => {
    if (entries.length > 1) {
      duplicates.push({ id, entries });
    }
  });
  return duplicates;
};

export const logDuplicateBlockDetails = (label, pmDoc) => {
  if (!blockDebugEnabled()) return;
  const duplicates = collectDuplicateBlockDetails(pmDoc);
  if (!duplicates.length) return;
  logBlockDebug(label, duplicates.slice(0, 4));
};

export const extractTextFromNode = (node) => {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (Array.isArray(node.content)) return node.content.map(extractTextFromNode).join('');
  return '';
};

export const summarizeBlockStats = (doc) => {
  const seenIds = new Set();
  const duplicateIds = new Set();
  const duplicateParagraphs = new Set();
  let blocks = 0;
  let paragraphs = 0;
  let lastParagraphText = null;

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type) {
      blocks += 1;
      const id = node.attrs?.id;
      if (typeof id === 'string' && id) {
        if (seenIds.has(id)) duplicateIds.add(id);
        seenIds.add(id);
      }
      if (node.type === 'paragraph') {
        paragraphs += 1;
        const text = extractTextFromNode(node).trim();
        if (text) {
          if (text === lastParagraphText) {
            duplicateParagraphs.add(text);
          }
          lastParagraphText = text;
        } else {
          lastParagraphText = null;
        }
      }
    }
    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
    }
  };

  walk(doc);
  return {
    blocks,
    paragraphs,
    duplicateIds: Array.from(duplicateIds).slice(0, 6),
    duplicateParagraphs: Array.from(duplicateParagraphs).slice(0, 6),
  };
};
