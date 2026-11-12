import { TextSelection } from 'prosemirror-state';

// Backspace and Enter for a block that holds other blocks (a callout, a toggle heading). It's
// isolating, so the editor's own keys stop at its edges: Backspace after it selected the whole block
// (the next key deleted it), Backspace at its start did nothing, and there was no way out of one.
// `lastLine(node)` is the line Backspace after it joins (the last one showing), or null.
export function containerKeys(name, { lastLine = (node) => node.lastChild } = {}) {
  return {
    Backspace: ({ editor }) => {
      const { state, view } = editor;
      const { selection } = state;
      if (!selection.empty || selection.$from.parentOffset !== 0) return false;
      const $from = selection.$from;
      const depth = $from.depth;
      if (depth < 1) return false;
      // At the start of the line just after it: onto the end of its last line
      const index = $from.index(depth - 1);
      const container = $from.node(depth - 1);
      const before = index > 0 ? container.child(index - 1) : null;
      if (before?.type.name === name) {
        const blockStart = $from.before(depth);
        const beforeStart = blockStart - before.nodeSize;
        const tr = state.tr;
        // A plain line joins that line; anything else (a heading, code) stays as it is, and the cursor
        // goes to the end of that line
        // (only a line of text: after a list or a picture, the cursor goes to the nearest place)
        const line = lastLine(before);
        let lineEnd = null;
        before.forEach((child, offset) => {
          if (child === line && child.isTextblock) lineEnd = beforeStart + 1 + offset + child.nodeSize - 1;
        });
        if (lineEnd !== null && !line.type.spec.code && $from.parent.type.name === 'paragraph') {
          tr.delete(blockStart, $from.after(depth));
          tr.insert(lineEnd, $from.parent.content);
          tr.setSelection(TextSelection.create(tr.doc, lineEnd));
        } else {
          tr.setSelection(lineEnd !== null ? TextSelection.create(tr.doc, lineEnd) : TextSelection.near(tr.doc.resolve(blockStart - 1), -1));
        }
        view.dispatch(tr.scrollIntoView());
        return true;
      }
      // At its start: back to plain lines (one folded opens first, so nothing hidden comes out unseen)
      if (depth >= 2 && $from.node(depth - 1).type.name === name && $from.index(depth - 1) === 0) {
        const outerDepth = depth - 1;
        const start = $from.before(outerDepth);
        const node = $from.node(outerDepth);
        if (node.attrs.collapsed) {
          view.dispatch(state.tr.setNodeMarkup(start, null, { ...node.attrs, collapsed: false }));
          return true;
        }
        const tr = state.tr.replaceWith(start, start + node.nodeSize, node.content);
        tr.setSelection(TextSelection.create(tr.doc, start + 1));
        view.dispatch(tr.scrollIntoView());
        return true;
      }
      return false;
    },
    Enter: ({ editor }) => {
      const { state, view } = editor;
      const { selection } = state;
      if (!selection.empty) return false;
      const $from = selection.$from;
      const depth = $from.depth;
      if (depth < 2) return false;
      const outerDepth = depth - 1;
      const node = $from.node(outerDepth);
      if (node.type.name !== name) return false;
      // An empty last line: it goes, and a new line starts after the block
      const line = $from.parent;
      if (line.type.name !== 'paragraph' || line.content.size || $from.index(outerDepth) !== node.childCount - 1 || node.childCount < 2) return false;
      const lineStart = $from.before(depth);
      const tr = state.tr.delete(lineStart, $from.after(depth));
      const after = tr.mapping.map($from.after(outerDepth));
      tr.insert(after, state.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, after + 1));
      view.dispatch(tr.scrollIntoView());
      return true;
    },
  };
}
