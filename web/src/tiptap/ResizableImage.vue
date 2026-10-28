<script setup>
import { NodeViewWrapper } from '@tiptap/vue-3';
import { computed, onBeforeUnmount, ref } from 'vue';

const props = defineProps({
  editor: { type: Object, required: true },
  node: { type: Object, required: true },
  updateAttributes: { type: Function, required: true },
  selected: { type: Boolean, default: false },
  getPos: { type: Function, required: false },
});

const containerRef = ref(null);
let startX = 0;
let startWidth = 0;
let dragging = false;
const minWidth = 80;

const onMouseMove = (event) => {
  if (!dragging) return;
  const dx = event.clientX - startX;
  const next = Math.max(minWidth, startWidth + dx);
  props.updateAttributes({ width: `${next}px` });
};

const onMouseUp = () => {
  if (!dragging) return;
  dragging = false;
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
};

const startDrag = (event) => {
  event.preventDefault();
  event.stopPropagation();
  const container = containerRef.value;
  if (!container?.getBoundingClientRect) return;
  startWidth = container.getBoundingClientRect().width;
  startX = event.clientX;
  dragging = true;
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
};

onBeforeUnmount(() => {
  onMouseUp();
});

const imagePos = computed(() => {
  if (typeof props.getPos !== 'function') return -1;
  try {
    return props.getPos();
  } catch {
    return -1;
  }
});

// Its size when uploaded, so the space is kept while it loads instead of the text below jumping
const naturalWidth = computed(() => Number(props.node?.attrs?.naturalWidth) || undefined);
const naturalHeight = computed(() => Number(props.node?.attrs?.naturalHeight) || undefined);
const containerWidth = computed(() => props.node?.attrs?.width || (naturalWidth.value && naturalHeight.value ? `${naturalWidth.value}px` : undefined));

// Images further down a page load as you scroll to them, except when printing to PDF, which
// captures the whole page at once
const loading = typeof window !== 'undefined' && window.location.pathname.startsWith('/print/') ? 'eager' : 'lazy';
</script>

<template>
  <NodeViewWrapper :data-selected="selected" :data-pos="imagePos >= 0 ? imagePos : undefined" contenteditable="false">
    <div
      class="tiptap-image-resizable"
      ref="containerRef"
      :data-pos="imagePos >= 0 ? imagePos : undefined"
      :style="{ width: containerWidth, maxWidth: '100%' }"
    >
      <img
        :src="node?.attrs?.src || ''"
        :alt="node?.attrs?.alt || ''"
        :width="naturalWidth && naturalHeight ? naturalWidth : undefined"
        :height="naturalWidth && naturalHeight ? naturalHeight : undefined"
        :loading="loading"
        decoding="async"
      />
      <button
        class="tiptap-image-resize-handle"
        type="button"
        aria-label="Resize image"
        @mousedown="startDrag"
      >
        ↔
      </button>
    </div>
  </NodeViewWrapper>
</template>
