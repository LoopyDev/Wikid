<script setup>
import { computed, ref, watch } from 'vue';
import 'emoji-picker-element';
import emojiDataUrl from 'emoji-picker-element-data/en/emojibase/data.json?url';
import { buildIconToken, iconEntries, isIconToken, parseIconToken, resolveIcon } from '../utils/icons';
import { loadIconMeta, searchIcons } from '../utils/iconSearch';
import IconBrowser from './IconBrowser.vue';
import PageIcon from './PageIcon.vue';

const props = defineProps({
  icon: {
    type: String,
    default: '',
  },
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: 'Icon',
  },
  showClose: {
    type: Boolean,
    default: false,
  },
  showHeader: {
    type: Boolean,
    default: true,
  },
  showStyleTab: {
    type: Boolean,
    default: false,
  },
  styleValue: {
    type: String,
    default: '',
  },
  styleOptions: {
    type: Array,
    default: () => [],
  },
  allowIcons: {
    type: Boolean,
    default: true,
  },
  showRecents: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['select', 'close', 'style-select']);

const EMOJI_RECENTS_KEY = 'wikid:recent-emojis';
// Icons chosen lately, as chosen (in their colour), newest first; kept in this browser, as the
// emoji are
const ICON_RECENTS_KEY = 'wikid:recent-icons';
const RECENT_ICONS_MAX = 16;
const RECENT_EMOJIS_MAX = 24;
const emojiDataSource = emojiDataUrl;
const recentEmojis = ref([]);
const recentIcons = ref([]);
/** An icon as kept in the Recent row: under its current name (old names map to it), in its colour. */
const canonicalIcon = (token) => {
  const resolved = resolveIcon(token);
  return resolved.type === 'svg' ? { token: buildIconToken(resolved.id, resolved.color), name: resolved.name } : null;
};
// Each with its icon's name, for its tooltip; any no longer in the set left out, and each once
// (an old name and its new one are the same icon)
const recentIconOptions = computed(() => {
  const seen = new Set();
  return recentIcons.value.map(canonicalIcon).filter((icon) => icon && !seen.has(icon.token) && seen.add(icon.token));
});
const readList = (key, max) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.filter((item) => typeof item === 'string' && item))].slice(0, max) : [];
  } catch {
    // Storage blocked, or a malformed list
    return [];
  }
};
/** Puts `value` first in a stored list, read afresh (another picker may have added to it since). */
const rememberIn = (key, max, value, list) => {
  const next = [value, ...readList(key, max).filter((item) => item !== value)].slice(0, max);
  list.value = next;
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage blocked or full: the list just isn't kept
  }
};
// The picker's own row of most-used emoji, under the list: unlabelled, and topped up with its
// defaults (😒 among them) until you've used enough. The Recent row above does that job, with a
// heading. The picker is drawn in its own shadow root, so the style to hide it goes in there.
const hideFavoritesRow = (picker) => {
  const root = picker?.shadowRoot;
  if (!root || root.querySelector('style[data-wikid]')) return;
  const style = document.createElement('style');
  style.dataset.wikid = '';
  style.textContent = '.favorites { display: none; }';
  root.appendChild(style);
};
const iconTabs = computed(() => {
  const tabs = [{ key: 'emoji', label: 'Emoji' }];
  if (props.allowIcons) {
    tabs.push({ key: 'icons', label: 'Icons' });
  }
  if (props.showStyleTab) {
    tabs.push({ key: 'style', label: 'Style' });
  }
  return tabs;
});
const activeTab = ref('emoji');
const iconSearch = ref('');
const iconColor = ref('');
const showIconColorMenu = ref(false);
const iconColorSwatches = [
  { value: '', label: 'Default' },
  { value: '#0ea5e9', label: 'Sky' },
  { value: '#22c55e', label: 'Green' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#f97316', label: 'Orange' },
  { value: '#ef4444', label: 'Red' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#6366f1', label: 'Indigo' },
  { value: '#14b8a6', label: 'Teal' },
  { value: '#94a3b8', label: 'Slate' },
  { value: '#0f172a', label: 'Ink' },
];
// Searching finds icons by name and, once loaded, by their tags ("home" finds "house")
const iconMeta = ref(null);
watch(iconSearch, (query) => {
  if (query.trim() && !iconMeta.value) {
    loadIconMeta().then((meta) => {
      iconMeta.value = meta;
    });
  }
});
const iconOptions = computed(() => searchIcons(iconEntries, iconSearch.value, { meta: iconMeta.value }));
// Opened out, with Bootstrap Icons' categories
const browserOpen = ref(false);
const selectFromBrowser = (entry) => {
  browserOpen.value = false;
  selectIcon(entry);
};

const updatePickerState = () => {
  const parsed = parseIconToken(props.icon);
  const isIcon = props.allowIcons && isIconToken(props.icon);
  activeTab.value = isIcon ? 'icons' : 'emoji';
  iconColor.value = parsed?.color || '';
  iconSearch.value = '';
  showIconColorMenu.value = false;
  browserOpen.value = false;
};

const selectValue = (value) => {
  emit('select', value);
  if (!props.showRecents || !value) return;
  if (isIconToken(value)) {
    const icon = canonicalIcon(value);
    if (icon) rememberIn(ICON_RECENTS_KEY, RECENT_ICONS_MAX, icon.token, recentIcons);
  } else {
    rememberIn(EMOJI_RECENTS_KEY, RECENT_EMOJIS_MAX, value, recentEmojis);
  }
};

const handleEmojiPickerSelect = (event) => {
  const picked = event?.detail?.unicode || event?.detail?.emoji?.unicode;
  if (!picked) return;
  selectValue(picked);
};

const toggleIconColorMenu = () => {
  showIconColorMenu.value = !showIconColorMenu.value;
};

const applyIconColorToSelection = (nextColor) => {
  if (!isIconToken(props.icon)) return;
  const parsed = parseIconToken(props.icon);
  if (!parsed?.id) return;
  const nextToken = buildIconToken(parsed.id, nextColor);
  if (nextToken === props.icon) return;
  // (A recoloured icon goes in the Recent row in its new colour)
  selectValue(nextToken);
};

const selectIconColor = (value) => {
  iconColor.value = value;
  showIconColorMenu.value = false;
  applyIconColorToSelection(value);
};

const selectIcon = (entry) => {
  if (!entry?.id) return;
  selectValue(buildIconToken(entry.id, iconColor.value));
};

const selectStyle = (value) => {
  emit('style-select', value);
};

const selectTab = (tabKey) => {
  activeTab.value = tabKey;
};

const loadRecents = () => {
  recentEmojis.value = readList(EMOJI_RECENTS_KEY, RECENT_EMOJIS_MAX);
  recentIcons.value = readList(ICON_RECENTS_KEY, RECENT_ICONS_MAX);
};

// (Immediate: the picker is usually made already open, and starts on the current icon's tab and
// colour)
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    updatePickerState();
    loadRecents();
  },
  { immediate: true }
);

