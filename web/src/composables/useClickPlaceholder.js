import { ref } from 'vue';
import { TextSelection } from 'prosemirror-state';
import { findBlockById } from '../tiptap/syncedBlocks';

// Clicking below the last block adds an empty paragraph to type in, and takes it away again
// if you leave it empty.
export function useClickPlaceholder({ props }) {
  const isEmptyTextblockNode = (node) => !!node?.isTextblock && node.content?.size === 0;
  const isSingleEmptyParagraphDoc = (doc) =>
    Array.isArray(doc?.content) &&
    doc.content.length === 1 &&
    doc.content[0]?.type === 'paragraph' &&
    (!Array.isArray(doc.content[0]?.content) || doc.content[0].content.length === 0);
  const clickPlaceholderBlockId = ref(null);
  const isSelectionInsideNode = (selection, pos, node) => {
    if (!selection || pos == null || !node) return false;
    const start = pos;
    const end = pos + node.nodeSize;
    return selection.from >= start && selection.to <= end;
  };
  const clearClickPlaceholderIfNeeded = (view) => {
    if (!view || !clickPlaceholderBlockId.value) return;
    const { state } = view;
    const match = findBlockById(state.doc, clickPlaceholderBlockId.value);
    if (!match) {
      clickPlaceholderBlockId.value = null;
      return;
    }
    const { node, pos } = match;
    if (!isEmptyTextblockNode(node)) {
      clickPlaceholderBlockId.value = null;
      return;
    }
    if (isSelectionInsideNode(state.selection, pos, node)) {
      return;
    }
    view.dispatch(state.tr.delete(pos, pos + node.nodeSize));
    clickPlaceholderBlockId.value = null;
  };
  const shouldInsertClickPlaceholder = (view, event) => {
    if (!view || !event || props.readonly) return false;
    const { doc } = view.state;
    if (!doc?.childCount) return false;
    const lastBlock = doc.child(doc.childCount - 1);
    if (isEmptyTextblockNode(lastBlock)) return false;
    const root = view.dom;
    if (!root?.querySelectorAll) return false;
    const blocks = root.querySelectorAll('[data-block-pos]');
    if (!blocks.length) return false;
    const lastRect = blocks[blocks.length - 1].getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    if (event.clientY < rootRect.top || event.clientY > rootRect.bottom) return false;
    return event.clientY > lastRect.bottom + 6;
  };
  const insertClickPlaceholder = (view) => {
    if (!view || props.readonly) return false;
    const { state } = view;
    const paragraph = state.schema.nodes.paragraph;
    if (!paragraph) return false;
    const insertPos = state.doc.content.size;
    const node = paragraph.create();
    let tr = state.tr.insert(insertPos, node);
    const selectionPos = Math.min(insertPos + 1, tr.doc.content.size);
    tr = tr.setSelection(TextSelection.create(tr.doc, selectionPos));
    view.dispatch(tr);
    const lastBlock = view.state.doc.child(view.state.doc.childCount - 1);
    const id = lastBlock?.attrs?.id;
    clickPlaceholderBlockId.value = typeof id === 'string' && id ? id : null;
    view.focus();
    return true;
  };

  return { isEmptyTextblockNode, clickPlaceholderBlockId, clearClickPlaceholderIfNeeded, shouldInsertClickPlaceholder, insertClickPlaceholder };
}
