import { Extension } from '@tiptap/core';
import { Plugin, TextSelection } from 'prosemirror-state';
import { Mapping } from 'prosemirror-transform';
import { findTextblockAtSelection, isRemoteCollabChange, summarizeSteps } from './editorShared';

// Puts the cursor back when the browser moves it unexpectedly while typing.

export const selectionDebugEnabled = () =>
  typeof window !== 'undefined' && window.localStorage?.getItem('wikid:debug-selection') === '1';

export const logSelectionDebug = (...args) => {
  if (selectionDebugEnabled()) {
    console.log('[selection-debug]', ...args);
  }
};

export const findBlockAtSelection = (state) => {
  if (!state?.selection) return null;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node?.isBlock) {
      return { node, pos: $from.before(depth) };
    }
  }
  return null;
};

export const describeBlock = (block) => {
  if (!block?.node) return null;
  const nodeSize = block.node.nodeSize || 0;
  const start = block.pos + 1;
  const end = block.pos + nodeSize - 1;
  return {
    pos: block.pos,
    type: block.node.type?.name || null,
    id: block.node.attrs?.id || null,
    isTextblock: !!block.node.isTextblock,
    isLeaf: !!block.node.isLeaf,
    nodeSize,
    range: Number.isFinite(nodeSize) && nodeSize > 0 ? { start, end } : null,
    text: block.node.isTextblock ? (block.node.textContent || '').slice(0, 60) : '',
  };
};

export const describeSelection = (state) => {
  if (!state?.selection) return null;
  const { from, to, empty, $from } = state.selection;
  const parent = $from?.parent;
  const parentOffset = $from?.parentOffset;
  const parentSize = parent?.content?.size ?? null;
  return {
    from,
    to,
    empty,
    depth: $from?.depth ?? null,
    parent: parent?.type?.name || null,
    parentOffset,
    atStart: parentOffset === 0,
    atEnd: typeof parentSize === 'number' ? parentOffset === parentSize : false,
  };
};

export const createInputSelectionGuardExtension = ({ lastTextInputAt, lastTextInputInfo }) => Extension.create({
  name: 'input-selection-guard',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, oldState, newState) {
          const hasDocChange = transactions.some((tr) => tr.docChanged);
          if (!hasDocChange) return null;
          if (transactions.some(isRemoteCollabChange)) return null;
          const debug = selectionDebugEnabled();
          const oldBlock = findBlockAtSelection(oldState);
          const newBlock = findBlockAtSelection(newState);
          const selectionShifted = oldBlock?.pos !== newBlock?.pos;
          const typingAgeMs = lastTextInputAt.value ? Date.now() - lastTextInputAt.value : null;
          const hasTextInput = transactions.some((tr) => {
            const inputType = tr.getMeta('inputType');
            if (typeof inputType === 'string') {
              return inputType.startsWith('insert') || inputType === 'insertText' || inputType === 'insertCompositionText';
            }
            return tr.getMeta('uiEvent') === 'input';
          });
          const treatAsTyping = hasTextInput || (typingAgeMs != null && typingAgeMs < 60);
          const hasBlockInsertion = transactions.some((tr) =>
            tr.steps.some((step) => {
              const slice = step?.slice;
              if (!slice?.content) return false;
              let inlineOnly = true;
              slice.content.forEach((node) => {
                if (!node.isInline) inlineOnly = false;
              });
              return !inlineOnly;
            })
          );
          if (debug && selectionShifted) {
            let mappedOld = null;
            if (oldBlock?.pos != null) {
              const mapping = new Mapping();
              transactions.forEach((tr) => mapping.appendMap(tr.mapping));
              const mapped = mapping.mapResult(oldBlock.pos);
              const mappedNode = !mapped.deleted ? newState.doc.nodeAt(mapped.pos) : null;
              mappedOld = {
                pos: mapped.pos,
                deleted: mapped.deleted,
                block: mappedNode ? describeBlock({ node: mappedNode, pos: mapped.pos }) : null,
              };
            }
            logSelectionDebug('selection-shift', {
              hasTextInput,
              hasBlockInsertion,
              typingAgeMs,
              lastTextInputInfo: lastTextInputInfo.value,
              oldSelection: { from: oldState.selection.from, to: oldState.selection.to, empty: oldState.selection.empty },
              newSelection: { from: newState.selection.from, to: newState.selection.to, empty: newState.selection.empty },
              oldSelectionInfo: describeSelection(oldState),
              newSelectionInfo: describeSelection(newState),
              oldBlock: describeBlock(oldBlock),
              newBlock: describeBlock(newBlock),
              mappedOldBlock: mappedOld,
              meta: summarizeSteps(transactions),
              metaJson: JSON.stringify(summarizeSteps(transactions)),
            });
          }
          // A new block (Enter, pasted blocks) moves the cursor on purpose
          if (hasBlockInsertion) return null;
          if (!(oldState.selection instanceof TextSelection) || !oldState.selection.empty) {
            if (debug && selectionShifted) {
              logSelectionDebug('guard-skip', { reason: 'non-text-selection' });
            }
            return null;
          }
          if (!treatAsTyping) {
            if (debug && selectionShifted) {
              logSelectionDebug('guard-skip', { reason: 'no-typing-signal', typingAgeMs });
            }
            return null;
          }

          const oldTextblock = findTextblockAtSelection(oldState);
          if (!oldTextblock) {
            if (debug && selectionShifted) {
              logSelectionDebug('guard-skip', { reason: 'no-old-textblock' });
            }
            return null;
          }

          const mapping = new Mapping();
          transactions.forEach((tr) => mapping.appendMap(tr.mapping));
          const mappedBlock = mapping.mapResult(oldTextblock.pos);
          const oldOffset = Math.max(0, oldState.selection.from - (oldTextblock.pos + 1));
          if (mappedBlock.deleted) {
            const replacement = newState.doc.nodeAt(oldTextblock.pos);
            if (!replacement?.isTextblock) {
              if (debug && selectionShifted) {
                logSelectionDebug('guard-skip', { reason: 'old-textblock-deleted' });
              }
              return null;
            }
            const start = oldTextblock.pos + 1;
            const end = oldTextblock.pos + replacement.nodeSize - 1;
            const target = Math.max(start, Math.min(start + oldOffset, end));
            if (debug) {
              logSelectionDebug('selection-restore', {
                target,
                mappedBlock: { pos: oldTextblock.pos, start, end },
                oldSelection: { from: oldState.selection.from, to: oldState.selection.to },
                newSelection: { from: newState.selection.from, to: newState.selection.to },
                recovery: 'replacement-at-old-pos',
              });
            }
            return newState.tr.setSelection(TextSelection.create(newState.doc, target));
          }
          const node = newState.doc.nodeAt(mappedBlock.pos);
          if (!node?.isTextblock) {
            if (debug && selectionShifted) {
              logSelectionDebug('guard-skip', { reason: 'mapped-node-not-textblock' });
            }
            return null;
          }

          const start = mappedBlock.pos + 1;
          const end = mappedBlock.pos + node.nodeSize - 1;
          const { from, to } = newState.selection;
          if (from >= start && to <= end) return null;

          const mappedHead = mapping.map(oldState.selection.from);
          const target = Math.max(start, Math.min(mappedHead, end));
          if (debug) {
            logSelectionDebug('selection-restore', {
              target,
              mappedBlock: { pos: mappedBlock.pos, start, end },
              oldSelection: { from: oldState.selection.from, to: oldState.selection.to },
              newSelection: { from, to },
            });
          }
          return newState.tr.setSelection(TextSelection.create(newState.doc, target));
        },
      }),
    ];
  },
});
