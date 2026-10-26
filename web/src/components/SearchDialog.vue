<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api/client';
import PageIcon from './PageIcon.vue';

// Search across pages and database rows (Cmd/Ctrl+K). Emits `open` with the page to open.
const emit = defineEmits(['open', 'close']);

const query = ref('');
const results = ref([]);
const loading = ref(false);
const error = ref('');
const selected = ref(0);
const inputRef = ref(null);
const listRef = ref(null);
let timer = null;
let latest = 0;

const runSearch = async (text) => {
  const ticket = ++latest;
  if (!text.trim()) {
    results.value = [];
    loading.value = false;
    error.value = '';
    return;
  }
  loading.value = true;
  try {
    const res = await api.search(text);
    if (ticket !== latest) return; // a newer search is on its way
    results.value = Array.isArray(res?.results) ? res.results : [];
    selected.value = 0;
    error.value = '';
  } catch (err) {
    if (ticket !== latest) return;
    error.value = err?.message || 'Search failed';
  } finally {
    if (ticket === latest) loading.value = false;
  }
};

watch(query, (text) => {
  clearTimeout(timer);
  timer = setTimeout(() => runSearch(text), 150);
});

// The snippet with its matched words (marked [[[like this]]] by the API) as separate parts.
const snippetParts = (snippet) =>
  String(snippet || '')
    .split(/(\[\[\[.*?\]\]\])/)
    .filter(Boolean)
    .map((part) => (part.startsWith('[[[') ? { text: part.slice(3, -3), match: true } : { text: part, match: false }));

const openResult = (result) => {
  if (result) emit('open', result.pageId);
};

const scrollSelectedIntoView = () =>
  nextTick(() => listRef.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));

const onKeydown = (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!results.value.length) return;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    selected.value = (selected.value + step + results.value.length) % results.value.length;
    scrollSelectedIntoView();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    openResult(results.value[selected.value]);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  }
};

const status = computed(() => {
  if (error.value) return error.value;
  if (!query.value.trim()) return 'Search page titles, text and database rows.';
  if (loading.value && !results.value.length) return 'Searching…';
  if (!results.value.length) return 'No results.';
  return '';
});

onMounted(() => nextTick(() => inputRef.value?.focus()));
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="search-backdrop" @mousedown.self="emit('close')">
    <div class="search-dialog" role="dialog" aria-modal="true" aria-label="Search">
      <div class="search-dialog__field">
        <i class="bi bi-search" aria-hidden="true"></i>
        <input
          ref="inputRef"
          v-model="query"
          class="search-dialog__input"
          type="search"
          placeholder="Search pages and databases"
          aria-label="Search"
          aria-controls="search-results"
          :aria-activedescendant="results.length ? `search-result-${selected}` : undefined"
          autocomplete="off"
          spellcheck="false"
          @keydown="onKeydown"
        />
        <kbd class="search-dialog__kbd">Esc</kbd>
      </div>
      <p v-if="status" class="search-dialog__status" role="status">{{ status }}</p>
      <ul v-if="results.length" id="search-results" ref="listRef" class="search-dialog__results" role="listbox">
        <li
          v-for="(result, index) in results"
          :id="`search-result-${index}`"
          :key="`${result.type}:${result.pageId}:${index}`"
          class="search-result"
          :class="{ 'search-result--selected': index === selected }"
          role="option"
          :aria-selected="index === selected ? 'true' : 'false'"
          @mousemove="selected = index"
          @click="openResult(result)"
        >
          <PageIcon class="search-result__icon" :icon="result.icon" :fallback="result.type === 'row' ? '🗂️' : '📄'" aria-hidden="true" />
          <div class="search-result__body">
            <div class="search-result__title">
              <template v-for="(part, i) in snippetParts(result.titleHighlight || result.title)" :key="i">
                <mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
              </template>
            </div>
            <div class="search-result__meta">
              <template v-if="result.type === 'row'">{{ result.databaseTitle }} · </template>{{ result.workspaceName }}
            </div>
            <div v-if="result.snippet" class="search-result__snippet">
              <template v-for="(part, i) in snippetParts(result.snippet)" :key="i">
                <mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
              </template>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
