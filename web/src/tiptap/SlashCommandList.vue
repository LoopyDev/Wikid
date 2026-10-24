<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

const props = defineProps({
  items: {
    type: Array,
    default: () => [],
  },
  command: {
    type: Function,
    required: true,
  },
});

const selectedIndex = ref(0);
const listRef = ref(null);

const items = computed(() => props.items || []);

const selectItem = (index) => {
  const item = items.value[index];
  if (!item) return;
  props.command(item);
};

const handleKeyDown = (event) => {
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value + items.value.length - 1) % items.value.length;
    return true;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % items.value.length;
    return true;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    selectItem(selectedIndex.value);
    return true;
  }
  return false;
};

// Cap the menu's height to the space between its top and the bottom of the
// viewport so it stays anchored below the cursor and scrolls instead of
// running off-screen.
const applyMaxHeight = () => {
  const el = listRef.value;
  if (!el) return;
  const { top } = el.getBoundingClientRect();
  const available = window.innerHeight - top - 12;
  el.style.maxHeight = `${Math.max(available, 120)}px`;
};

onMounted(() => {
  const el = listRef.value;
  if (!el) return;
  // Wait for tippy/popper to position the element before measuring.
  requestAnimationFrame(applyMaxHeight);
  window.addEventListener('resize', applyMaxHeight);
  // Recompute when the filtered results change (height/position may shift).
  watch(() => props.items, () => nextTick(applyMaxHeight));
  const observer = new MutationObserver(() => {
    const active = el.querySelector('.slash-item--active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  });
  observer.observe(el, { childList: true, subtree: true, attributes: true });
  onUnmounted(() => {
    observer.disconnect();
    window.removeEventListener('resize', applyMaxHeight);
  });
});

defineExpose({
  onKeyDown: ({ event }) => handleKeyDown(event),
});
</script>

<template>
  <div class="slash-menu" ref="listRef">
    <template v-if="items.length">
      <button
        v-for="(item, index) in items"
        :key="item.title"
        class="slash-item"
        :class="{ 'slash-item--active': index === selectedIndex }"
        type="button"
        @click="selectItem(index)"
      >
        <span class="slash-item__icon">{{ item.icon }}</span>
        <span class="slash-item__text">
          <span class="slash-item__title">{{ item.title }}</span>
          <span class="slash-item__hint">{{ item.hint }}</span>
        </span>
      </button>
    </template>
    <div v-else class="slash-empty">No results</div>
  </div>
</template>
