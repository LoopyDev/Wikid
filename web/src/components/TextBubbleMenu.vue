<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import { highlightOptions, textColorOptions } from '../tiptap/editorMenuOptions';
import { normalizeLinkHref } from '../utils/editorLinks';
import { positionBubbleMenu, rectFromClientRects } from '../utils/menuPosition';

// The toolbar over selected text: bold, italic, strikethrough, link, text colour, highlight,
// and the AI actions (which the editor runs, via the `ai-action` event).
const props = defineProps({
  editor: { type: Object, default: null },
  aiStreaming: { type: Boolean, default: false },
});
const emit = defineEmits(['ai-action']);
const editor = computed(() => props.editor);

const toggleBold = () => editor.value?.chain().focus().toggleBold().run();

const toggleItalic = () => editor.value?.chain().focus().toggleItalic().run();

const toggleStrike = () => editor.value?.chain().focus().toggleStrike().run();

const promptLink = () => {
  if (!editor.value) return;
  const previous = editor.value.getAttributes('link').href || '';
  const url = window.prompt('Enter URL', previous);
  if (url === null) return;
  const href = normalizeLinkHref(url);
  if (!href) {
    editor.value.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  editor.value.chain().focus().extendMarkRange('link').setLink({ href, target: '_blank' }).run();
};

const currentColor = computed(() => editor.value?.getAttributes('textStyle')?.color || '');

const currentHighlightColor = computed(() => editor.value?.getAttributes('highlight')?.color || '');

const getSelectionBoundingRect = () => {
  if (typeof window === 'undefined') return null;
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const editorRoot = editor?.value?.view?.dom;
  const container = range.commonAncestorContainer;
  if (editorRoot && container && !editorRoot.contains(container)) return null;
  const rects = Array.from(range.getClientRects?.() || []);
  const combined = rectFromClientRects(rects);
  if (combined) return combined;
  const rect = range.getBoundingClientRect?.();
  if (!rect) return null;
  return {
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    x: rect.x ?? rect.left,
    y: rect.y ?? rect.top,
    toJSON: () => ({}),
  };
};

const getBubbleMenuVirtualElement = () => {
  const rect = getSelectionBoundingRect();
  if (!rect) return null;
  return {
    getBoundingClientRect: () => rect,
    getClientRects: () => [rect],
  };
};

const shouldShowBubble = ({ editor: ed, state, view }) => {
  if (!ed || ed.isDestroyed || !ed.isEditable || !view?.hasFocus?.()) {
    closeBubbleColorMenu();
    closeBubbleHighlightMenu();
    return false;
  }
  if (state.selection.empty) {
    closeBubbleColorMenu();
    closeBubbleHighlightMenu();
    return false;
  }
  return true;
};

const bubbleColorMenuOpen = ref(false);

const bubbleColorButtonRef = ref(null);

const bubbleColorMenuRef = ref(null);

const bubbleColorMenuPos = ref({ top: 0, left: 0 });

const bubbleHighlightMenuOpen = ref(false);

const bubbleHighlightButtonRef = ref(null);

const bubbleHighlightMenuRef = ref(null);

const bubbleHighlightMenuPos = ref({ top: 0, left: 0 });

const handleBubbleColorOutsideClick = (event) => {
  if (!bubbleColorMenuOpen.value) return;
  const target = event?.target;
  const isTrigger = target?.closest?.('.bubble-color-trigger');
  const isMenu = target?.closest?.('.bubble-color-menu');
  if (!isTrigger && !isMenu) {
    closeBubbleColorMenu();
  }
};

const handleBubbleHighlightOutsideClick = (event) => {
  if (!bubbleHighlightMenuOpen.value) return;
  const target = event?.target;
  const isTrigger = target?.closest?.('.bubble-highlight-trigger');
  const isMenu = target?.closest?.('.bubble-highlight-menu');
  if (!isTrigger && !isMenu) {
    closeBubbleHighlightMenu();
  }
};

const updateBubbleColorMenuPos = () => {
  positionBubbleMenu(bubbleColorButtonRef, bubbleColorMenuRef, bubbleColorMenuPos);
};

const toggleBubbleColorMenu = async (event) => {
  if (event?.currentTarget) {
    bubbleColorButtonRef.value = event.currentTarget;
  }
  if (bubbleColorMenuOpen.value) {
    closeBubbleColorMenu();
    return;
  }
  bubbleHighlightMenuOpen.value = false;
  bubbleColorMenuOpen.value = true;
  await nextTick();
  updateBubbleColorMenuPos();
};

const closeBubbleColorMenu = () => {
  bubbleColorMenuOpen.value = false;
};

const updateBubbleHighlightMenuPos = () => {
  positionBubbleMenu(bubbleHighlightButtonRef, bubbleHighlightMenuRef, bubbleHighlightMenuPos);
};

const toggleBubbleHighlightMenu = async (event) => {
  if (event?.currentTarget) {
    bubbleHighlightButtonRef.value = event.currentTarget;
  }
  if (bubbleHighlightMenuOpen.value) {
    closeBubbleHighlightMenu();
    return;
  }
  bubbleColorMenuOpen.value = false;
  bubbleHighlightMenuOpen.value = true;
  await nextTick();
  updateBubbleHighlightMenuPos();
};

const closeBubbleHighlightMenu = () => {
  bubbleHighlightMenuOpen.value = false;
};

const applyBubbleHighlightOption = (color) => {
  if (!editor.value) return;
  const { state, view } = editor.value;
  const { from, to } = state.selection;
  const markType = state.schema.marks.highlight;
  if (!markType) return;
  view.dispatch(state.tr.addMark(from, to, markType.create({ color })));
  closeBubbleHighlightMenu();
};

const resetBubbleHighlightOption = () => {
  if (!editor.value) return;
  const { state, view } = editor.value;
  const { from, to } = state.selection;
  const markType = state.schema.marks.highlight;
  if (!markType) return;
  view.dispatch(state.tr.removeMark(from, to, markType));
  closeBubbleHighlightMenu();
};

const applyBubbleTextColorOption = (color) => {
  if (!editor.value) return;
  editor.value.chain().focus().setColor(color).run();
  closeBubbleColorMenu();
};

const resetBubbleTextColorOption = () => {
  if (!editor.value) return;
  editor.value.chain().focus().unsetColor().run();
  closeBubbleColorMenu();
};

onMounted(() => {
  document.addEventListener('mousedown', handleBubbleColorOutsideClick);
  document.addEventListener('mousedown', handleBubbleHighlightOutsideClick);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleBubbleColorOutsideClick);
  document.removeEventListener('mousedown', handleBubbleHighlightOutsideClick);
});
</script>

