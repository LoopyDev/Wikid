import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import GaussianSplatNode from './GaussianSplatNode.vue';

export default Node.create({
  name: 'gaussianSplat',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: '' },
      preview: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="gaussianSplat"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'gaussianSplat' })];
  },
  addNodeView() {
    return VueNodeViewRenderer(GaussianSplatNode);
  },
});
