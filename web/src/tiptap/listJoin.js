import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { canJoin } from 'prosemirror-transform';
import { isRemoteCollabChange } from './editorShared';

// Two lists of the same kind left next to each other become one. Removing the empty line between
// them (backspace on an emptied bullet, then again) left two lists that looked like one, and
// Tab couldn't indent the first item of the second: it has no item above it in its own list.
// Only lists next to what an edit changed, so separate lists elsewhere on a page stay as they are,
// and only for your own edits: someone else's arrive already joined.

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

export const listJoinKey = new PluginKey('list-join');

/** Where two lists of the same kind meet, within reach of the ranges an edit changed. */
export function adjacentListJoins(doc, changedRanges) {
  const joins = [];
  const nearChange = (pos) => changedRanges.some(([from, to]) => pos >= from - 2 && pos <= to + 2);
  const visit = (node, offset) => {
    let previous = null;
    node.forEach((child, childOffset) => {
      const pos = offset + childOffset;
      if (previous && LIST_TYPES.has(child.type.name) && child.type === previous.type && nearChange(pos)) {
        joins.push(pos);
      }
      previous = child;
      if (!child.isTextblock && child.childCount) visit(child, pos + 1);
    });
  };
  visit(doc, 0);
  return joins;
}

export const ListJoin = Extension.create({
  name: 'listJoin',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: listJoinKey,
        appendTransaction(transactions, _oldState, newState) {
          const local = transactions.filter((tr) => tr.docChanged && !isRemoteCollabChange(tr));
          if (!local.length) return null;
          // What changed, as positions in the document now
          const ranges = [];
          transactions.forEach((tr, index) => {
            tr.mapping.maps.forEach((map, mapIndex) => {
              map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
                let from = newStart;
                let to = newEnd;
                // On through this transaction's later steps and the transactions after it
                for (const later of tr.mapping.maps.slice(mapIndex + 1)) {
                  from = later.map(from, -1);
                  to = later.map(to, 1);
                }
                for (const next of transactions.slice(index + 1)) {
                  from = next.mapping.map(from, -1);
                  to = next.mapping.map(to, 1);
                }
                ranges.push([from, to]);
              });
            });
          });
          const joins = adjacentListJoins(newState.doc, ranges);
          if (!joins.length) return null;
          const tr = newState.tr;
          // From the end, so earlier positions still hold
          for (const pos of joins.sort((a, b) => b - a)) {
            if (canJoin(tr.doc, pos)) tr.join(pos);
          }
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
