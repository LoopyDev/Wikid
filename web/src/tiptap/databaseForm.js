import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import DatabaseFormNode from './DatabaseFormNode.vue';

export default Node.create({
  name: 'databaseForm',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,
  addOptions() {
    return {
      listDatabasePages: null,
    };
  },
  addAttributes() {
    return {
      formId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-form-id') || '',
        renderHTML: (attrs) => (attrs.formId ? { 'data-form-id': attrs.formId } : {}),
      },
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-form-name') || '',
        renderHTML: (attrs) => (attrs.name ? { 'data-form-name': attrs.name } : {}),
      },
      icon: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-form-icon') || '',
        renderHTML: (attrs) => (attrs.icon ? { 'data-form-icon': attrs.icon } : {}),
      },
      databasePageId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-database-page-id') || '',
        renderHTML: (attrs) => (attrs.databasePageId ? { 'data-database-page-id': attrs.databasePageId } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="database-form"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'database-form' })];
  },
  addNodeView() {
    return VueNodeViewRenderer(DatabaseFormNode);
  },
});
