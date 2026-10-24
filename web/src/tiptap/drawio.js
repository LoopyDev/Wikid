import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import DrawioNode from './DrawioNode.vue';

export default Node.create({
  name: 'drawio',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      xml: { default: '' },
      svg: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="drawio"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'drawio' })];
  },
  addNodeView() {
    return VueNodeViewRenderer(DrawioNode);
  },
});
