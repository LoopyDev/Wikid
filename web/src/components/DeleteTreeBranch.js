import { defineComponent, h } from 'vue';

// The nested list of sub-pages shown in the delete dialog.
export default defineComponent({
  name: 'DeleteTreeBranch',
  props: {
    nodes: { type: Array, required: true },
  },
  setup(props) {
    const renderBranch = (nodes) =>
      h(
        'ul',
        { class: 'delete-tree-children' },
        nodes.map((node) =>
          h('li', { key: node.id }, [
            h('span', { class: 'delete-tree-title' }, node.title || 'Untitled page'),
            node.children?.length ? renderBranch(node.children) : null,
          ])
        )
      );
    return () => renderBranch(props.nodes || []);
  },
});
