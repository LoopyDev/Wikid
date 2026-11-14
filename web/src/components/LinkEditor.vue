<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import PageIcon from './PageIcon.vue';
import { isSafeLinkHref, normalizeLinkHref, pageLinkTarget } from '../utils/editorLinks';

// The link editor: a link's words and where it goes, apart. Its Link box also finds pages here, to
// link to one (as "/doc/<id>"). Opened by the editor (Ctrl/⌘+K, the toolbar, the slash menu) under
// the text it's for; the editor puts the result in (`save`, `remove`).
const props = defineProps({
  // Where to show it: the text's box on screen
  anchor: { type: Object, required: true },
  text: { type: String, default: '' },
  href: { type: String, default: '' },
  // A link that's there already (so it can be taken off)
  editing: { type: Boolean, default: false },
  // Whether the words can be changed here (not for words across several blocks: only linked)
  textEditable: { type: Boolean, default: true },
  // The pages it can link to: { id, title, icon }
  pages: { type: Array, default: () => [] },
});
const emit = defineEmits(['save', 'remove', 'close']);

const MAX_SUGGESTIONS = 6;
const card = ref(null);
const textInput = ref(null);
const linkInput = ref(null);
const textValue = ref(props.text);
const linkValue = ref(props.href);
// The page the Link box is set to, when one was picked: shown by its title, saved as its address
const pickedPage = ref(null);
// (Its "#block-…", for a link to a block on it)
const pickedHash = ref('');
const activeIndex = ref(0);
const error = ref('');
// Escape closes the list of pages first, then the editor
const listDismissed = ref(false);

const looksLikeAddress = (value) => /^[a-z][a-z0-9+.-]*:|^\/|^www\.|\.[a-z]{2,}(\/|$)/i.test(value.trim());
const suggestions = computed(() => {
  const query = linkValue.value.trim().toLowerCase();
  if (!query || pickedPage.value || listDismissed.value || looksLikeAddress(query)) return [];
  return props.pages
    .filter((page) => (page.title || 'Untitled page').toLowerCase().includes(query))
    .slice(0, MAX_SUGGESTIONS);
});

const pickPage = (page) => {
  pickedPage.value = page;
  pickedHash.value = '';
  linkValue.value = page.title || 'Untitled page';
  // Linked from nothing chosen: the page's title is the link's words
  if (!textValue.value.trim()) textValue.value = page.title || 'Untitled page';
  save();
};

const save = () => {
  const href = pickedPage.value ? `/doc/${pickedPage.value.id}${pickedHash.value}` : normalizeLinkHref(linkValue.value);
  if (!href) {
    if (props.editing) emit('remove');
    else emit('close');
    return;
  }
  if (!isSafeLinkHref(href)) {
    error.value = 'Links can go to web addresses (https://…), email (mailto:) and pages here.';
    return;
  }
  emit('save', { text: textValue.value.trim() ? textValue.value : linkValue.value.trim(), href });
};

const onLinkInput = () => {
  pickedPage.value = null;
  pickedHash.value = '';
  activeIndex.value = 0;
  error.value = '';
  listDismissed.value = false;
};

const onLinkKeydown = (event) => {
  const list = suggestions.value;
  if (event.key === 'ArrowDown' && list.length) {
    event.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % list.length;
  } else if (event.key === 'ArrowUp' && list.length) {
    event.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + list.length) % list.length;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (list.length) pickPage(list[activeIndex.value]);
    else save();
  }
};

const onKeydown = (event) => {
  if (event.key === 'Escape' && suggestions.value.length) {
    event.preventDefault();
    event.stopPropagation();
    listDismissed.value = true;
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    emit('close');
    return;
  }
  // Tab goes round the editor's boxes and buttons, not off into the page with it still open
  if (event.key === 'Tab' && card.value) {
    const stops = [...card.value.querySelectorAll('input:not([disabled]), button:not([disabled])')];
    const at = stops.indexOf(document.activeElement);
    const next = at < 0 ? 0 : (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
    if (stops[next]) {
      event.preventDefault();
      stops[next].focus();
    }
  }
};

// A link to a page shows the page's title in the Link box (its address is "/doc/<id>")
const pageOf = (href) => {
  const target = pageLinkTarget(href);
  const page = target ? props.pages.find((item) => item.id === target.pageId) || null : null;
  return page ? { page, hash: target.hash } : null;
};

// Below the text, kept on screen
const style = computed(() => {
  const width = 320;
  const margin = 8;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const left = Math.max(margin, Math.min(props.anchor.left, viewportWidth - width - margin));
  return { left: `${left}px`, top: `${props.anchor.bottom + 8}px`, width: `${width}px` };
});

const onPointerDownOutside = (event) => {
  if (card.value && !card.value.contains(event.target)) emit('close');
};

onMounted(async () => {
  const linked = pageOf(props.href);
  if (linked) {
    pickedPage.value = linked.page;
    pickedHash.value = linked.hash;
    linkValue.value = linked.page.title || 'Untitled page';
  }
  document.addEventListener('mousedown', onPointerDownOutside, true);
  await nextTick();
  // To the box that needs filling: the address, unless there are no words yet
  const box = props.text || !props.textEditable ? linkInput.value : textInput.value;
  box?.focus();
  box?.select();
});
onBeforeUnmount(() => document.removeEventListener('mousedown', onPointerDownOutside, true));
</script>

<template>
  <div ref="card" class="link-editor context-menu" role="dialog" aria-label="Link" :style="style" @keydown="onKeydown">
    <label class="link-editor__field">
      <span>Text</span>
      <input
        ref="textInput"
        v-model="textValue"
        type="text"
        placeholder="The words to show"
        :disabled="!textEditable"
        :title="textEditable ? undefined : 'Words across several blocks are linked as they are'"
        @keydown.enter.prevent="save"
      />
    </label>
    <label class="link-editor__field">
      <span>Link</span>
      <input
        ref="linkInput"
        v-model="linkValue"
        type="text"
        placeholder="A web address, or search pages"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="suggestions.length ? 'true' : 'false'"
        :aria-controls="suggestions.length ? 'link-editor-pages' : undefined"
        :aria-activedescendant="suggestions.length ? `link-editor-page-${activeIndex}` : undefined"
        :aria-invalid="error ? 'true' : undefined"
        @input="onLinkInput"
        @keydown="onLinkKeydown"
      />
    </label>
    <ul v-if="suggestions.length" id="link-editor-pages" class="link-editor__pages" role="listbox" aria-label="Pages">
      <li
        v-for="(page, index) in suggestions"
        :id="`link-editor-page-${index}`"
        :key="page.id"
        role="option"
        :aria-selected="index === activeIndex ? 'true' : 'false'"
        :class="['context-menu__item', { 'link-editor__page--active': index === activeIndex }]"
        @mousedown.prevent="pickPage(page)"
      >
        <PageIcon class="link-editor__page-icon" :icon="page.icon" fallback="📄" aria-hidden="true" />
        <span class="link-editor__page-title">{{ page.title || 'Untitled page' }}</span>
      </li>
    </ul>
    <p v-if="error" class="link-editor__error" role="alert">{{ error }}</p>
    <div class="link-editor__actions">
      <button v-if="editing" type="button" class="ghost-btn" @click="emit('remove')">Remove link</button>
      <button type="button" class="ghost-btn ghost-btn-background" @click="save">Done</button>
    </div>
  </div>
</template>