watch(
  () => props.icon,
  () => {
    if (props.open) updatePickerState();
  }
);
</script>

<template>
  <div v-if="showHeader" class="emoji-menu__header">
    <span class="emoji-menu__title">{{ title }}</span>
    <button v-if="showClose" class="emoji-menu__close" type="button" @click="$emit('close')">×</button>
  </div>
  <div v-if="iconTabs.length > 1" class="emoji-menu__tabs" role="tablist">
    <button
      v-for="tab in iconTabs"
      :key="tab.key"
      class="emoji-tab"
      :class="{ 'emoji-tab--active': tab.key === activeTab }"
      type="button"
      @click="selectTab(tab.key)"
    >
      {{ tab.label }}
    </button>
  </div>
  <div v-if="activeTab === 'emoji'" class="emoji-menu__panel">
    <div v-if="showRecents && recentEmojis.length" class="emoji-menu__section">
      <div class="emoji-menu__section-title">Recent</div>
      <div class="emoji-menu__grid emoji-menu__grid--recents">
        <button
          v-for="icon in recentEmojis"
          :key="icon"
          class="emoji-btn"
          type="button"
          @click="selectValue(icon)"
        >
          {{ icon }}
        </button>
      </div>
    </div>
    <div v-if="showRecents && !recentEmojis.length" class="emoji-menu__empty">Pick an emoji to start a recent list.</div>
    <emoji-picker
      :ref="hideFavoritesRow"
      class="emoji-picker"
      data-skin-tone-picker="true"
      :data-source="emojiDataSource"
      @emoji-click="handleEmojiPickerSelect"
    ></emoji-picker>
  </div>
  <div v-else-if="activeTab === 'icons'" class="emoji-menu__panel">
    <div v-if="showRecents && recentIconOptions.length && !iconSearch.trim()" class="emoji-menu__section">
      <div class="emoji-menu__section-title">Recent</div>
      <div class="emoji-menu__grid emoji-menu__grid--icons emoji-menu__grid--recent-icons">
        <button
          v-for="recent in recentIconOptions"
          :key="recent.token"
          class="emoji-btn emoji-btn--icon"
          type="button"
          :title="recent.name"
          @click="selectValue(recent.token)"
        >
          <PageIcon :icon="recent.token" aria-hidden="true" />
        </button>
      </div>
    </div>
    <div class="emoji-menu__section-title">Icons</div>
    <div class="icon-controls">
      <input
        v-model="iconSearch"
        class="icon-search"
        type="search"
        placeholder="Search icons"
        aria-label="Search icons"
      />
      <button class="icon-browse-btn" type="button" title="Browse by category" @click="browserOpen = true">
        <i class="bi bi-arrows-angle-expand" aria-hidden="true"></i>
        Browse
      </button>
      <div class="icon-color-picker">
        <button
          class="icon-color-toggle"
          type="button"
          :class="{ 'icon-color-toggle--default': !iconColor }"
          :style="iconColor ? { background: iconColor } : null"
          aria-label="Select icon color"
          @click="toggleIconColorMenu"
        ></button>
        <div v-if="showIconColorMenu" class="icon-color-menu" role="listbox" aria-label="Icon color">
          <button
            v-for="swatch in iconColorSwatches"
            :key="swatch.label"
            class="icon-color-swatch"
            type="button"
            :class="{ 'icon-color-swatch--default': !swatch.value }"
            :style="swatch.value ? { background: swatch.value } : null"
            :aria-label="swatch.label"
            :aria-selected="iconColor === swatch.value"
            @click="selectIconColor(swatch.value)"
          ></button>
        </div>
      </div>
    </div>
    <div v-if="iconOptions.length" class="emoji-menu__grid emoji-menu__grid--icons">
      <button
        v-for="entry in iconOptions"
        :key="entry.id"
        class="emoji-btn emoji-btn--icon"
        type="button"
        :title="entry.name"
        @click="selectIcon(entry)"
      >
        <PageIcon :icon="buildIconToken(entry.id, iconColor)" aria-hidden="true" />
      </button>
    </div>
    <div v-else class="emoji-menu__empty">No matching icons.</div>
    <IconBrowser
      v-if="browserOpen"
      :color="iconColor"
      :initial-query="iconSearch"
      @select="selectFromBrowser"
      @close="browserOpen = false"
    />
  </div>
  <div v-else class="emoji-menu__panel">
    <div class="emoji-menu__section-title">Background</div>
    <div v-if="styleOptions.length" class="emoji-menu__style-list" role="listbox" aria-label="Callout styles">
      <div
        v-for="option in styleOptions"
        :key="option.label || option.value"
        class="emoji-menu__style-option"
        :class="{ 'emoji-menu__style-option--selected': styleValue === option.value }"
        :style="option.value ? { background: option.value } : { background: 'var(--surface-muted)' }"
        role="option"
        tabindex="0"
        :aria-selected="styleValue === option.value"
        @click="selectStyle(option.value)"
        @keydown.enter.prevent="selectStyle(option.value)"
        @keydown.space.prevent="selectStyle(option.value)"
      >
        <button
          class="emoji-menu__style-emoji"
          type="button"
          :aria-label="`Set icon to ${option.emoji || 'callout icon'}`"
          @click.stop="selectValue(option.emoji || '')"
        >
          {{ option.emoji || '💡' }}
        </button>
        <div class="emoji-menu__style-text">
          <div class="emoji-menu__style-label">{{ option.label || 'Callout' }}</div>
          <div v-if="option.description" class="emoji-menu__style-description">
            {{ option.description }}
          </div>
        </div>
      </div>
    </div>
    <div v-else class="emoji-menu__empty">No styles available.</div>
  </div>
</template>
