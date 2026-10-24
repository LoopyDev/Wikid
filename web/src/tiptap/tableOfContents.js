import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import TableOfContentsNode from './TableOfContentsNode.vue';

export default Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'table-of-contents' })];
  },
  addNodeView() {
    return VueNodeViewRenderer(TableOfContentsNode);
  },
});
