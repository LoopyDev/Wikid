import { Extension } from '@tiptap/core';
import { Plugin } from 'prosemirror-state';
import { isRemoteCollabChange } from './editorShared';

const INDENT_TYPES = ['paragraph', 'heading'];
const MAX_INDENT = 50;
const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

const clampIndent = (value) => {
  const next = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(MAX_INDENT, next));
};

const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [
      {
        types: INDENT_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const raw = element.getAttribute('data-indent');
              const value = raw ? Number.parseInt(raw, 10) : 0;
              return clampIndent(value);
            },
            renderHTML: (attributes) => {
              const indent = clampIndent(attributes.indent);
              if (!indent) return {};
              return {
                'data-indent': indent,
                style: `--indent-level: ${indent};`,
              };
            },
          },
        },
      },
    ];
  },
  // A line keeps no indent in a list item (Tab there indents the item): an indented paragraph made
  // into a list kept it, its bullet at the edge and its text far off to the right
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, state) => {
          // Not someone else's changes, or a page loading: the lines they touch are theirs to change
          if (!transactions.some((tr) => tr.docChanged) || transactions.some(isRemoteCollabChange)) return null;
          // Only where these changes were
          const ranges = [];
          transactions.forEach((tr, i) => {
            const later = transactions.slice(i + 1);
            tr.steps.forEach((step, s) => {
              step.getMap().forEach((_from, _to, start, end) => {
                let from = start;
                let to = end;
                for (const map of [...tr.mapping.maps.slice(s + 1), ...later.flatMap((next) => next.mapping.maps)]) {
                  from = map.map(from, -1);
                  to = map.map(to, 1);
                }
                ranges.push([from, to]);
              });
            });
          });
          let tr = null;
          const size = state.doc.content.size;
          const fixed = new Set();
          const check = (node, pos, parent) => {
            if (!node?.isTextblock || fixed.has(pos)) return;
            if (node.attrs.indent > 0 && LIST_ITEM_TYPES.has(parent?.type.name)) {
              fixed.add(pos);
              tr = tr || state.tr;
              tr.setNodeMarkup(pos, null, { ...node.attrs, indent: 0 });
            }
          };
          for (const [rawFrom, rawTo] of ranges) {
            const from = Math.max(0, Math.min(size, rawFrom));
            const to = Math.max(from, Math.min(size, rawTo));
            state.doc.nodesBetween(from, to, (node, pos, parent) => {
              check(node, pos, parent);
              return !node.isTextblock;
            });
            // Wrapping a line in a list changes only its edges: the line just inside them
            for (const at of [from, to]) {
              const $at = state.doc.resolve(at);
              const after = $at.nodeAfter;
              if (after?.isTextblock) check(after, at, $at.parent);
              if ($at.parent.isTextblock && $at.depth) check($at.parent, $at.before(), $at.node(-1));
            }
          }
          return tr;
        },
      }),
    ];
  },
});

export { MAX_INDENT, INDENT_TYPES, clampIndent };
export default Indent;
