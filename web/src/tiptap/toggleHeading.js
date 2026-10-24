import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import ToggleHeadingNode from './ToggleHeadingNode.vue';

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
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-heading' })];
  },
  addNodeView() {
    return VueNodeViewRenderer(ToggleHeadingNode);
  },
});
