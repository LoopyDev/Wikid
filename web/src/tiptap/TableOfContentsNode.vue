<script setup>
import { NodeViewWrapper } from '@tiptap/vue-3';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  editor: { type: Object, required: true },
  node: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});

const headings = ref([]);
const activeHeadingKey = ref(null);
const allowActiveSelection = ref(false);
let updateHandler = null;
let selectionHandler = null;
let interactionTarget = null;
let interactionHandler = null;
let flashTimer = null;
let scrollTarget = null;
let scrollHandlers = null;
const scrollKeys = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);

const resolveBlockId = (item) => {
  if (typeof item?.id === 'string') return item.id;
  if (typeof item?.pos !== 'number') return null;
  const editor = props.editor;
  const node = editor?.state?.doc?.nodeAt?.(item.pos);
  return node?.attrs?.id || null;
};

const clearScrollHandlers = () => {
  if (scrollTarget && scrollHandlers) {
    const { onWheel, onTouch, onKeydown } = scrollHandlers;
    scrollTarget.removeEventListener('wheel', onWheel);
    scrollTarget.removeEventListener('touchmove', onTouch);
    window.removeEventListener('keydown', onKeydown);
  }
  scrollTarget = null;
  scrollHandlers = null;
};

const clearFlashHeading = () => {
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
  if (props.editor?.emit) {
    props.editor.emit('toc:clear-highlight');
  }
  clearScrollHandlers();
};

const flashHeading = (item) => {
  const blockId = resolveBlockId(item);
  if (!blockId || !props.editor?.emit) {
    clearFlashHeading();
    return;
  }
  props.editor.emit('toc:highlight', { blockId });
  if (flashTimer) {
    clearTimeout(flashTimer);
  }
  flashTimer = setTimeout(() => {
    clearFlashHeading();
  }, 2200);
};

const watchUserScrollToClear = (element) => {
  clearScrollHandlers();
  const target = element?.closest?.('.wikid-mainframe') || window;
  const onWheel = () => clearFlashHeading();
  const onTouch = () => clearFlashHeading();
  const onKeydown = (event) => {
    if (scrollKeys.has(event.key)) {
      clearFlashHeading();
    }
  };
  scrollTarget = target;
  scrollHandlers = { onWheel, onTouch, onKeydown };
  scrollTarget.addEventListener('wheel', onWheel, { passive: true });
  scrollTarget.addEventListener('touchmove', onTouch, { passive: true });
  window.addEventListener('keydown', onKeydown);
};

const collectHeadings = () => {
  const editor = props.editor;
  if (!editor?.state?.doc) {
    headings.value = [];
    activeHeadingKey.value = null;
    return;
  }
  const items = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type?.name !== 'heading') return;
    const text = node.textContent?.trim?.() || '';
    if (!text) return;
    const level = Number(node.attrs?.level || 1) || 1;
    const id = typeof node.attrs?.id === 'string' ? node.attrs.id : null;
    const key = id || `pos-${pos}`;
    items.push({ id, level, text, pos, end: pos + node.nodeSize, key });
  });
  headings.value = items;
  updateActiveHeading();
};

const updateActiveHeading = () => {
  const editor = props.editor;
  if (!editor?.state) {
    activeHeadingKey.value = null;
    return;
  }
  if (!allowActiveSelection.value) {
    activeHeadingKey.value = null;
    return;
  }
  const pos = editor.state.selection?.from ?? 0;
  let active = null;
  for (const item of headings.value) {
    if (typeof item.pos !== 'number' || typeof item.end !== 'number') continue;
    if (pos < item.pos) break;
    if (pos >= item.pos && pos < item.end) {
      active = item;
      break;
    }
  }
  if (active) {
    activeHeadingKey.value = active.key;
  }
};

const scrollHeadingIntoView = (element) => {
  if (!element) return;
  const container = element.closest?.('.wikid-mainframe');
  if (container && container.scrollTo) {
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const offset = elementRect.top - containerRect.top;
    container.scrollTo({ top: container.scrollTop + offset, behavior: 'smooth' });
    return;
  }
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const handleNavigate = (item) => {
  const editor = props.editor;
  if (!editor) return;
  allowActiveSelection.value = true;
  activeHeadingKey.value = item?.key || null;
  let element = null;
  if (item?.id) {
    if (typeof document !== 'undefined') {
      element = document.querySelector(`[data-block-id="${item.id}"]`) || document.getElementById(item.id);
    }
  }
  if (!element && typeof item?.pos === 'number' && editor.view?.nodeDOM) {
    const dom = editor.view.nodeDOM(item.pos);
    if (dom instanceof HTMLElement) {
      element = dom;
    } else if (dom?.nodeType === 1) {
      element = dom;
    }
  }
  scrollHeadingIntoView(element);
  flashHeading(item);
  watchUserScrollToClear(element);
  activeHeadingKey.value = item?.key || null;
};

const hasHeadings = computed(() => headings.value.length > 0);

onMounted(() => {
  const editor = props.editor;
  if (!editor?.on) return;
  updateHandler = () => collectHeadings();
  selectionHandler = () => {
    if (!allowActiveSelection.value) return;
    updateActiveHeading();
  };
  interactionHandler = () => {
    if (allowActiveSelection.value) return;
    allowActiveSelection.value = true;
    updateActiveHeading();
  };
  interactionTarget = editor.view?.dom || null;
  if (interactionTarget?.addEventListener) {
    interactionTarget.addEventListener('pointerdown', interactionHandler);
    interactionTarget.addEventListener('keydown', interactionHandler);
  }
  editor.on('update', updateHandler);
  editor.on('selectionUpdate', selectionHandler);
  collectHeadings();
  updateActiveHeading();
});

onBeforeUnmount(() => {
  const editor = props.editor;
  if (!editor?.off) return;
  if (updateHandler) {
    editor.off('update', updateHandler);
  }
  if (selectionHandler) {
    editor.off('selectionUpdate', selectionHandler);
  }
  if (interactionTarget?.removeEventListener && interactionHandler) {
    interactionTarget.removeEventListener('pointerdown', interactionHandler);
    interactionTarget.removeEventListener('keydown', interactionHandler);
  }
  clearFlashHeading();
});
</script>

<template>
  <NodeViewWrapper
    class="tiptap-toc"
    :class="{ 'tiptap-toc--selected': selected }"
    data-type="table-of-contents"
    contenteditable="false"
  >
    <div class="tiptap-toc__header">
      <span class="tiptap-toc__title">Table of contents</span>
      <span class="tiptap-toc__count" v-if="hasHeadings">{{ headings.length }}</span>
    </div>
    <div v-if="!hasHeadings" class="tiptap-toc__empty">Add headings to build a table of contents.</div>
    <div v-else class="tiptap-toc__list">
      <button
        v-for="item in headings"
        :key="item.id || item.pos"
        class="tiptap-toc__item"
        :class="{ 'tiptap-toc__item--active': item.key === activeHeadingKey }"
        type="button"
        :data-level="item.level"
        @click.stop="handleNavigate(item)"
      >
        {{ item.text }}
      </button>
    </div>
  </NodeViewWrapper>
</template>
