<script setup>
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3';
import { computed } from 'vue';

const CHEVRON_RIGHT = 'M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z';

const props = defineProps({
  editor: { type: Object, required: true },
  node: { type: Object, required: true },
  updateAttributes: { type: Function, required: true },
  selected: { type: Boolean, default: false },
});

const isEditable = computed(() => props.editor?.isEditable ?? true);
const isCollapsed = computed(() => !!props.node?.attrs?.collapsed);

const toggleCollapsed = () => {
  props.updateAttributes({ collapsed: !isCollapsed.value });
};
</script>

<template>
  <NodeViewWrapper
    class="tiptap-toggle-heading"
    :class="{
      'tiptap-toggle-heading--collapsed': isCollapsed,
      'tiptap-toggle-heading--selected': selected,
    }"
    data-type="toggle-heading"
    :data-collapsed="isCollapsed ? 'true' : null"
  >
    <button
      class="tiptap-toggle-heading__chevron"
      type="button"
      contenteditable="false"
      :disabled="!isEditable"
      :aria-expanded="!isCollapsed"
      :aria-label="isCollapsed ? 'Expand heading' : 'Collapse heading'"
      @mousedown.stop.prevent
      @click.stop="toggleCollapsed"
    >
      <svg class="tiptap-toggle-heading__chevron-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path fill-rule="evenodd" :d="CHEVRON_RIGHT" />
      </svg>
    </button>
    <NodeViewContent class="tiptap-toggle-heading__content" />
  </NodeViewWrapper>
</template>
