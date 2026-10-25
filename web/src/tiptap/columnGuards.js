import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, Selection } from 'prosemirror-state';
import { Mapping } from 'prosemirror-transform';
import { ORIGIN_META_KEY, findColumnAncestor, findTextblockAtSelection, isEmptyParagraph, isRemoteCollabChange, summarizeSteps } from './editorShared';

// Keeps columns well-formed: removes empty columns and stops typing from spilling out of a column.

export const isEmptyColumn = (columnNode) => {
  if (!columnNode || columnNode.type?.name !== 'column') return false;
  if (columnNode.childCount === 0) return true;
  if (columnNode.childCount > 1) return false;
  return isEmptyParagraph(columnNode.child(0));
};

export const columnCleanupKey = new PluginKey('column-cleanup');

export const columnInputGuardKey = new PluginKey('column-input-guard');

export const columnDebugEnabled = () =>
  typeof window !== 'undefined' && window.localStorage?.getItem('wikid:debug-columns') === '1';

export const logColumnDebug = (...args) => {
  if (columnDebugEnabled()) {
    console.log('[column-debug]', ...args);
  }
};

export const isInlineSlice = (slice) => {
  if (!slice?.content) return false;
  let inlineOnly = true;
  slice.content.forEach((node) => {
    if (!node.isInline) {
      inlineOnly = false;
    }
  });
  return inlineOnly;
};

export const resolveColumnSelection = (state, columnPos, preferPos) => {
  if (!state || typeof columnPos !== 'number') return null;
  const columnNode = state.doc.nodeAt(columnPos);
  if (!columnNode || columnNode.type?.name !== 'column') return null;
  const minPos = columnPos + 1;
  const maxPos = columnPos + columnNode.nodeSize - 1;
  const target = Number.isFinite(preferPos)
    ? Math.max(minPos, Math.min(preferPos, Math.max(minPos, maxPos - 1)))
    : minPos;
  let best = null;
  let bestDistance = Infinity;
  columnNode.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const docPos = columnPos + 1 + pos;
    const start = docPos + 1;
    const end = docPos + node.nodeSize - 1;
    const insidePos = Math.min(Math.max(target, start), end);
    const distance = Math.abs(insidePos - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = insidePos;
    }
  });
  if (best != null) {
    return TextSelection.create(state.doc, best);
  }
  return Selection.near(state.doc.resolve(target), 1);
};

export const ColumnCleanupExtension = Extension.create({
  name: 'column-cleanup',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: columnCleanupKey,
        state: {
          init: () => ({ pending: null }),
          apply(tr, value) {
            let pending = value.pending;
            const meta = tr.getMeta(columnCleanupKey);
            if (meta?.clear) {
              return { pending: null };
            }
            if (meta?.pending) {
              pending = meta.pending;
            }
            if (pending && typeof pending.pos === 'number') {
              const mapped = tr.mapping.mapResult(pending.pos);
              if (mapped.deleted) {
                pending = null;
              } else if (mapped.pos !== pending.pos) {
                pending = { ...pending, pos: mapped.pos };
              }
            }
            return { pending };
          },
        },
        appendTransaction(transactions, _oldState, newState) {
          const hadDocChange = transactions.some((tr) => tr.docChanged);
          if (!hadDocChange) return null;
          const pluginState = columnCleanupKey.getState(newState) || { pending: null };
          const pending = pluginState.pending;
          if (!pending || typeof pending.pos !== 'number') return null;
          const columnPos = pending.pos;
          const columnNode = newState.doc.nodeAt(columnPos);
          if (!columnNode || columnNode.type?.name !== 'column') {
            return newState.tr.setMeta(columnCleanupKey, { clear: true });
          }
          if (!isEmptyColumn(columnNode)) {
            return newState.tr.setMeta(columnCleanupKey, { clear: true });
          }
          const $pos = newState.doc.resolve(columnPos);
          const columnsNode = $pos.parent;
          const columnsPos = $pos.before($pos.depth);
          let tr = newState.tr.delete(columnPos, columnPos + columnNode.nodeSize);
          if (columnsNode?.type?.name === 'columns') {
            const mappedColumnsPos = tr.mapping.map(columnsPos);
            const updatedColumns = tr.doc.nodeAt(mappedColumnsPos);
            if (updatedColumns?.type?.name === 'columns' && updatedColumns.childCount <= 1) {
              const remainingColumn = updatedColumns.childCount === 1 ? updatedColumns.child(0) : null;
              const replacement = remainingColumn?.content?.size
                ? remainingColumn.content
                : newState.schema.nodes.paragraph?.create();
              if (replacement) {
                tr = tr.replaceWith(mappedColumnsPos, mappedColumnsPos + updatedColumns.nodeSize, replacement);
              } else {
                tr = tr.delete(mappedColumnsPos, mappedColumnsPos + updatedColumns.nodeSize);
              }
            }
          }
          tr.setMeta(columnCleanupKey, { clear: true });
          tr.setMeta(ORIGIN_META_KEY, 'column-cleanup');
          return tr;
        },
      }),
    ];
  },
});

