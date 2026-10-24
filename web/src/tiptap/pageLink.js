import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import PageLinkNode from './PageLinkNode.vue';

export default Node.create({
  name: 'pageLink',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,
  addOptions() {
    return {
      resolvePage: null,
      createChildPage: null,
      listWorkspacePages: null,
      openPage: null,
      deletePage: null,
      restorePage: null,
      getSubpageCount: null,
      getPageLinkAttributeData: null,
      loadPageLinkAttributes: null,
    };
  },
  addAttributes() {
    return {
      pageId: { default: '' },
      title: { default: '' },
      icon: { default: '' },
      subpageCount: { default: null },
      style: { default: 'card' },
      attribute: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="page-link"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page-link' })];
  },
  addNodeView() {
    return VueNodeViewRenderer(PageLinkNode);
  },
});