<template>
  <BubbleMenu
    v-if="editor"
    :editor="editor"
    class="bubble-menu"
    :options="{ duration: 150, interactive: true, hideOnClick: false, zIndex: 5000 }"
    :should-show="shouldShowBubble"
    :get-referenced-virtual-element="getBubbleMenuVirtualElement"
  >
    <button
      class="bubble-menu__btn"
      :class="{ active: editor.isActive('bold') }"
      type="button"
      aria-pressed="editor.isActive('bold')"
      @mousedown.prevent
      @click.prevent="toggleBold"
    >
      B
    </button>
    <button
      class="bubble-menu__btn"
      :class="{ active: editor.isActive('italic') }"
      type="button"
      aria-pressed="editor.isActive('italic')"
      @mousedown.prevent
      @click.prevent="toggleItalic"
    >
      I
    </button>
    <button
      class="bubble-menu__btn bubble-menu__btn--strike"
      :class="{ active: editor.isActive('strike') }"
      type="button"
      aria-pressed="editor.isActive('strike')"
      @mousedown.prevent
      @click.prevent="toggleStrike"
    >
      S
    </button>
    <button
      class="bubble-menu__btn"
      :class="{ active: editor.isActive('link') }"
      type="button"
      aria-pressed="editor.isActive('link')"
      @mousedown.prevent
      @click.prevent="promptLink"
    >
      Link
    </button>
    <button
      class="bubble-menu__btn bubble-color-trigger"
      type="button"
      :style="{ color: currentColor || undefined }"
      @mousedown.prevent
      :aria-expanded="bubbleColorMenuOpen"
      aria-haspopup="menu"
      @click.prevent="toggleBubbleColorMenu($event)"
    >
      Color
    </button>
    <button
      class="bubble-menu__btn bubble-highlight-trigger"
      :class="{ active: !!currentHighlightColor }"
      type="button"
      @mousedown.prevent
      :aria-expanded="bubbleHighlightMenuOpen"
      aria-haspopup="menu"
      @click.prevent="toggleBubbleHighlightMenu($event)"
    >
      Highlight
    </button>
    <span class="bubble-menu__divider" aria-hidden="true"></span>
    <template v-if="!aiStreaming">
      <button class="bubble-menu__btn bubble-menu__btn--ai" type="button" title="Improve writing" @mousedown.prevent @click.prevent="emit('ai-action', 'improve')">✦ Improve</button>
      <button class="bubble-menu__btn bubble-menu__btn--ai" type="button" title="Summarise" @mousedown.prevent @click.prevent="emit('ai-action', 'summarise')">Summarise</button>
      <button class="bubble-menu__btn bubble-menu__btn--ai" type="button" title="Make shorter" @mousedown.prevent @click.prevent="emit('ai-action', 'shorten')">Shorten</button>
      <button class="bubble-menu__btn bubble-menu__btn--ai" type="button" title="Expand with more detail" @mousedown.prevent @click.prevent="emit('ai-action', 'expand')">Expand</button>
    </template>
    <span v-else class="bubble-menu__ai-streaming" aria-live="polite">✦ Writing…</span>
  </BubbleMenu>
  <Teleport to="body">
    <div
      v-if="bubbleColorMenuOpen"
      class="bubble-menu__dropdown bubble-color-menu"
      ref="bubbleColorMenuRef"
      role="menu"
      :style="{ position: 'fixed', top: `${bubbleColorMenuPos.top}px`, left: `${bubbleColorMenuPos.left}px` }"
    >
      <div class="block-menu__submenu-section">
        <div class="block-menu__group-title">Text color</div>
        <div class="block-menu__color-list">
          <button
            class="block-menu__color-btn"
            type="button"
            :aria-selected="!currentColor"
            @mousedown.prevent
            @click.prevent="resetBubbleTextColorOption"
          >
            <span class="block-menu__color-dot block-menu__color-dot--default"></span>
            <span class="block-menu__color-label">Default</span>
          </button>
          <button
            v-for="option in textColorOptions"
            :key="option.value"
            class="block-menu__color-btn"
            type="button"
            :aria-selected="currentColor === option.value"
            @mousedown.prevent
            @click.prevent="applyBubbleTextColorOption(option.value)"
          >
            <span class="block-menu__color-dot" :style="{ backgroundColor: option.value }"></span>
            <span class="block-menu__color-label">{{ option.name }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
  <Teleport to="body">
    <div
      v-if="bubbleHighlightMenuOpen"
      class="bubble-menu__dropdown bubble-highlight-menu"
      ref="bubbleHighlightMenuRef"
      role="menu"
      :style="{ position: 'fixed', top: `${bubbleHighlightMenuPos.top}px`, left: `${bubbleHighlightMenuPos.left}px` }"
    >
      <div class="block-menu__submenu-section">
        <div class="block-menu__group-title">Highlight</div>
        <div class="block-menu__color-list">
          <button
            class="block-menu__color-btn"
            type="button"
            :aria-selected="!currentHighlightColor"
            @mousedown.prevent
            @click.prevent="resetBubbleHighlightOption"
          >
            <span class="block-menu__color-dot block-menu__color-dot--reset"></span>
            <span class="block-menu__color-label">None</span>
          </button>
          <button
            v-for="option in highlightOptions"
            :key="option.value"
            class="block-menu__color-btn"
            type="button"
            :aria-selected="currentHighlightColor === option.value"
            @mousedown.prevent
            @click.prevent="applyBubbleHighlightOption(option.value)"
          >
            <span class="block-menu__color-dot" :style="{ backgroundColor: option.value }"></span>
            <span class="block-menu__color-label">{{ option.name }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
