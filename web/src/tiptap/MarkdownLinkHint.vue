<script setup>
import { computed, ref, watch } from 'vue';
import PageIcon from '../components/PageIcon.vue';

// Under a "[words](" being typed (markdownLinks.js): a hint, or after "(/" the pages it could link
// to, which the arrow keys and Enter or Tab (or the pointer) choose from.
const props = defineProps({
  items: { type: Array, default: () => [] },
  query: { type: String, default: '' },
  command: { type: Function, required: true },
});

const searchingPages = computed(() => props.query.startsWith('/'));
const selectedIndex = ref(0);
watch(
  () => props.items,
  () => {
    selectedIndex.value = 0;
  }
);

const choose = (index) => {
  const page = props.items[index];
  if (page) props.command(page);
};

// Called by the suggestion with the key pressed: true if it was the list's
const onKeyDown = ({ event }) => {
  const count = props.items.length;
  if (!count) return false;
  if (event.key === 'ArrowDown') {
    selectedIndex.value = (selectedIndex.value + 1) % count;
    return true;
  }
  if (event.key === 'ArrowUp') {
    selectedIndex.value = (selectedIndex.value - 1 + count) % count;
    return true;
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    choose(selectedIndex.value);
    return true;
  }
  return false;
};

defineExpose({ onKeyDown });
</script>

<template>
  <ul v-if="searchingPages && items.length" class="page-mention-list context-menu" role="listbox" aria-label="Pages">
    <li
      v-for="(page, index) in items"
      :key="page.id"
      role="option"
      :aria-selected="index === selectedIndex ? 'true' : 'false'"
      :class="['context-menu__item', { 'link-editor__page--active': index === selectedIndex }]"
      @mousemove="selectedIndex = index"
      @mousedown.prevent="choose(index)"
    >
      <PageIcon class="link-editor__page-icon" :icon="page.icon" fallback="📄" aria-hidden="true" />
      <span class="link-editor__page-title">{{ page.title || 'Untitled page' }}</span>
      <i v-if="page.onlyYou" class="bi bi-lock-fill link-editor__page-lock" aria-label="Private"></i>
    </li>
    <li v-if="items[selectedIndex]?.onlyYou" class="link-editor__note" role="presentation">Only you can open this page; others will see “Private page”</li>
  </ul>
  <div v-else class="page-mention-list context-menu page-mention-list--empty">
    {{ searchingPages ? 'No pages match' : 'Type an address, or / to link a page' }}
  </div>
</template>