export const ColumnInputGuardExtension = Extension.create({
  name: 'column-input-guard',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: columnInputGuardKey,
        appendTransaction(transactions, oldState, newState) {
          const debug = columnDebugEnabled();
          const hasDocChange = transactions.some((tr) => tr.docChanged);
          const oldColumn = findColumnAncestor(oldState, oldState.selection.from);
          const newColumn = findColumnAncestor(newState, newState.selection.from);
          if (debug && oldColumn?.pos !== newColumn?.pos) {
            logColumnDebug('selection-shift', {
              hasDocChange,
              from: oldColumn?.pos ?? null,
              to: newColumn?.pos ?? null,
              selection: {
                old: oldState.selection.from,
                next: newState.selection.from,
              },
              diff: {
                start: oldState.doc.content.findDiffStart(newState.doc.content),
                end: oldState.doc.content.findDiffEnd(newState.doc.content),
              },
              meta: summarizeSteps(transactions),
            });
          }

          if (!hasDocChange) return null;
          if (transactions.some(isRemoteCollabChange)) return null;
          if (!oldColumn) return null;

          const mapping = new Mapping();
          transactions.forEach((tr) => mapping.appendMap(tr.mapping));
          let hasBlockInsertion = false;
          let hasSplitInput = false;
          transactions.forEach((tr) => {
            const inputType = tr.getMeta('inputType');
            if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
              hasSplitInput = true;
            }
            if (!hasBlockInsertion) {
              tr.steps.forEach((step) => {
                const slice = step?.slice;
                if (!slice?.content) return;
                if (!isInlineSlice(slice)) {
                  hasBlockInsertion = true;
                }
              });
            }
          });
          const mappedColumn = mapping.mapResult(oldColumn.pos);
          if (mappedColumn.deleted) return null;
          const columnNode = newState.doc.nodeAt(mappedColumn.pos);
          if (!columnNode || columnNode.type?.name !== 'column') return null;

          const mappedFrom = mapping.map(oldState.selection.from);
          const oldColumnOffset = oldState.selection.from - (oldColumn.pos + 1);
          let preferPos = mappedColumn.pos + 1 + Math.max(0, Math.min(oldColumnOffset, columnNode.content.size));
          let usedTextblockFallback = false;
          let mappedTextblockPos = null;
          const oldTextblock = findTextblockAtSelection(oldState);
          if (oldTextblock) {
            const mappedBlock = mapping.mapResult(oldTextblock.pos);
            if (!mappedBlock.deleted) {
              mappedTextblockPos = mappedBlock.pos;
              const newBlock = newState.doc.nodeAt(mappedBlock.pos);
              if (newBlock?.isTextblock) {
                const oldOffset = Math.max(0, oldState.selection.from - (oldTextblock.pos + 1));
                const oldSize = oldTextblock.node.content.size;
                const newSize = newBlock.content.size;
                const delta = newSize - oldSize;
                const expectedOffset = Math.max(
                  0,
                  Math.min(newBlock.content.size, oldOffset + delta)
                );
                preferPos = mappedBlock.pos + 1 + expectedOffset;
                usedTextblockFallback = true;
              }
            }
          }
          const newTextblock = findTextblockAtSelection(newState);
          const textblockChanged = mappedTextblockPos != null
            && newTextblock?.pos != null
            && mappedTextblockPos !== newTextblock.pos;
          if (newColumn?.pos === mappedColumn.pos) {
            if (oldState.selection.empty && newState.selection.empty) {
              if (textblockChanged && (hasBlockInsertion || hasSplitInput)) {
                return null;
              }
              const expectedSelection = resolveColumnSelection(newState, mappedColumn.pos, preferPos);
              if (!expectedSelection) return null;
              const drift = Math.abs(newState.selection.from - expectedSelection.from);
              if (drift >= 4) {
                logColumnDebug('caret-drift', {
                  mappedFrom,
                  from: newState.selection.from,
                  expected: expectedSelection.from,
                  drift,
                  fallback: usedTextblockFallback,
                });
                return newState.tr.setSelection(expectedSelection);
              }
            }
            return null;
          }

          const nextSelection = resolveColumnSelection(newState, mappedColumn.pos, preferPos);
          if (!nextSelection) return null;

          const diffStart = oldState.doc.content.findDiffStart(newState.doc.content);
          const diffEnd = oldState.doc.content.findDiffEnd(newState.doc.content);
          const newRange = diffStart == null || !diffEnd ? null : { from: diffStart, to: diffEnd.b };
          const oldRange = diffStart == null || !diffEnd ? null : { from: diffStart, to: diffEnd.a };
          const insertedSlice = newRange ? newState.doc.slice(newRange.from, newRange.to) : null;
          const insertionColumn = newRange ? findColumnAncestor(newState, newRange.from) : null;
          const canMove =
            insertedSlice
            && isInlineSlice(insertedSlice)
            && newRange
            && oldRange
            && oldRange.from === oldRange.to
            && newRange.from !== newRange.to
            && insertionColumn
            && insertionColumn.pos !== mappedColumn.pos;

          logColumnDebug('input-jump', {
            from: oldColumn.pos,
            to: newColumn?.pos ?? null,
            mappedColumn: mappedColumn.pos,
            selection: { old: oldState.selection.from, mapped: mappedFrom, prefer: preferPos },
            fallback: usedTextblockFallback,
            diff: { newRange, oldRange },
            canMove,
          });

          if (canMove) {
            let tr = newState.tr.delete(newRange.from, newRange.to);
            const insertAt = Math.max(
              mappedColumn.pos + 1,
              Math.min(tr.mapping.map(mappedFrom), mappedColumn.pos + columnNode.nodeSize - 1)
            );
            tr = tr.replaceRange(insertAt, insertAt, insertedSlice);
            const head = Math.min(tr.doc.content.size, insertAt + insertedSlice.content.size);
            const repairedSelection = resolveColumnSelection(tr, mappedColumn.pos, head);
            if (repairedSelection) {
              tr = tr.setSelection(repairedSelection);
            }
            logColumnDebug('input-repair', {
              from: newRange.from,
              to: newRange.to,
              insertAt,
            });
            return tr;
          }

          return newState.tr.setSelection(nextSelection);
        },
      }),
    ];
  },
});
