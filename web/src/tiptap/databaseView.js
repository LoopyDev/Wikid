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
      // The id of the page this editor shows, so a person's own view of a block can be remembered
      getHostPageId: null,
    };
  },
  addAttributes() {
    return {
      pageId: stringAttr('pageId'),
      title: stringAttr('title'),
      icon: stringAttr('icon'),
      view: jsonAttr('view'),
      viewId: stringAttr('viewId'),
      // The database's title above the table (on unless turned off from the block menu)
      showTitle: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-show-title') !== 'false',
        renderHTML: (attributes) => (attributes.showTitle === false ? { 'data-show-title': 'false' } : {}),
      },
      // The view picker, Columns and search above the table (off for a fixed, clean table)
      showControls: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-show-controls') !== 'false',
        renderHTML: (attributes) => (attributes.showControls === false ? { 'data-show-controls': 'false' } : {}),
      },
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
