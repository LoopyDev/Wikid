import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import DatabaseViewNode from './DatabaseViewNode.vue';
import { stringAttr, jsonAttr } from './attribute-helpers';

export default Node.create({
  name: 'databaseView',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,
  addOptions() {
    return {
      resolvePage: null,
      listDatabasePages: null,
      createDatabasePage: null,
      openPage: null,
      restorePage: null,
    };
  },
  addAttributes() {
    return {
      pageId: stringAttr('pageId'),
      title: stringAttr('title'),
      icon: stringAttr('icon'),
      view: jsonAttr('view'),
      viewId: stringAttr('viewId'),
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="database-view"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'database-view' })];
  },
  addNodeView() {
    return VueNodeViewRenderer(DatabaseViewNode);
  },
});
