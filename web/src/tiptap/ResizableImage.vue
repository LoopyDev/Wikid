<script setup>
import { NodeViewWrapper } from '@tiptap/vue-3';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps({
  editor: { type: Object, required: true },
  node: { type: Object, required: true },
  updateAttributes: { type: Function, required: true },
  selected: { type: Boolean, default: false },
  getPos: { type: Function, required: false },
});

const containerRef = ref(null);
const workspace = useWorkspaceStore();
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

const displaySrc = computed(() => {
  const src = props.node?.attrs?.src;
  if (!src) return '';
  const userId = workspace.activeUser?.id;
  if (!userId) return src;
  try {
    const base = src.startsWith('http')
      ? undefined
      : (import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : ''));
    const url = new URL(src, base);
    if (!url.pathname.startsWith('/uploads/')) return src;
    if (!url.searchParams.get('userId')) {
      url.searchParams.set('userId', userId);
    }
    const userName = workspace.activeUser?.name;
    if (userName && !url.searchParams.get('userName')) {
      url.searchParams.set('userName', userName);
    }
    return url.toString();
  } catch {
    return src;
  }
});
</script>

<template>
  <NodeViewWrapper :data-selected="selected" :data-pos="imagePos >= 0 ? imagePos : undefined" contenteditable="false">
    <div
      class="tiptap-image-resizable"
      ref="containerRef"
      :data-pos="imagePos >= 0 ? imagePos : undefined"
      :style="{ width: node?.attrs?.width || undefined, maxWidth: '100%' }"
    >
      <img :src="displaySrc" :alt="node?.attrs?.alt || ''" />
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
