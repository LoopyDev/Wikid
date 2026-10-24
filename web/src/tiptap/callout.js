import { Node, mergeAttributes } from '@tiptap/core';
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
});
