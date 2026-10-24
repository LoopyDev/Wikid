<script setup>
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3';
import { computed, onBeforeUnmount, ref } from 'vue';

const props = defineProps({
  editor: { type: Object, required: true },
  node: { type: Object, required: true },
  updateAttributes: { type: Function, required: true },
  getPos: { type: Function, required: true },
});

const columnRef = ref(null);
const resizeCleanup = ref(null);
const MIN_COLUMN_WIDTH = 12;

const getColumnElement = () => {
  const el = columnRef.value?.$el || columnRef.value;
  return el instanceof HTMLElement ? el : null;
};

const getColumnContext = () => {
  if (!props.editor?.state || typeof props.getPos !== 'function') return null;
  const pos = props.getPos();
  if (typeof pos !== 'number') return null;
  const $pos = props.editor.state.doc.resolve(pos);
  return { pos, parent: $pos.parent, index: $pos.index() };
};

const appliedWidth = computed(() => {
  // Touch props.node for reactivity in Vue.
  const widthAttr = props.node?.attrs?.width;
  if (!props.node) return null;
  const context = getColumnContext();
  const parent = context?.parent;
  const count = parent?.childCount || 0;
  if (!parent || count === 0) {
    return typeof widthAttr === 'number' && Number.isFinite(widthAttr) ? widthAttr : null;
  }
  let definedTotal = 0;
  let undefinedCount = 0;
  const widths = [];
  parent.forEach((child) => {
    const width = typeof child.attrs?.width === 'number' ? child.attrs.width : null;
    widths.push(width);
    if (width === null) {
      undefinedCount += 1;
    } else {
      definedTotal += width;
    }
  });
  const fallback = undefinedCount ? Math.max(0, (100 - definedTotal) / undefinedCount) : null;
  const index = context?.index ?? 0;
  const width = widths[index];
  if (typeof width === 'number' && Number.isFinite(width)) {
    return width;
  }
  if (fallback !== null && Number.isFinite(fallback)) {
    return Math.round(fallback * 10) / 10;
  }
  return null;
});

const columnStyle = computed(() => {
  const width = appliedWidth.value;
  if (!width || !Number.isFinite(width)) return null;
  return {
    flex: `0 0 ${width}%`,
    maxWidth: `${width}%`,
  };
});

const isEditable = computed(() => props.editor?.isEditable ?? true);
const isLastColumn = computed(() => {
  if (!props.node) return true;
  const context = getColumnContext();
  if (!context?.parent) return true;
  return context.index >= context.parent.childCount - 1;
});

const updateColumnWidths = (currentWidth, nextWidth) => {
  const pos = typeof props.getPos === 'function' ? props.getPos() : null;
  if (typeof pos !== 'number') return;
  const { state, view } = props.editor;
  const currentNode = state.doc.nodeAt(pos);
  const nextPos = pos + (currentNode?.nodeSize || props.node.nodeSize);
  const nextNode = state.doc.nodeAt(nextPos);
  if (!currentNode || !nextNode || nextNode.type?.name !== 'column') return;
  const tr = state.tr;
  tr.setNodeMarkup(pos, currentNode.type, { ...currentNode.attrs, width: currentWidth }, currentNode.marks);
  tr.setNodeMarkup(nextPos, nextNode.type, { ...nextNode.attrs, width: nextWidth }, nextNode.marks);
  view.dispatch(tr);
};

const stopResize = () => {
  if (resizeCleanup.value) {
    resizeCleanup.value();
    resizeCleanup.value = null;
  }
};

const startResize = (event) => {
  if (!isEditable.value) return;
  if (isLastColumn.value) return;
  const currentEl = getColumnElement();
  if (!currentEl) return;
  const parent = currentEl.parentElement;
  if (!parent) return;
  const columns = Array.from(parent.querySelectorAll(':scope > .tiptap-column'));
  const index = columns.indexOf(currentEl);
  const nextEl = columns[index + 1];
  if (!nextEl) return;
  const parentRect = parent.getBoundingClientRect();
  const currentRect = currentEl.getBoundingClientRect();
  const nextRect = nextEl.getBoundingClientRect();
  const startX = event.clientX;
  const startWidth = currentRect.width;
  const startNextWidth = nextRect.width;
  const minWidthPx = (MIN_COLUMN_WIDTH / 100) * parentRect.width;

  const handleMove = (moveEvent) => {
    const delta = moveEvent.clientX - startX;
    let nextCurrent = startWidth + delta;
    let nextSibling = startNextWidth - delta;
    if (nextCurrent < minWidthPx) {
      const diff = minWidthPx - nextCurrent;
      nextCurrent = minWidthPx;
      nextSibling -= diff;
    }
    if (nextSibling < minWidthPx) {
      const diff = minWidthPx - nextSibling;
      nextSibling = minWidthPx;
      nextCurrent -= diff;
    }
    const total = parentRect.width || 1;
    const nextCurrentPct = Math.round((nextCurrent / total) * 1000) / 10;
    const nextSiblingPct = Math.round((nextSibling / total) * 1000) / 10;
    updateColumnWidths(nextCurrentPct, nextSiblingPct);
  };

  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove);
    document.removeEventListener('mouseup', handleUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    resizeCleanup.value = null;
  };

  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleUp);
  resizeCleanup.value = handleUp;
};

onBeforeUnmount(() => {
  stopResize();
});
</script>

<template>
  <NodeViewWrapper
    ref="columnRef"
    class="tiptap-column"
    data-type="column"
    :data-width="appliedWidth || undefined"
    :style="columnStyle"
  >
    <div class="tiptap-column__content">
      <NodeViewContent class="tiptap-column__content-inner" />
    </div>
    <button
      v-if="isEditable && !isLastColumn"
      class="tiptap-column__resizer"
      type="button"
      aria-label="Resize column"
      contenteditable="false"
      @mousedown.prevent.stop="startResize"
    ></button>
  </NodeViewWrapper>
</template>
