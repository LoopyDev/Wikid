<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { buildIconToken, iconEntries } from '../utils/icons';
import { iconCategories, loadIconMeta, searchIcons } from '../utils/iconSearch';
import PageIcon from './PageIcon.vue';

// The icon picker, opened out: Bootstrap Icons' categories down the side (a row of them on a
// narrow screen), a search within the chosen one (or all), and a bigger grid. Shown over the page,
// from the page's body; the pickers that open it ignore clicks inside it (ICON_BROWSER_SELECTOR).

const props = defineProps({
  // The colour icons are drawn in, as the picker has it
  color: { type: String, default: '' },
  // What the picker was searching for, to carry on with
  initialQuery: { type: String, default: '' },
});
const emit = defineEmits(['select', 'close']);

const meta = ref(null);
const query = ref(props.initialQuery);
const category = ref('');
const searchRef = ref(null);

const categories = computed(() => iconCategories(meta.value));
const results = computed(() => searchIcons(iconEntries, query.value, { meta: meta.value, category: category.value }));

const chooseCategory = (name) => {
  category.value = name;
  searchRef.value?.focus();
};

const handleKeydown = (event) => {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  emit('close');
};

onMounted(async () => {
  document.addEventListener('keydown', handleKeydown, true);
  await nextTick();
  searchRef.value?.focus();
  meta.value = await loadIconMeta();
});
onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown, true));
</script>

<template>
  <Teleport to="body">
    <div class="icon-browser" @mousedown.self="emit('close')">
      <section class="icon-browser__panel" role="dialog" aria-modal="true" aria-label="Browse icons">
        <header class="icon-browser__header">
          <input
            ref="searchRef"
            v-model="query"
            class="icon-search icon-browser__search"
            type="search"
            :placeholder="category ? `Search ${category}` : 'Search all icons'"
            aria-label="Search icons"
          />
          <button class="icon-browser__close" type="button" aria-label="Close" @click="emit('close')">×</button>
        </header>
        <div class="icon-browser__body">
          <nav class="icon-browser__categories" aria-label="Icon categories">
            <button
              class="icon-browser__category"
              :class="{ 'icon-browser__category--active': !category }"
              type="button"
              :aria-pressed="!category"
              @click="chooseCategory('')"
            >
              All icons
            </button>
            <button
              v-for="name in categories"
              :key="name"
              class="icon-browser__category"
              :class="{ 'icon-browser__category--active': category === name }"
              type="button"
              :aria-pressed="category === name"
              @click="chooseCategory(name)"
            >
              {{ name }}
            </button>
          </nav>
          <div class="icon-browser__results">
            <div class="icon-browser__count">{{ results.length }} {{ results.length === 1 ? 'icon' : 'icons' }}</div>
            <div v-if="results.length" class="icon-browser__grid">
              <button
                v-for="entry in results"
                :key="entry.id"
                class="icon-browser__icon"
                type="button"
                :title="entry.name"
                @click="emit('select', entry)"
              >
                <PageIcon class="icon-browser__glyph" :icon="buildIconToken(entry.id, color)" aria-hidden="true" />
                <span class="icon-browser__name">{{ entry.name }}</span>
              </button>
            </div>
            <div v-else class="emoji-menu__empty">No matching icons.</div>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
