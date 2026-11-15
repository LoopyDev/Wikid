import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

// How the editor marks what's selected, beyond the text the browser marks itself:
// - the block whose menu is open gets "tiptap-block-selected" (set with setMenuBlock). It was a class
//   added to the block's element by hand, which the editor's next redraw of a paragraph or heading
//   took off again at once, so only images and the like ever showed it;
// - each block that isn't text (an image, a diagram, a divider, an embedded database or page link)
//   wholly inside a larger selection gets "tiptap-in-selection": the browser showed nothing for those.

export const selectionMarksKey = new PluginKey('selectionMarks');

/** Marks the block at `pos` as the one whose menu is open (null: none). */
export const setMenuBlock = (view, pos) => {
  if (!view || view.isDestroyed) return;
  const current = selectionMarksKey.getState(view.state)?.menu?.pos ?? null;
  if (current === pos) return;
  view.dispatch(view.state.tr.setMeta(selectionMarksKey, { menuBlock: pos }).setMeta('addToHistory', false));
};

// The menu's block, by its id where it has one: a change from someone else (or an undo) puts in a
// new copy of a block that's changed, which its position alone would lose
const menuBlockAt = (doc, pos) => {
  if (pos == null || pos < 0 || pos >= doc.content.size) return null;
  const node = doc.nodeAt(pos);
  return node && !node.isText ? { pos, id: node.attrs?.id ?? null } : null;
};
const findBlockById = (doc, id) => {
  let found = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs?.id === id && !node.isText) {
      found = pos;
      return false;
    }
    return !node.isTextblock;
  });
  return found;
};

const decorationsFor = (state, menu) => {
  const { selection, doc } = state;
  const decorations = [];
  if (menu) {
    const node = doc.nodeAt(menu.pos);
    if (node) decorations.push(Decoration.node(menu.pos, menu.pos + node.nodeSize, { class: 'tiptap-block-selected' }));
  }
  // (A block selected on its own is marked by its own "selected" look)
  if (!selection.empty && !(selection instanceof NodeSelection)) {
    doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (node.isTextblock || node.isText) return false;
      if (node.isAtom && !node.isInline && pos >= selection.from && pos + node.nodeSize <= selection.to) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'tiptap-in-selection' }));
        return false;
      }
      return true;
    });
  }
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
};

export const SelectionMarks = Extension.create({
  name: 'selectionMarks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: selectionMarksKey,
        state: {
          init: (_, state) => ({ menu: null, decorations: decorationsFor(state, null) }),
          apply(tr, value, oldState, newState) {
            const meta = tr.getMeta(selectionMarksKey);
            let { menu } = value;
            if (meta && 'menuBlock' in meta) menu = menuBlockAt(newState.doc, meta.menuBlock);
            else if (menu && tr.docChanged) {
              // The same block, found by its id; or where its position has moved to
              const byId = menu.id != null ? findBlockById(newState.doc, menu.id) : null;
              const mapped = tr.mapping.mapResult(menu.pos, 1);
              const pos = byId ?? (mapped.deleted ? null : mapped.pos);
              menu = pos == null ? null : menuBlockAt(newState.doc, pos);
              if (menu && menu.id !== value.menu.id && value.menu.id != null) menu = null;
            }
            // Worked out again only when something it shows could have changed
            if (menu === value.menu && !tr.docChanged && !tr.selectionSet) return value;
            return { menu, decorations: decorationsFor(newState, menu) };
          },
        },
        props: {
          decorations: (state) => selectionMarksKey.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});
