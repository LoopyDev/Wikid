<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import 'emoji-picker-element';
import emojiDataUrl from 'emoji-picker-element-data/en/emojibase/data.json?url';
import { buildIconToken, iconEntries, isIconToken, parseIconToken } from '../utils/icons';
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
const emojiDataSource = emojiDataUrl;
const recentEmojis = ref([]);
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

const rememberEmoji = (emoji) => {
  if (!props.showRecents) return;
  const next = [emoji, ...recentEmojis.value.filter((item) => item !== emoji)].slice(0, 24);
  recentEmojis.value = next;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify(next));
  }
};

const selectValue = (value) => {
  emit('select', value);
  if (!isIconToken(value)) {
    rememberEmoji(value);
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
  emit('select', nextToken);
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

onMounted(() => {
  if (typeof localStorage === 'undefined') return;
  const storedRecents = localStorage.getItem(EMOJI_RECENTS_KEY);
  if (!storedRecents) return;
  try {
    const parsed = JSON.parse(storedRecents);
    if (Array.isArray(parsed)) {
      recentEmojis.value = parsed.filter(Boolean).slice(0, 24);
    }
  } catch {
    // ignore malformed recent emoji cache
  }
});

watch(
  () => props.open,
  (open) => {
    if (open) updatePickerState();
  }
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
      class="emoji-picker"
      data-skin-tone-picker="true"
      :data-source="emojiDataSource"
      @emoji-click="handleEmojiPickerSelect"
    ></emoji-picker>
  </div>
  <div v-else-if="activeTab === 'icons'" class="emoji-menu__panel">
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
