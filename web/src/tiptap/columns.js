import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import ColumnNode from './ColumnNode.vue';

const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  draggable: true,
  selectable: false,
  addAttributes() {
    return {
      width: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-width');
          if (!raw) return null;
          const value = Number.parseFloat(raw);
          return Number.isFinite(value) ? value : null;
        },
        renderHTML: (attributes) => {
          if (typeof attributes.width !== 'number') return {};
          return { 'data-width': attributes.width };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'tiptap-column' }), 0];
  },
  addNodeView() {
    return VueNodeViewRenderer(ColumnNode, {
      update: ({ oldNode, newNode, updateProps }) => {
        if (oldNode.type !== newNode.type) return false;
        if (oldNode.attrs?.width !== newNode.attrs?.width) {
          updateProps();
        }
        return true;
      },
    });
  },
});

const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column+',
  isolating: true,
  defining: true,
  selectable: false,
  draggable: false,
  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'columns', class: 'tiptap-columns' }), 0];
  },
  addExtensions() {
    return [Column];
  },
});

export { Column, Columns };
export default Columns;
