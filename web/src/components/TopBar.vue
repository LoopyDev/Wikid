<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import PageIcon from './PageIcon.vue';

const props = defineProps({
  workspaceName: {
    type: String,
    required: true,
  },
  crumbs: {
    type: Array,
    default: () => [],
  },
  saving: {
    type: Boolean,
    default: false,
  },
  showWorkspaceName: {
    type: Boolean,
    default: true,
  },
  statusLabel: {
    type: String,
    default: '',
  },
  statusState: {
    type: String,
    default: '',
  },
  collaborators: {
    type: Array,
    default: () => [],
  },
  fullWidth: {
    type: Boolean,
    default: false,
  },
  showFullWidthToggle: {
    type: Boolean,
    default: false,
  },
  showSidebarToggle: {
    type: Boolean,
    default: false,
  },
  showAiToggle: {
    type: Boolean,
    default: false,
  },
  aiPanelOpen: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['export', 'navigate', 'toggle-full-width', 'toggle-sidebar', 'preview-sidebar', 'menu-open', 'toggle-ai']);

const menuOpen = ref(false);
const menuRef = ref(null);
const menuButtonRef = ref(null);

const closeMenu = () => {
  menuOpen.value = false;
};
const toggleMenu = () => {
  menuOpen.value = !menuOpen.value;
  if (menuOpen.value) {
    emit('menu-open');
    document.activeElement?.blur();
    window.getSelection()?.removeAllRanges();
  }
};

const handleExport = () => {
  emit('export');
  closeMenu();
};
const handleNavigate = (pageId) => emit('navigate', pageId);
const handleToggleFullWidth = () => emit('toggle-full-width', !props.fullWidth);
const handleToggleSidebar = () => emit('toggle-sidebar');
const handlePreviewSidebar = (open, event) => emit('preview-sidebar', { open, event });

const baseCrumbs = computed(() => {
  const items = [];
  if (props.showWorkspaceName) {
    items.push({ id: null, title: props.workspaceName });
  }
  return [...items, ...props.crumbs];
});

// Show all crumbs when there are 3 or fewer; otherwise collapse the middle
// into a single "…" so the structure is always: [root, …, parent, current].
// CSS flex handles actual truncation within available space.
const displayCrumbs = computed(() => {
  const items = baseCrumbs.value;
  if (items.length <= 3) return items;
  const first = items[0];
  const tail = items.slice(-2);
  const hidden = items.slice(1, -2);
  const ellipsisId = hidden[hidden.length - 1]?.id ?? null;
  return [first, { id: ellipsisId, title: '…', isEllipsis: true, hidden }, ...tail];
});

const isWorkspaceCrumb = (crumb, index) => props.showWorkspaceName && index === 0 && !crumb.id;

const handleEllipsisNavigate = (crumb) => {
  const targetId = crumb?.hidden?.[crumb.hidden.length - 1]?.id || crumb?.id;
  if (targetId) {
    handleNavigate(targetId);
  }
};

const hasCustomStatus = computed(() => !!props.statusLabel || !!props.statusState);
const showSpinner = computed(() => {
  if (hasCustomStatus.value) {
    return props.statusState === 'saving' || props.statusState === 'connecting';
  }
  return props.saving;
});
const statusText = computed(() => {
  if (hasCustomStatus.value) {
    if (props.statusLabel) return props.statusLabel;
    if (props.statusState === 'saving') return 'Saving...';
    if (props.statusState === 'connecting') return 'Connecting...';
    if (props.statusState === 'offline') return 'Offline';
    if (props.statusState === 'error') return 'Save failed';
    return 'Saved';
  }
  return props.saving ? 'Saving.' : 'Saved';
});

const handleMenuOutsideClick = (event) => {
  if (!menuOpen.value) return;
  const target = event.target;
  if (menuRef.value?.contains(target) || menuButtonRef.value?.contains(target)) return;
  closeMenu();
};

const handleMenuKeydown = (event) => {
  if (event.key === 'Escape') {
    closeMenu();
  }
};

onMounted(() => {
  document.addEventListener('mousedown', handleMenuOutsideClick);
  document.addEventListener('keydown', handleMenuKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleMenuOutsideClick);
  document.removeEventListener('keydown', handleMenuKeydown);
});
</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <button
        v-if="showSidebarToggle"
        type="button"
        class="ghost-btn topbar-sidebar-toggle"
        aria-label="Show sidebar"
        title="Show sidebar"
        @click="handleToggleSidebar"
        @mouseenter="handlePreviewSidebar(true)"
        @mouseleave="handlePreviewSidebar(false, $event)"
      >
        <PageIcon class="topbar-sidebar-icon" icon="icon:list" fallback="Menu" aria-hidden="true" />
      </button>
      <div class="crumbs">
        <template v-for="(crumb, index) in displayCrumbs" :key="crumb.id || `crumb-${index}`">
          <span v-if="index > 0" class="crumb-sep">/</span>
          <template v-if="crumb.isEllipsis">
            <span class="crumb-ellipsis">
              <button
                type="button"
                class="crumb crumb-link"
                aria-label="Go to previous breadcrumb"
                @click="handleEllipsisNavigate(crumb)"
              >
                {{ crumb.title }}
              </button>
            </span>
          </template>
          <button
            v-else-if="crumb.id && index < displayCrumbs.length - 1"
            type="button"
            class="crumb crumb-link"
            @click="handleNavigate(crumb.id)"
          >
            {{ crumb.title || 'Untitled page' }}
          </button>
          <span v-else class="crumb current" :class="{ 'crumb-workspace': isWorkspaceCrumb(crumb, index) }">
            {{ crumb.title || 'Untitled page' }}
          </span>
        </template>
      </div>
    </div>
    <div class="topbar-actions">
      <div v-if="collaborators.length" class="topbar-presence" aria-label="People currently here">
        <span
          v-for="person in collaborators"
          :key="person.name + person.letter + person.color"
          class="presence-dot"
          :style="{ background: person.color }"
          :title="person.name"
        >
          {{ person.letter }}
        </span>
      </div>
      <span class="status-text">
        <span v-if="showSpinner" class="spinner" aria-hidden="true"></span>
        {{ statusText }}
      </span>
      <button
        v-if="showAiToggle"
        type="button"
        class="ghost-btn topbar-ai-btn"
        :class="{ 'topbar-ai-btn--active': aiPanelOpen }"
        aria-label="Toggle AI panel"
        title="AI Assistant"
        @click="emit('toggle-ai')"
      >
        <span class="topbar-ai-icon" aria-hidden="true">✦</span>
        <span class="topbar-ai-label">AI</span>
      </button>
      <div class="topbar-menu">
        <button
          ref="menuButtonRef"
          class="ghost-btn topbar-menu-btn"
          type="button"
          aria-label="Page actions"
          aria-haspopup="true"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          @click="toggleMenu"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
        <div v-if="menuOpen" ref="menuRef" class="context-menu topbar-menu__dropdown" @click.stop>
          <button class="context-menu__item" type="button" @click="handleExport">Export</button>
          <div v-if="showFullWidthToggle" class="topbar-menu__separator" role="separator"></div>
          <button
            v-if="showFullWidthToggle"
            class="context-menu__item topbar-menu__toggle"
            type="button"
            :aria-pressed="fullWidth ? 'true' : 'false'"
            @click="handleToggleFullWidth"
          >
            <span>Full Width Page</span>
            <span class="topbar-menu__switch" :class="{ 'topbar-menu__switch--on': fullWidth }" aria-hidden="true">
              <span class="topbar-menu__switch-knob"></span>
            </span>
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
