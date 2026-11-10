import { Node, mergeAttributes } from '@tiptap/core';
import { TextSelection } from 'prosemirror-state';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import CalloutNode from './CalloutNode.vue';
import { stringAttr } from './attribute-helpers';

export default Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      icon: { default: '💡' },
      tone: stringAttr('tone'),
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' })];
  },
  addNodeView() {
    return VueNodeViewRenderer(CalloutNode);
  },
  // A callout is isolating, so the editor's own Backspace and Enter stop at its edges: Backspace after
  // it selected the whole callout (the next key deleted it), and there was no way out of one
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        if (!selection.empty || selection.$from.parentOffset !== 0) return false;
        const $from = selection.$from;
        const depth = $from.depth;
        if (depth < 1) return false;
        // At the start of the line just after a callout: onto the end of its last line
        const index = $from.index(depth - 1);
        const container = $from.node(depth - 1);
        const before = index > 0 ? container.child(index - 1) : null;
        if (before?.type.name === this.name) {
          const blockStart = $from.before(depth);
          const last = before.lastChild;
          const tr = state.tr;
          // A plain line joins its last line; anything else (a heading, code) stays as it is, and
          // the cursor goes to the end of the callout
          if (last?.isTextblock && $from.parent.type.name === 'paragraph' && last.type.name === 'paragraph') {
            const end = blockStart - 2; // inside its last line, at the end
            tr.delete(blockStart, $from.after(depth));
            tr.insert(end, $from.parent.content);
            tr.setSelection(TextSelection.create(tr.doc, end));
          } else {
            tr.setSelection(TextSelection.near(tr.doc.resolve(blockStart - 1), -1));
          }
          view.dispatch(tr.scrollIntoView());
          return true;
        }
        // At the start of a callout: back to plain lines
        if (depth >= 2 && $from.node(depth - 1).type.name === this.name && $from.index(depth - 1) === 0) {
          const calloutDepth = depth - 1;
          const start = $from.before(calloutDepth);
          const callout = $from.node(calloutDepth);
          const tr = state.tr.replaceWith(start, start + callout.nodeSize, callout.content);
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
        const calloutDepth = depth - 1;
        const callout = $from.node(calloutDepth);
        if (callout.type.name !== this.name) return false;
        // An empty last line: it goes, and a new line starts after the callout
        const line = $from.parent;
        if (line.type.name !== 'paragraph' || line.content.size || $from.index(calloutDepth) !== callout.childCount - 1 || callout.childCount < 2) return false;
        const lineStart = $from.before(depth);
        const tr = state.tr.delete(lineStart, $from.after(depth));
        const after = tr.mapping.map($from.after(calloutDepth));
        tr.insert(after, state.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, after + 1));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});
