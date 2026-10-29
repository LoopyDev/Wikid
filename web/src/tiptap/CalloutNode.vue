<script setup>
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import IconPicker from '../components/IconPicker.vue';
import PageIcon from '../components/PageIcon.vue';
import { isInIconBrowser } from '../utils/iconSearch';

const props = defineProps({
  editor: { type: Object, required: true },
  node: { type: Object, required: true },
  updateAttributes: { type: Function, required: true },
  selected: { type: Boolean, default: false },
});

const isEditable = computed(() => props.editor?.isEditable ?? true);
const icon = computed(() => props.node?.attrs?.icon || '💡');
const tone = computed(() => props.node?.attrs?.tone || '');
const calloutStyle = computed(() => (tone.value ? { background: tone.value } : null));

const styleOptions = [
  { value: '', label: 'Note', emoji: '💡' },
  { value: 'rgba(14, 165, 233, 0.18)', label: 'Information', emoji: 'ℹ️' },
  { value: 'rgba(34, 197, 94, 0.18)', label: 'Success', emoji: '✅' },
  { value: 'rgba(234, 179, 8, 0.2)', label: 'Reminder', emoji: '⚠️' },
  { value: 'rgba(249, 115, 22, 0.18)', label: 'Warning', emoji: '🔥' },
  { value: 'rgba(239, 68, 68, 0.18)', label: 'Danger!', emoji: '⛔️' },
  { value: 'rgba(168, 85, 247, 0.18)', label: 'Idea', emoji: '✨' },
  { value: 'rgba(99, 102, 241, 0.18)', label: 'Deep dive', emoji: '🧠' },
  { value: 'rgba(20, 184, 166, 0.18)', label: 'Tip', emoji: '💬' },
  { value: 'rgba(148, 163, 184, 0.18)', label: 'Neutral', emoji: '📌' },
];

const showPicker = ref(false);
const pickerRef = ref(null);
const triggerRef = ref(null);

const closePicker = () => {
  showPicker.value = false;
};
const togglePicker = () => {
  if (!isEditable.value) return;
  showPicker.value = !showPicker.value;
};
const selectIcon = (value) => {
  if (!isEditable.value) return;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  props.updateAttributes({ icon: trimmed || '💡' });
};
const selectTone = (value) => {
  if (!isEditable.value) return;
  props.updateAttributes({ tone: value || '' });
};
const handleClickOutside = (event) => {
  if (!showPicker.value) return;
  const target = event?.target;
  const path = event?.composedPath?.() || [];
  const menuHit = pickerRef.value && (path.includes(pickerRef.value) || pickerRef.value.contains(target));
  const triggerHit = triggerRef.value && (path.includes(triggerRef.value) || triggerRef.value.contains(target));
  if (menuHit || triggerHit || isInIconBrowser(target)) return;
  closePicker();
};
const handleKeydown = (event) => {
  if (event.key === 'Escape') {
    closePicker();
  }
};
const toggleGlobalListeners = (shouldListen) => {
  if (typeof window === 'undefined') return;
  if (shouldListen) {
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeydown);
  } else {
    window.removeEventListener('mousedown', handleClickOutside);
    window.removeEventListener('keydown', handleKeydown);
  }
};

watch(showPicker, (open) => {
  toggleGlobalListeners(open);
});

onBeforeUnmount(() => {
  toggleGlobalListeners(false);
});
</script>

<template>
  <NodeViewWrapper
    class="tiptap-callout"
    :class="{ 'tiptap-callout--selected': selected }"
    data-type="callout"
    :style="calloutStyle"
  >
    <div class="tiptap-callout__icon-wrap" contenteditable="false">
      <button
        ref="triggerRef"
        class="tiptap-callout__icon"
        type="button"
        :disabled="!isEditable"
        aria-label="Choose callout icon"
        @click.stop="togglePicker"
      >
        <PageIcon :icon="icon" fallback="💡" aria-hidden="true" />
      </button>
      <div
        v-if="showPicker"
        ref="pickerRef"
        class="emoji-menu tiptap-callout__menu"
        @click.stop
      >
        <IconPicker
          :icon="icon"
          :open="showPicker"
          :show-header="false"
          :show-style-tab="true"
          :style-value="tone"
          :style-options="styleOptions"
          @select="selectIcon"
          @style-select="selectTone"
        />
      </div>
    </div>
    <div class="tiptap-callout__content">
      <NodeViewContent class="tiptap-callout__body" />
    </div>
  </NodeViewWrapper>
</template>
