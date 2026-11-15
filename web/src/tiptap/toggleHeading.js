import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import ToggleHeadingNode from './ToggleHeadingNode.vue';
import { containerKeys } from './containerKeys';

export default Node.create({
  name: 'toggleHeading',
  group: 'block',
  content: 'heading block*',
  defining: true,
  isolating: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
        renderHTML: (attributes) => (attributes.collapsed ? { 'data-collapsed': 'true' } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="toggle-heading"]' }];
  },
  // With what's in it (0): copied without it, a toggle pasted came in empty
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-heading' }), 0];
  },
  addNodeView() {
    return VueNodeViewRenderer(ToggleHeadingNode);
  },
  // Backspace after one joins its last line showing (its heading while it's folded)
  addKeyboardShortcuts() {
    return containerKeys(this.name, { lastLine: (node) => (node.attrs.collapsed ? node.firstChild : node.lastChild) });
  },
});
